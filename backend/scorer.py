from typing import List, Tuple, Dict
import re

STOPWORDS = {
    "the","and","or","to","of","in","for","on","with","a","an","is","are","as","at","by","be","from",
    "this","that","it","we","you","our","your","their","they","will","can","must","should","have","has",
}

EDU_KEYWORDS = {
    "bachelor","bachelors","b.tech","btech","be","b.e","bs","bsc",
    "master","masters","m.tech","mtech","ms","msc","mba",
    "phd","doctorate",
    "computer science","cs","information technology","it","software engineering"
}

LEADERSHIP_KEYWORDS = {
    "lead","led","leading","leadership","mentor","mentored","mentoring",
    "managed","manager","management","owner","owned",
    "architect","architected","driving","driven",
    "stakeholder","cross-functional","cross functional",
    "initiative","roadmap"
}

def rerank(candidates: list, weights) -> list:
    total = weights.experience + weights.skills + weights.education + weights.leadership
    if total == 0:
        return candidates

    for c in candidates:
        c.overall_score = round(
            (c.breakdown.experience * weights.experience +
             c.breakdown.skills * weights.skills +
             c.breakdown.education * weights.education +
             c.breakdown.leadership * weights.leadership) / total
        )
        if c.overall_score >= 80:
            c.recommendation = "Strong Yes"
        elif c.overall_score >= 65:
            c.recommendation = "Yes"
        elif c.overall_score >= 45:
            c.recommendation = "Maybe"
        else:
            c.recommendation = "No"
    return sorted(candidates, key=lambda x: x.overall_score, reverse=True)

def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").lower()).strip()

def _tokenize(text: str) -> List[str]:
    text = _normalize(text)
    text = re.sub(r"[^a-z0-9\+\#\.\- ]+", " ", text)
    toks = [t for t in text.split() if t and t not in STOPWORDS and len(t) > 1]
    return toks

def _extract_years(text: str) -> int:
    t = _normalize(text)

    # Direct "X years" style
    m = re.search(r"(\d{1,2})\s*\+?\s*(?:years?|yrs?)", t)
    if m:
        return int(m.group(1))

    # Sum multiple spans (rough heuristic)
    spans = re.findall(r"(19\d{2}|20\d{2})\s*(?:-|to)\s*(19\d{2}|20\d{2}|present|current)", t)
    total = 0
    for a, b in spans:
        y1 = int(a)
        y2 = 2026 if b in ("present", "current") else int(b)
        if 0 <= (y2 - y1) <= 50:
            total += (y2 - y1)

    # Cap to avoid double-counting overlapping roles too much
    return min(total, 40)

def _extract_jd_skill_terms(jd_text: str) -> List[str]:
    jd = _normalize(jd_text)

    # Try to focus on requirements section if present
    idx = jd.find("requirements")
    if idx != -1:
        jd = jd[idx:]

    # Capture bullet-ish lines
    lines = [ln.strip() for ln in jd.splitlines() if ln.strip()]
    bullet_lines = [ln for ln in lines if ln.startswith(("-", "*")) or "experience with" in ln or "proficiency" in ln]

    text = " ".join(bullet_lines) if bullet_lines else jd
    toks = _tokenize(text)

    # Keep tech-looking tokens (allow c++, c#, node.js, aws, gcp, sql etc.)
    keep = []
    for t in toks:
        if any(ch.isdigit() for ch in t):
            keep.append(t)
        elif any(ch in t for ch in ["+", "#", ".", "-"]):
            keep.append(t)
        else:
            keep.append(t)
    return keep

def _skills_match_score(jd_text: str, resume_text: str) -> Tuple[int, List[str]]:
    jd_terms = list(dict.fromkeys(_extract_jd_skill_terms(jd_text)))  # unique, keep order
    rs_tokens = set(_tokenize(resume_text))

    if not jd_terms:
        return 0, []

    matched = [t for t in jd_terms if t in rs_tokens]
    score = int(100 * (len(matched) / max(1, len(jd_terms))))
    return min(100, max(0, score)), matched[:15]

def _education_score(jd_text: str, resume_text: str) -> Tuple[int, str]:
    rs = _normalize(resume_text)
    found = [k for k in EDU_KEYWORDS if k in rs]
    if not found:
        return 25, ""
    s = min(100, 50 + 15 * len(found))
    return s, ", ".join(sorted(found)[:6])

def _leadership_score(resume_text: str) -> int:
    rs = _normalize(resume_text)
    hits = sum(1 for k in LEADERSHIP_KEYWORDS if k in rs)
    if hits == 0:
        return 20
    return min(100, 35 + hits * 12)

def _experience_score(jd_text: str, resume_text: str) -> Tuple[int, int]:
    jd_years = _extract_years(jd_text)
    rs_years = _extract_years(resume_text)

    if jd_years <= 0 and rs_years <= 0:
        return 40, 0

    if jd_years <= 0:
        return min(100, 30 + rs_years * 10), rs_years

    ratio = rs_years / max(1, jd_years)
    score = int(max(0, min(100, 20 + 80 * min(1.25, ratio) / 1.25)))
    return score, rs_years

def _extract_name(resume_text: str) -> str:
    t = (resume_text or "").strip()
    lines = [ln.strip() for ln in t.splitlines() if ln.strip()]

    if not lines:
        return "Unknown Candidate"

    # Usually first line is the name (PDF text extraction often puts it first)
    first = re.sub(r"[^A-Za-z .'-]+", " ", lines[0]).strip()
    first = re.sub(r"\s+", " ", first)

    # Filter out obvious non-name headers
    bad = {"resume", "curriculum vitae", "cv", "profile", "summary"}
    if first.lower() in bad or len(first) < 3:
        return "Unknown Candidate"

    # Keep only if it looks like a human name (2-4 words)
    parts = [p for p in first.split(" ") if p]
    if 1 < len(parts) <= 4:
        return first.title()

    return "Unknown Candidate"

def offline_breakdown(job_description: str, resume_text: str) -> Dict:
    skills_score, matched = _skills_match_score(job_description, resume_text)

    exp_score, yrs = _experience_score(job_description, resume_text)
    edu_score, edu_str = _education_score(job_description, resume_text)
    lead_score = _leadership_score(resume_text)

    summary = (
        f"Offline score based on keyword match and heuristics. "
        f"Matched {len(matched)} key terms; approx years experience: {yrs}."
    )

    jd_terms = list(dict.fromkeys(_extract_jd_skill_terms(job_description)))
    rs_tokens = set(_tokenize(resume_text))

    missing = [t for t in jd_terms if t not in rs_tokens]
    matched_short = matched[:6]
    missing_short = missing[:8]

    strengths = []
    gaps = []

    if matched_short:
        strengths.append(f"Matched JD skills: {', '.join(matched_short)}")
    else:
        gaps.append("No clear JD skill matches found in resume text")

    if missing_short:
        gaps.append(f"Missing from JD: {', '.join(missing_short)}")

    # Keep your existing signals too
    if exp_score >= 70:
        strengths.append("Experience aligns with requirement")
    elif exp_score <= 40:
        gaps.append("Experience may be below JD requirement or not clearly stated")

    if edu_score >= 70:
        strengths.append("Education signals present")

    if lead_score >= 70:
        strengths.append("Leadership/ownership signals present")
    elif lead_score < 40:
        gaps.append("Leadership signals not prominent")

    avg_core = (skills_score + exp_score) / 2
    if avg_core >= 80:
        recommendation = "Strong Yes"
    elif avg_core >= 65:
        recommendation = "Yes"
    elif avg_core >= 45:
        recommendation = "Maybe"
    else:
        recommendation = "No"

    return {
        "breakdown": {
            "experience": exp_score,
            "skills": skills_score,
            "education": edu_score,
            "leadership": lead_score,
        },
        "summary": summary,
        "strengths": strengths[:3] or ["Relevant keywords found"],
        "gaps": gaps[:3] or ["No major gaps detected by offline heuristic"],
        "recommendation": recommendation,
        "bias_flags": [],
        "years_experience": yrs,
        "top_skills": matched[:6],
        "education": edu_str,
        "name": _extract_name(resume_text),
    }