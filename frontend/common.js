const API = 'http://localhost:8001'

// ── Provider Config ─────────────────────────────────────────────────────────
const PROVIDER_INFO = {
  groq:      { placeholder: 'gsk_...',          label: 'Groq',   model: 'llama-3.3-70b', hint: 'Get key at <a href="https://console.groq.com/" target="_blank">console.groq.com</a>' },
  gemini:    { placeholder: 'AIzaSy...',        label: 'Gemini', model: 'gemini-2.0-flash', hint: 'Get key at <a href="https://aistudio.google.com/apikey" target="_blank">aistudio.google.com</a>' },
  openai:    { placeholder: 'sk-proj-...',      label: 'OpenAI', model: 'gpt-4o-mini', hint: 'Get key at <a href="https://platform.openai.com/api-keys" target="_blank">platform.openai.com</a>' },
  anthropic: { placeholder: 'sk-ant-api03-...', label: 'Claude', model: 'claude-sonnet', hint: 'Get key at <a href="https://console.anthropic.com/" target="_blank">console.anthropic.com</a>' },
}

const REC_COLORS = {
  'Strong Yes': '#4ade80',
  'Yes': '#7c6aff',
  'Maybe': '#facc15',
  'No': '#ff6a6a'
}

// ── Session State ───────────────────────────────────────────────────────────
function getApiKey()  { return sessionStorage.getItem('screeniq_key') || '' }
function getProvider() { return sessionStorage.getItem('screeniq_provider') || 'groq' }

function setApiKey(key)      { sessionStorage.setItem('screeniq_key', key) }
function setProvider(provider) { sessionStorage.setItem('screeniq_provider', provider) }

function hasApiKey() { return !!getApiKey() }

function requireApiKey() {
  if (!hasApiKey()) {
    openSettingsModal()
    return false
  }
  return true
}

// ── Navigation Bar ──────────────────────────────────────────────────────────
function renderNavbar(activePage) {
  const nav = document.getElementById('navbar')
  if (!nav) return

  const provider = getProvider()
  const info = PROVIDER_INFO[provider]

  nav.innerHTML = `
    <div class="nav-left">
      <a href="index.html" class="nav-logo">Screen<span>IQ</span></a>
      <div class="nav-links">
        <a href="index.html" class="nav-link ${activePage === 'home' ? 'active' : ''}">Home</a>
        <a href="recruiter.html" class="nav-link ${activePage === 'recruiter' ? 'active' : ''}">Recruiter</a>
        <a href="candidate.html" class="nav-link ${activePage === 'candidate' ? 'active' : ''}">Candidate</a>
      </div>
    </div>
    <div class="nav-right">
      ${hasApiKey() ? `<span class="nav-provider-badge">${info.label} · ${info.model}</span>` : ''}
      <button class="nav-settings-btn" onclick="openSettingsModal()">
        ${hasApiKey() ? 'Settings' : 'Set API Key'}
      </button>
    </div>
  `
}

// ── Settings Modal ──────────────────────────────────────────────────────────
function renderSettingsModal() {
  if (document.getElementById('settings-modal')) return

  const overlay = document.createElement('div')
  overlay.id = 'settings-modal'
  overlay.className = 'modal-overlay'
  overlay.innerHTML = `
    <div class="modal">
      <h2>Settings</h2>

      <div class="modal-section">
        <label>LLM Provider</label>
        <div class="provider-grid" id="modal-provider-grid"></div>
      </div>

      <div class="modal-section">
        <label>API Key</label>
        <input type="password" id="modal-api-key" class="input-field" />
        <p class="hint-text" id="modal-hint"></p>
      </div>

      <div class="modal-actions">
        <button class="btn-cancel" onclick="closeSettingsModal()">Cancel</button>
        <button class="btn-save" onclick="saveSettings()">Save</button>
      </div>
    </div>
  `
  document.body.appendChild(overlay)

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeSettingsModal()
  })
}

let _modalProvider = null

function openSettingsModal() {
  renderSettingsModal()

  _modalProvider = getProvider()
  const modal = document.getElementById('settings-modal')
  const grid = document.getElementById('modal-provider-grid')

  // Render provider buttons
  grid.innerHTML = Object.entries(PROVIDER_INFO).map(([key, info]) => `
    <button class="provider-btn ${key === _modalProvider ? 'selected' : ''}"
            data-provider="${key}" onclick="selectModalProvider('${key}')">
      <span class="provider-name">${info.label}</span>
      <span class="provider-model">${info.model}</span>
    </button>
  `).join('')

  // Fill current key
  document.getElementById('modal-api-key').value = getApiKey()
  updateModalHint()

  modal.classList.add('open')
}

function selectModalProvider(provider) {
  _modalProvider = provider
  document.querySelectorAll('#modal-provider-grid .provider-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.provider === provider)
  })
  document.getElementById('modal-api-key').placeholder = PROVIDER_INFO[provider].placeholder
  updateModalHint()
}

function updateModalHint() {
  document.getElementById('modal-hint').innerHTML = PROVIDER_INFO[_modalProvider].hint
}

function saveSettings() {
  const key = document.getElementById('modal-api-key').value.trim()
  if (!key) { alert('Please enter an API key'); return }

  setApiKey(key)
  setProvider(_modalProvider)
  closeSettingsModal()
  renderNavbar(getCurrentPage())

  // Notify page-specific code
  if (typeof onSettingsChanged === 'function') onSettingsChanged()
}

function closeSettingsModal() {
  const modal = document.getElementById('settings-modal')
  if (modal) modal.classList.remove('open')
}

function getCurrentPage() {
  const path = window.location.pathname
  if (path.includes('recruiter')) return 'recruiter'
  if (path.includes('candidate')) return 'candidate'
  return 'home'
}

// ── Card Builder (shared between recruiter & candidate) ─────────────────────
function buildCard(c, rank) {
  const color = REC_COLORS[c.recommendation] || '#7c6aff'
  const initials = c.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()

  const skillsHtml = (c.top_skills || []).map(s => `<span class="skill-tag">${s}</span>`).join('')
  const strengthsHtml = (c.strengths || []).map(s => `<p class="sg-item">↑ ${s}</p>`).join('')
  const gapsHtml = (c.gaps || []).map(g => `<p class="sg-item">↓ ${g}</p>`).join('')

  const biasHtml = c.bias_flags?.length ? `
    <div class="bias-box">
      <p class="bias-title">BIAS AUDIT</p>
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
        <span class="meta-text">${c.education}</span>
      </div>

      ${biasHtml}
    </div>
  `
}

// ── PDF Parse Helper ────────────────────────────────────────────────────────
async function parsePdf(file) {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch(`${API}/api/parse-pdf`, { method: 'POST', body: formData })
  return await res.json()
}

// ── Init navbar on every page ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderNavbar(getCurrentPage())
})
