import os
import json
import uuid
from groq import Groq
from openai import OpenAI
import anthropic
import google.generativeai as genai
from datetime import datetime
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import PyPDF2
import io
import scorer
from models import (
    ScreenRequest, RerankRequest, ScoredCandidate,
    ScoreBreakdown, ScreeningResult, WeightConfig
)

PROVIDER_MODELS = {
    "groq": "llama-3.3-70b-versatile",
    "openai": "gpt-4o-mini",
    "anthropic": "claude-sonnet-4-20250514",
    "gemini": "gemini-2.0-flash",
}

load_dotenv()

app = FastAPI(title="ScreenIQ API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

def extract_text_from_pdf(file_bytes: bytes) -> str:
    reader = PyPDF2.PdfReader(io.BytesIO(file_bytes))
    text = ""
    for page in reader.pages:
        text += page.extract_text() or ""
    return text

def build_prompt(resume_text, job_description, weights):
    return f"""You are a strict, expert recruiter screening candidates. Your job is to accurately score a resume against a job description. You must be harsh and honest — do NOT inflate scores.

CRITICAL RULES:
1. FIRST check if the uploaded document is actually a resume/CV. If it is a certificate, letter, random document, invoice, or anything that is NOT a resume, give overall_score 0-10 and recommendation "No". Do NOT be generous to non-resume documents.
2. Only give credit for skills/experience that are EXPLICITLY stated in the resume. Do not assume or infer skills that aren't mentioned.
3. Score each dimension strictly from 0 to 100:
   - 0-20: No evidence at all for this dimension
   - 21-40: Minimal/weak evidence
   - 41-60: Some relevant evidence but significant gaps
   - 61-80: Good match with minor gaps
   - 81-100: Excellent match, exceeds requirements
4. The overall_score must be the weighted average: (experience*{weights.experience} + skills*{weights.skills} + education*{weights.education} + leadership*{weights.leadership}) / {weights.experience + weights.skills + weights.education + weights.leadership}
5. Recommendation thresholds: "Strong Yes" (>=80), "Yes" (65-79), "Maybe" (45-64), "No" (<45)

Job Description:
{job_description}

Uploaded Document:
{resume_text}

BIAS AUDIT: Check if your scoring appears influenced by non-relevant attributes (gender, age, ethnicity, name origin, university prestige unless JD requires it). List any bias risks in bias_flags, or return empty array if scoring is purely merit-based.

Return ONLY valid JSON. All score fields MUST be integers (not strings). DO NOT reuse the same scores for different candidates — analyze each resume individually.

{{
  "is_resume": true,
  "name": "John Doe",
  "overall_score": 58,
  "breakdown": {{ "experience": 45, "skills": 62, "education": 73, "leadership": 30 }},
  "summary": "Two sentence summary of this specific candidate.",
  "strengths": ["strength 1", "strength 2"],
  "gaps": ["gap 1", "gap 2"],
  "recommendation": "Maybe",
  "years_experience": 2,
  "top_skills": ["skill1", "skill2"],
  "education": "B.Tech CSE",
  "bias_flags": []
}}

The example above is ONLY for format reference. You MUST calculate your own scores for THIS resume by comparing it against EVERY requirement in the JD. Each breakdown score must be an integer 0-100. years_experience must be an integer extracted from work history dates."""


def call_llm(provider: str, api_key: str, prompt: str) -> dict:
    """Call the appropriate LLM provider and return parsed JSON."""

    if provider == "groq":
        client = Groq(api_key=api_key)
        completion = client.chat.completions.create(
            model=PROVIDER_MODELS["groq"],
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
        )
        return json.loads(completion.choices[0].message.content)

    if provider == "openai":
        client = OpenAI(api_key=api_key)
        completion = client.chat.completions.create(
            model=PROVIDER_MODELS["openai"],
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
        )
        return json.loads(completion.choices[0].message.content)

    if provider == "anthropic":
        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model=PROVIDER_MODELS["anthropic"],
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt + "\nReturn ONLY valid JSON, no markdown."}],
        )
        return json.loads(message.content[0].text)

    if provider == "gemini":
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(PROVIDER_MODELS["gemini"])
        response = model.generate_content(
            prompt + "\nReturn ONLY valid JSON, no markdown.",
            generation_config={"response_mime_type": "application/json"},
        )
        return json.loads(response.text)

    raise ValueError(f"Unsupported provider: {provider}")


def safe_int(val, default=0):
    """Convert to int safely — handles None, strings, floats."""
    if val is None:
        return default
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return default


def clamp(val, lo=0, hi=100):
    return max(lo, min(hi, safe_int(val)))


def validate_overall_score(breakdown, weights):
    """Recalculate the weighted average server-side so the LLM can't inflate it."""
    total_weight = weights.experience + weights.skills + weights.education + weights.leadership
    if total_weight == 0:
        return 0
    score = (
        breakdown.experience * weights.experience +
        breakdown.skills * weights.skills +
        breakdown.education * weights.education +
        breakdown.leadership * weights.leadership
    ) / total_weight
    return clamp(round(score))


def derive_recommendation(score):
    if score >= 80:
        return "Strong Yes"
    if score >= 65:
        return "Yes"
    if score >= 45:
        return "Maybe"
    return "No"


async def score_candidate_with_ai(provider, api_key, resume_text, file_name, job_description, index, weights):
    prompt = build_prompt(resume_text, job_description, weights)
    ai_data = call_llm(provider, api_key, prompt)

    # Clamp all sub-scores to 0-100, handle null/string safely
    bd = ai_data.get("breakdown", {})
    breakdown = ScoreBreakdown(
        experience=clamp(bd.get("experience")),
        skills=clamp(bd.get("skills")),
        education=clamp(bd.get("education")),
        leadership=clamp(bd.get("leadership")),
    )

    # Recalculate overall score server-side (don't trust LLM's math)
    overall_score = validate_overall_score(breakdown, weights)
    recommendation = derive_recommendation(overall_score)

    # If LLM flagged it as not a resume, enforce low score
    if ai_data.get("is_resume") is False:
        breakdown = ScoreBreakdown(experience=0, skills=0, education=0, leadership=0)
        overall_score = 0
        recommendation = "No"

    return ScoredCandidate(
        id=f"candidate-{index}-{uuid.uuid4().hex[:6]}",
        file_name=file_name,
        name=ai_data.get("name", "Unknown"),
        overall_score=overall_score,
        breakdown=breakdown,
        summary=ai_data.get("summary", ""),
        strengths=ai_data.get("strengths", []),
        gaps=ai_data.get("gaps", []),
        recommendation=recommendation,
        bias_flags=ai_data.get("bias_flags", []),
        years_experience=safe_int(ai_data.get("years_experience")),
        top_skills=ai_data.get("top_skills", []),
        education=ai_data.get("education", ""),
    )


@app.post("/api/screen", response_model=ScreeningResult)
async def screen_candidates(request: ScreenRequest):
    try:
        if not request.api_key:
            raise HTTPException(status_code=400, detail="API key is required")

        provider = request.provider
        if provider not in PROVIDER_MODELS:
            raise HTTPException(status_code=400, detail=f"Unsupported provider: {provider}")

        scored = []
        for i, resume in enumerate(request.resumes):
            candidate = await score_candidate_with_ai(
                provider, request.api_key,
                resume.text, resume.name, request.job_description, i, request.weights,
            )
            scored.append(candidate)

        ranked = sorted(scored, key=lambda x: x.overall_score, reverse=True)

        return ScreeningResult(
            candidates=ranked,
            job_title=request.job_description.split("\n")[0][:60],
            screened_at=datetime.utcnow().isoformat(),
        )
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=401, detail=str(e))

@app.post("/api/rerank")
async def rerank_candidates(request: RerankRequest):
    ranked = scorer.rerank(request.candidates, request.weights)
    return {"candidates": ranked}

@app.post("/api/parse-pdf")
async def parse_pdf(file: UploadFile = File(...)):
    content = await file.read()
    if file.filename.endswith(".pdf"):
        text = extract_text_from_pdf(content)
    else:
        text = content.decode("utf-8", errors="ignore")
    return {"name": file.filename, "text": text}

@app.get("/")
async def root():
    return {"message": "ScreenIQ API is running"}