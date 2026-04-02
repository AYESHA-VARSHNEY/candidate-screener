import os
import json
import uuid
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

async def score_candidate(resume_text, file_name, job_description, index, weights):
    data = scorer.offline_breakdown(job_description, resume_text)
    total = weights.experience + weights.skills + weights.education + weights.leadership
    overall = round(
        (data["breakdown"]["experience"] * weights.experience +
         data["breakdown"]["skills"] * weights.skills +
         data["breakdown"]["education"] * weights.education +
         data["breakdown"]["leadership"] * weights.leadership) / max(1, total)
    )
    if overall >= 80: rec = "Strong Yes"
    elif overall >= 65: rec = "Yes"
    elif overall >= 45: rec = "Maybe"
    else: rec = "No"

    return ScoredCandidate(
        id=f"candidate-{index}-{uuid.uuid4().hex[:6]}",
        file_name=file_name,
        name=data["name"],
        overall_score=overall,
        breakdown=ScoreBreakdown(**data["breakdown"]),
        summary=data["summary"],
        strengths=data["strengths"],
        gaps=data["gaps"],
        recommendation=rec,
        bias_flags=data.get("bias_flags", []),
        years_experience=data.get("years_experience", 0),
        top_skills=data.get("top_skills", []),
        education=data.get("education", ""),
    )

@app.post("/api/screen", response_model=ScreeningResult)
async def screen_candidates(request: ScreenRequest):
    try:
        if not request.job_description or not request.resumes:
            raise HTTPException(status_code=400, detail="Missing job description or resumes")
        scored = []
        for i, resume in enumerate(request.resumes):
            candidate = await score_candidate(resume.text, resume.name, request.job_description, i, request.weights)
            scored.append(candidate)
        ranked = scorer.rerank(scored, request.weights)
        job_title = request.job_description.split("\n")[0][:60]
        return ScreeningResult(
            candidates=ranked,
            job_title=job_title,
            screened_at=datetime.utcnow().isoformat()
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

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