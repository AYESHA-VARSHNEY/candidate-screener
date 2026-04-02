import os
import json
import uuid
from groq import Groq 
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

# ISSE REPLACE KAREIN (Purana score_candidate hata kar)
async def score_candidate_with_ai(client, resume_text, file_name, job_description, index, weights):
    prompt = f"""
    Analyze this resume against the JD using these weights: 
    Experience: {weights.experience}, Skills: {weights.skills}, Education: {weights.education}, Leadership: {weights.leadership}.
    
    JD: {job_description}
    Resume: {resume_text}
    
    Return ONLY a JSON object with this structure:
    {{
      "name": "Candidate Name",
      "overall_score": 85,
      "breakdown": {{ "experience": 80, "skills": 90, "education": 70, "leadership": 60 }},
      "summary": "2 sentence summary of candidate fit",
      "strengths": ["list 3 key strengths"],
      "gaps": ["list 3 missing requirements"],
      "recommendation": "Strong Yes",
      "years_experience": 5,
      "top_skills": ["python", "aws", "fastapi"],
      "education": "B.Tech CSE"
    }}
    """
    
    completion = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"}
    )
    
    ai_data = json.loads(completion.choices[0].message.content)
    
    return ScoredCandidate(
        id=f"candidate-{index}-{uuid.uuid4().hex[:6]}",
        file_name=file_name,
        name=ai_data.get("name", "Unknown"),
        overall_score=ai_data.get("overall_score", 0),
        breakdown=ScoreBreakdown(**ai_data["breakdown"]),
        summary=ai_data.get("summary", ""),
        strengths=ai_data.get("strengths", []),
        gaps=ai_data.get("gaps", []),
        recommendation=ai_data.get("recommendation", "Maybe"),
        bias_flags=[], # Interviewer ko batana ye future roadmap hai
        years_experience=ai_data.get("years_experience", 0),
        top_skills=ai_data.get("top_skills", []),
        education=ai_data.get("education", "")
    )

@app.post("/api/screen", response_model=ScreeningResult)
async def screen_candidates(request: ScreenRequest):
    try:
        # 1. User ki API key se Groq connect karna
        if not request.api_key:
            raise HTTPException(status_code=400, detail="Groq API Key is required")
        # Groq client user ki key se initialize hoga
        client = Groq(api_key=request.api_key) 
        
        scored = []
        # 2. Batch Processing: Loop through all uploaded resumes
        for i, resume in enumerate(request.resumes):
            candidate = await score_candidate_with_ai(
                client, resume.text, resume.name, request.job_description, i, request.weights
            )
            scored.append(candidate)
            
        # 3. Ranking: Score ke hisaab se sort karna
        ranked = sorted(scored, key=lambda x: x.overall_score, reverse=True)
        
        return ScreeningResult(
            candidates=ranked,
            job_title=request.job_description.split("\n")[0][:60],
            screened_at=datetime.utcnow().isoformat()
        )
    except Exception as e:
        print(f"Error details: {str(e)}")
        raise HTTPException(status_code=401, detail="API Key Invalid or Model Limit Reached")

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