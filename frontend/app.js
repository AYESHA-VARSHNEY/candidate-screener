const API = 'http://127.0.0.1:8000';

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
  setupSliders()
  document.getElementById('file-input').addEventListener('change', handleFileUpload)
  document.getElementById('screen-btn').addEventListener('click', handleScreen)
  document.getElementById('back-btn').addEventListener('click', showUploadView)
  document.getElementById('rescore-btn').addEventListener('click', handleScreen)
})

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
    const res = await fetch(`${API}/api/screen`, {
    
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_description: jd,
        resumes: state.resumes,
        weights: state.weights
      })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.detail || 'Screening failed')
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
  try {
    const res = await fetch(`${API}/api/rerank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidates: state.result.candidates, weights: state.weights })
    })
    const data = await res.json()
    state.result.candidates = data.candidates
    renderCards()
    renderSummary()
  } catch (e) { console.error(e) }
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
