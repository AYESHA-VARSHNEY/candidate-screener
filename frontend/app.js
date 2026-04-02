const API = 'https://screeniq-api.onrender.com'
// ── API Key ───────────────────────────────────────────────────────────────
let USER_API_KEY = ''

function saveApiKey() {
  const key = document.getElementById('api-key-input').value.trim()
  if (!key) { alert('Please enter your API key'); return }
  USER_API_KEY = key
  sessionStorage.setItem('screeniq_key', key)
  hide('api-key-view')
  show('landing-view')
}

const REC_COLORS = {
  'Strong Yes': '#4ade80',
  'Yes': '#7c6aff',
  'Maybe': '#facc15',
  'No': '#ff6a6a'
}

let state = {
  resumes: [],
  weights: { experience: 40, skills: 35, education: 15, leadership: 10 },
  result: null
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    // Check if API key already saved
    const savedKey = sessionStorage.getItem('screeniq_key')
    if (savedKey) {
        USER_API_KEY = savedKey
        hide('api-key-view')
        show('landing-view')
    } else {
        show('api-key-view')
        hide('landing-view')
    }
  setupSliders()
  document.getElementById('file-input').addEventListener('change', handleFileUpload)
  document.getElementById('screen-btn').addEventListener('click', handleScreen)
  document.getElementById('back-btn').addEventListener('click', showUploadView)
  document.getElementById('rescore-btn').addEventListener('click', handleScreen)
  document.getElementById('c-file-input').addEventListener('change', handleCandidateUpload)
  document.getElementById('c-check-btn').addEventListener('click', handleCandidateCheck)

   // JD file upload
   document.getElementById('jd-file-input')?.addEventListener('change', async (e) => {
    const file = e.target.files[0]
    if (!file) return
    if (file.name.endsWith('.pdf')) {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`${API}/api/parse-pdf`, { method: 'POST', body: formData })
      const data = await res.json()
      document.getElementById('jd-input').value = data.text
    } else {
      document.getElementById('jd-input').value = await file.text()
    }
  })
  // Candidate JD file upload
  document.addEventListener('change', async (e) => {
    if (e.target && e.target.id === 'c-jd-file-input') {
        const file = e.target.files[0]
        if (!file) return
  
        if (file.name.endsWith('.pdf')) {
            const formData = new FormData()
            formData.append('file', file)
  
            const res = await fetch(`${API}/api/parse-pdf`, {
                 method: 'POST',
                 body: formData
            })
            const data = await res.json()
            document.getElementById('c-jd-input').value = data.text
        } else {
            document.getElementById('c-jd-input').value = await file.text()
        }
    }
  })
})


// ── Mode Selection ────────────────────────────────────────────────────────────

function setMode(mode) {
    state.mode = mode
    hide('landing-view')
    show('back-btn')
  
    if (mode === 'recruiter') {
      show('upload-view')
    } else {
      show('candidate-view')
    }
  }
  
  function goBack() {
    hide('upload-view')
    hide('results-view')
    hide('candidate-view')
    hide('candidate-result-view')
    hide('back-btn')
    hide('rescore-btn')
    show('landing-view')
    state.result = null
    state.candidateResume = null
    state.resumes = []
    document.getElementById('file-list').innerHTML = ''
    document.getElementById('c-file-list').innerHTML = ''
    document.getElementById('resume-count').textContent = '0'
  }
  
  function show(id) { document.getElementById(id)?.classList.remove('hidden') }
  function hide(id) { document.getElementById(id)?.classList.add('hidden') }

// ── Sliders ───────────────────────────────────────────────────────────────────

function setupSliders() {
  const keys = ['experience', 'skills', 'education', 'leadership']
  keys.forEach(key => {
    const slider = document.getElementById(`slider-${key}`)
    const valEl = document.getElementById(`val-${key}`)
    if (!slider) return
    slider.value = state.weights[key]
    valEl.textContent = state.weights[key]
    slider.addEventListener('input', () => {
      state.weights[key] = parseInt(slider.value)
      valEl.textContent = slider.value
      if (state.result) rerankLive()
    })
  })
}

function syncResultSliders() {
  const keys = ['experience', 'skills', 'education', 'leadership']
  keys.forEach(key => {
    const slider = document.getElementById(`rslider-${key}`)
    const valEl = document.getElementById(`rval-${key}`)
    if (!slider) return
    slider.value = state.weights[key]
    valEl.textContent = state.weights[key]
    slider.addEventListener('input', () => {
      state.weights[key] = parseInt(slider.value)
      valEl.textContent = slider.value
      rerankLive()
    })
  })
}

// ── File Upload ───────────────────────────────────────────────────────────────

async function handleFileUpload(e) {
    const files = Array.from(e.target.files)
    for (const file of files) {
      if (file.name.endsWith('.pdf')) {
        const formData = new FormData()
        formData.append('file', file)
        const res = await fetch(`${API}/api/parse-pdf`, {
          method: 'POST',
          body: formData
        })
        const data = await res.json()
        state.resumes.push({ name: data.name, text: data.text })
      } else {
        const text = await file.text()
        state.resumes.push({ name: file.name, text })
      }
    }
    renderFileList()
    document.getElementById('resume-count').textContent = state.resumes.length
  }
function renderFileList() {
  const list = document.getElementById('file-list')
  list.innerHTML = state.resumes.map((f, i) => `
    <div class="file-item">
      <span>${f.name}</span>
      <button class="remove-btn" onclick="removeFile(${i})">×</button>
    </div>
  `).join('')
}

function removeFile(i) {
  state.resumes.splice(i, 1)
  renderFileList()
}

// ── Screen ────────────────────────────────────────────────────────────────────

async function handleScreen() {
  const jd = document.getElementById('jd-input').value.trim()
  const errEl = document.getElementById('error-msg')
  errEl.textContent = ''

  if (!jd) { errEl.textContent = 'Please enter a job description.'; return }
  if (!state.resumes.length) { errEl.textContent = 'Please upload at least one resume.'; return }

  const btn = document.getElementById('screen-btn')
  btn.disabled = true
  btn.classList.add('loading')
  btn.innerHTML = '<span class="spinner"></span> Screening candidates...'

  try {
    const prompt = `You are an expert recruiter. Analyze these resumes against the job description.

    JOB DESCRIPTION:
    ${jd}

    RESUMES:
    ${state.resumes.map((r,i) => `--- Resume ${i+1}: ${r.name} ---\n${r.text}`).join('\n\n')}

    Return a JSON object with key "candidates" — array of objects, one per resume:
    {
        "job_title": "Job Title (guess from job description)",
        "candidates": [
        {
        "name": "Candidate Name (guess from resume)",
        "file_name": "filename",
        "overall_score": 85,
        "breakdown": { "experience": 88, "skills": 82, "education": 79, "leadership": 70 },
        "recommendation": "Strong Yes",
        "summary": "2-3 sentence summary",
        "top_skills": ["skill1","skill2","skill3"],
        "strengths": ["strength1","strength2"],
        "gaps": ["gap1","gap2"],
        "years_experience": 5,
        "education": "B.Tech CSE",
        "bias_flags": []
     }
   ]
 }

Recommendation must be one of: "Strong Yes", "Yes", "Maybe", "No".
Return ONLY valid JSON. No markdown. No text outside JSON.`

const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': USER_API_KEY,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true'
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }]
  })
})

const apiData = await res.json()
if (!res.ok) throw new Error(apiData.error?.message || 'API error')
const raw = apiData.content[0].text.trim().replace(/```json|```/g, '').trim()
const data = JSON.parse(raw)
    state.result = data
    showResultsView()
  } catch (err) {
    errEl.textContent = err.message
  } finally {
    btn.disabled = false
    btn.classList.remove('loading')
    btn.innerHTML = '⚡ Screen Candidates'
  }
}

async function rerankLive() {
    if (!state.result) return
    // Re-rank locally — no API call needed
    const w = state.weights
    const total = w.experience + w.skills + w.education + w.leadership || 1
    state.result.candidates.sort((a, b) => {
      const scoreA = (a.breakdown.experience * w.experience +
                      a.breakdown.skills * w.skills +
                      a.breakdown.education * w.education +
                      a.breakdown.leadership * w.leadership) / total
      const scoreB = (b.breakdown.experience * w.experience +
                      b.breakdown.skills * w.skills +
                      b.breakdown.education * w.education +
                      b.breakdown.leadership * w.leadership) / total
      return scoreB - scoreA
    })
    renderCards()
    renderSummary()
    syncResultSliders()
  }

// ── Views ─────────────────────────────────────────────────────────────────────

function showUploadView() {
  document.getElementById('upload-view').classList.remove('hidden')
  document.getElementById('results-view').classList.add('hidden')
  document.getElementById('back-btn').classList.add('hidden')
  document.getElementById('rescore-btn').classList.add('hidden')
}

function showResultsView() {
  document.getElementById('upload-view').classList.add('hidden')
  document.getElementById('results-view').classList.remove('hidden')
  document.getElementById('back-btn').classList.remove('hidden')
  document.getElementById('rescore-btn').classList.remove('hidden')
  renderSummary()
  renderCards()
  syncResultSliders()
}


// ── Render Summary ────────────────────────────────────────────────────────────

function renderSummary() {
  const c = state.result.candidates
  document.getElementById('total-count').textContent = `${c.length} candidates`

  const recs = { 'Strong Yes': 0, 'Yes': 0, 'Maybe': 0, 'No': 0 }
  c.forEach(x => recs[x.recommendation] = (recs[x.recommendation] || 0) + 1)

  document.getElementById('rec-summary').innerHTML = Object.entries(recs).map(([label, count]) => `
    <div class="rec-box">
      <div class="rec-count" style="color:${REC_COLORS[label]}">${count}</div>
      <div class="rec-label">${label}</div>
    </div>
  `).join('')
}

// ── Render Cards ──────────────────────────────────────────────────────────────

function renderCards() {
  const container = document.getElementById('cards-list')
  container.innerHTML = state.result.candidates.map((c, i) => buildCard(c, i + 1)).join('')
}

function buildCard(c, rank) {
  const color = REC_COLORS[c.recommendation] || '#7c6aff'
  const initials = c.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()

  const skillsHtml = c.top_skills.map(s => `<span class="skill-tag">${s}</span>`).join('')

  const strengthsHtml = c.strengths.map(s => `<p class="sg-item">↑ ${s}</p>`).join('')
  const gapsHtml = c.gaps.map(g => `<p class="sg-item">↓ ${g}</p>`).join('')

  const biasHtml = c.bias_flags?.length ? `
    <div class="bias-box">
      <p class="bias-title">⚠ BIAS AUDIT</p>
      ${c.bias_flags.map(f => `<p class="bias-item">${f}</p>`).join('')}
    </div>` : ''

  return `
    <div class="candidate-card" style="animation-delay:${(rank - 1) * 0.05}s">
      <div class="rank-badge">#${rank}</div>

      <div class="candidate-header">
        <div class="avatar" style="background:${color}22;border:1.5px solid ${color};color:${color}">${initials}</div>
        <div>
          <div class="candidate-name">${c.name}</div>
          <div class="candidate-file">${c.file_name}</div>
        </div>
      </div>

      <div class="score-section">
        <div class="score-header">
          <span class="score-label">Overall Match</span>
          <span class="score-number" style="color:${color}">${c.overall_score}%</span>
        </div>
        <div class="score-bar">
          <div class="score-fill" style="width:${c.overall_score}%;background:linear-gradient(90deg,${color}88,${color})"></div>
        </div>
      </div>

      <div class="breakdown-grid">
        <div class="breakdown-box"><div class="breakdown-key">Experience</div><div class="breakdown-val">${c.breakdown.experience}</div></div>
        <div class="breakdown-box"><div class="breakdown-key">Skills</div><div class="breakdown-val">${c.breakdown.skills}</div></div>
        <div class="breakdown-box"><div class="breakdown-key">Education</div><div class="breakdown-val">${c.breakdown.education}</div></div>
        <div class="breakdown-box"><div class="breakdown-key">Leadership</div><div class="breakdown-val">${c.breakdown.leadership}</div></div>
      </div>

      <p class="summary-text">${c.summary}</p>

      <div class="skills-row">${skillsHtml}</div>

      <div class="sg-grid">
        <div>
          <p class="sg-title" style="color:#4ade80">STRENGTHS</p>
          ${strengthsHtml}
        </div>
        <div>
          <p class="sg-title" style="color:#ff6a6a">GAPS</p>
          ${gapsHtml}
        </div>
      </div>

      <div class="card-footer">
        <span class="rec-tag" style="color:${color};background:${color}20;border-color:${color}55">${c.recommendation}</span>
        <span class="meta-text">${c.years_experience}y exp · ${c.education}</span>
      </div>

      ${biasHtml}
    </div>   
  `
}
// ── Candidate Upload ──────────────────────────────────────────────────────────

let candidateResume = null

async function handleCandidateUpload(e) {
  const file = e.target.files[0]
  if (!file) return
  if (file.name.endsWith('.pdf')) {
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch(`${API}/api/parse-pdf`, { method: 'POST', body: formData })
    const data = await res.json()
    candidateResume = { name: data.name, text: data.text }
  } else {
    candidateResume = { name: file.name, text: await file.text() }
  }
  document.getElementById('c-file-list').innerHTML = `
    <div class="file-item">
      <span>${candidateResume.name}</span>
      <button class="remove-btn" onclick="candidateResume=null;document.getElementById('c-file-list').innerHTML=''">×</button>
    </div>
  `
}

async function handleCandidateCheck() {
  const jd = document.getElementById('c-jd-input').value.trim()
  const errEl = document.getElementById('c-error-msg')
  errEl.textContent = ''

  if (!jd) { errEl.textContent = 'Please paste a job description.'; return }
  if (!candidateResume) { errEl.textContent = 'Please upload your resume.'; return }

  const btn = document.getElementById('c-check-btn')
  btn.disabled = true
  btn.innerHTML = '<span class="spinner"></span> Checking your fit...'

  try {
    const prompt = `You are an expert recruiter. Analyze this resume against the job description.

JOB DESCRIPTION:
${jd}

RESUME:
${candidateResume.text}

Return ONLY valid JSON:
{
  "name": "candidate name",
  "overall_score": 75,
  "breakdown": { "experience": 60, "skills": 80, "education": 85, "leadership": 70 },
  "recommendation": "Yes",
  "summary": "2-3 sentence summary",
  "top_skills": ["skill1","skill2","skill3"],
  "strengths": ["strength1","strength2","strength3"],
  "gaps": ["gap1","gap2"],
  "years_experience": 2,
  "education": "B.Tech AIML",
  "bias_flags": []
}`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': USER_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    })

    const apiData = await res.json()
    if (!res.ok) throw new Error(apiData.error?.message || 'API error')
    const raw = apiData.content[0].text.trim().replace(/```json|```/g, '').trim()
    const c = JSON.parse(raw)
    showCandidateResult(c)
  } catch (err) {
    errEl.textContent = err.message || 'Something went wrong.'
  } finally {
    btn.disabled = false
    btn.innerHTML = '🎯 Check My Fit'
  }
}

function showCandidateResult(c) {
  hide('candidate-view')
  show('candidate-result-view')
  show('back-btn')

  const color = REC_COLORS[c.recommendation] || '#7c6aff'
  const initials = c.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()

  document.getElementById('c-result-card').innerHTML = `
    <div class="rank-badge">#1</div>
    <div class="candidate-header">
      <div class="avatar" style="background:${color}22;border:1.5px solid ${color};color:${color}">${initials}</div>
      <div>
        <div class="candidate-name">${c.name}</div>
        <div class="candidate-file">${candidateResume.name}</div>
      </div>
    </div>
    <div class="score-section">
      <div class="score-header">
        <span class="score-label">Overall Match</span>
        <span class="score-number" style="color:${color}">${c.overall_score}%</span>
      </div>
      <div class="score-bar">
        <div class="score-fill" style="width:${c.overall_score}%;background:linear-gradient(90deg,${color}88,${color})"></div>
      </div>
    </div>
    <div class="breakdown-grid">
      <div class="breakdown-box"><div class="breakdown-key">Experience</div><div class="breakdown-val">${c.breakdown.experience}</div></div>
      <div class="breakdown-box"><div class="breakdown-key">Skills</div><div class="breakdown-val">${c.breakdown.skills}</div></div>
      <div class="breakdown-box"><div class="breakdown-key">Education</div><div class="breakdown-val">${c.breakdown.education}</div></div>
      <div class="breakdown-box"><div class="breakdown-key">Leadership</div><div class="breakdown-val">${c.breakdown.leadership}</div></div>
    </div>
    <p class="summary-text">${c.summary}</p>
    <div class="skills-row">${(c.top_skills||[]).map(s=>`<span class="skill-tag">${s}</span>`).join('')}</div>
    <div class="sg-grid">
      <div>
        <p class="sg-title" style="color:#4ade80">✅ STRENGTHS</p>
        ${(c.strengths||[]).map(s=>`<p class="sg-item">↑ ${s}</p>`).join('')}
      </div>
      <div>
        <p class="sg-title" style="color:#ff6a6a">📌 ADD TO RESUME</p>
        ${(c.gaps||[]).map(g=>`<p class="sg-item">↓ ${g}</p>`).join('')}
      </div>
    </div>
    <div class="card-footer">
      <span class="rec-tag" style="color:${color};background:${color}20;border-color:${color}55">${c.recommendation}</span>
      <span class="meta-text">${c.years_experience}y exp · ${c.education}</span>
    </div>
  `
}
