from pydantic import BaseModel
from typing import List, Optional

class WeightConfig(BaseModel):
    experience: int = 40
    skills: int = 35
    education: int = 15
    leadership: int = 10

class ResumeInput(BaseModel):
    name: str
    text: str

class ScreenRequest(BaseModel):
    job_description: str
    resumes: List[ResumeInput]
    weights: WeightConfig
    api_key: str  

class ScoreBreakdown(BaseModel):
    experience: int
    skills: int
    education: int
    leadership: int

class ScoredCandidate(BaseModel):
    id: str
    name: str
    file_name: str
    overall_score: int
    breakdown: ScoreBreakdown
    summary: str
    strengths: List[str]
    gaps: List[str]
    recommendation: str
    bias_flags: List[str]
    years_experience: int
    top_skills: List[str]
    education: str

class RerankRequest(BaseModel):
    candidates: List[ScoredCandidate]
    weights: WeightConfig

class ScreeningResult(BaseModel):
    candidates: List[ScoredCandidate]
    job_title: str
    screened_at: str
