let state = {
  resumes: [],
  weights: { experience: 40, skills: 35, education: 15, leadership: 10 },
  result: null
}

// ── Init ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupSliders()
  document.getElementById('file-input').addEventListener('change', handleFileUpload)
  document.getElementById('screen-btn').addEventListener('click', handleScreen)

  document.getElementById('jd-file-input')?.addEventListener('change', async (e) => {
    const file = e.target.files[0]
    if (!file) return
    if (file.name.endsWith('.pdf')) {
      const data = await parsePdf(file)
      document.getElementById('jd-input').value = data.text
    } else {
      document.getElementById('jd-input').value = await file.text()
    }
  })
})

// ── Sliders ─────────────────────────────────────────────────────────────────
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

// ── File Upload ─────────────────────────────────────────────────────────────
async function handleFileUpload(e) {
  const files = Array.from(e.target.files)
  for (const file of files) {
    if (file.name.endsWith('.pdf')) {
      const data = await parsePdf(file)
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
  document.getElementById('resume-count').textContent = state.resumes.length
}

// ── Screen ──────────────────────────────────────────────────────────────────
async function handleScreen() {
  const jd = document.getElementById('jd-input').value.trim()
  const errEl = document.getElementById('error-msg')
  errEl.textContent = ''

  if (!jd) { errEl.textContent = 'Please enter a job description.'; return }
  if (!state.resumes.length) { errEl.textContent = 'Please upload at least one resume.'; return }
  if (!requireApiKey()) return

  const btn = document.getElementById('screen-btn')
  btn.disabled = true
  btn.innerHTML = '<span class="spinner"></span> Screening candidates...'

  try {
    const res = await fetch(`${API}/api/screen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_description: jd,
        resumes: state.resumes,
        weights: state.weights,
        api_key: getApiKey(),
        provider: getProvider()
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
    btn.innerHTML = 'Screen Candidates'
  }
}

// ── Reranking ───────────────────────────────────────────────────────────────
function rerankLive() {
  if (!state.result) return
  const w = state.weights
  const total = w.experience + w.skills + w.education + w.leadership || 1
  state.result.candidates.sort((a, b) => {
    const scoreA = (a.breakdown.experience * w.experience + a.breakdown.skills * w.skills +
                    a.breakdown.education * w.education + a.breakdown.leadership * w.leadership) / total
    const scoreB = (b.breakdown.experience * w.experience + b.breakdown.skills * w.skills +
                    b.breakdown.education * w.education + b.breakdown.leadership * w.leadership) / total
    return scoreB - scoreA
  })
  renderCards()
  renderSummary()
}

// ── Views ───────────────────────────────────────────────────────────────────
function showUploadView() {
  document.getElementById('upload-view').classList.remove('hidden')
  document.getElementById('results-view').classList.add('hidden')
  state.result = null
}

function showResultsView() {
  document.getElementById('upload-view').classList.add('hidden')
  document.getElementById('results-view').classList.remove('hidden')
  renderSummary()
  renderCards()
  syncResultSliders()
}

// ── Render ──────────────────────────────────────────────────────────────────
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

function renderCards() {
  const container = document.getElementById('cards-list')
  container.innerHTML = state.result.candidates.map((c, i) => buildCard(c, i + 1)).join('')
}

// Called when user changes settings mid-session
function onSettingsChanged() {
  renderNavbar('recruiter')
}
