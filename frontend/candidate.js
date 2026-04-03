let candidateResume = null
let weights = { experience: 40, skills: 35, education: 15, leadership: 10 }

// ── Init ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('c-file-input').addEventListener('change', handleCandidateUpload)
  document.getElementById('c-check-btn').addEventListener('click', handleCandidateCheck)

  document.getElementById('c-jd-file-input')?.addEventListener('change', async (e) => {
    const file = e.target.files[0]
    if (!file) return
    if (file.name.endsWith('.pdf')) {
      const data = await parsePdf(file)
      document.getElementById('c-jd-input').value = data.text
    } else {
      document.getElementById('c-jd-input').value = await file.text()
    }
  })
})

// ── File Upload ─────────────────────────────────────────────────────────────
async function handleCandidateUpload(e) {
  const file = e.target.files[0]
  if (!file) return

  if (file.name.endsWith('.pdf')) {
    const data = await parsePdf(file)
    candidateResume = { name: data.name, text: data.text }
  } else {
    candidateResume = { name: file.name, text: await file.text() }
  }

  document.getElementById('c-file-list').innerHTML = `
    <div class="file-item">
      <span>${candidateResume.name}</span>
      <button class="remove-btn" onclick="removeCandidateResume()">×</button>
    </div>
  `
}

function removeCandidateResume() {
  candidateResume = null
  document.getElementById('c-file-list').innerHTML = ''
}

// ── Check Fit ───────────────────────────────────────────────────────────────
async function handleCandidateCheck() {
  const jd = document.getElementById('c-jd-input').value.trim()
  const errEl = document.getElementById('c-error-msg')
  errEl.textContent = ''

  if (!jd) { errEl.textContent = 'Please paste a job description.'; return }
  if (!candidateResume) { errEl.textContent = 'Please upload your resume.'; return }
  if (!requireApiKey()) return

  const btn = document.getElementById('c-check-btn')
  btn.disabled = true
  btn.innerHTML = '<span class="spinner"></span> Checking your fit...'

  try {
    const res = await fetch(`${API}/api/screen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_description: jd,
        resumes: [candidateResume],
        weights: weights,
        api_key: getApiKey(),
        provider: getProvider()
      })
    })

    const data = await res.json()
    if (!res.ok) throw new Error(data.detail || 'Analysis failed')
    showCandidateResult(data.candidates[0])
  } catch (err) {
    errEl.textContent = err.message || 'Something went wrong.'
  } finally {
    btn.disabled = false
    btn.innerHTML = 'Check My Fit'
  }
}

// ── Views ───────────────────────────────────────────────────────────────────
function showCandidateResult(c) {
  document.getElementById('candidate-upload').classList.add('hidden')
  document.getElementById('candidate-result').classList.remove('hidden')

  const color = REC_COLORS[c.recommendation] || '#7c6aff'

  document.getElementById('c-result-card').innerHTML = buildCard(c, 1).replace(
    '<p class="sg-title" style="color:#ff6a6a">GAPS</p>',
    '<p class="sg-title" style="color:#ff6a6a">ADD TO RESUME</p>'
  )
}

function showCandidateUpload() {
  document.getElementById('candidate-upload').classList.remove('hidden')
  document.getElementById('candidate-result').classList.add('hidden')
}

// Called when user changes settings mid-session
function onSettingsChanged() {
  renderNavbar('candidate')
}
