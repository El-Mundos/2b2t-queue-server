const etaEl    = document.getElementById('queue-eta')
const pill     = document.getElementById('status-pill')
const queueEl  = document.getElementById('queue-number')
const stateEl  = document.getElementById('state-value')
const wsEl     = document.getElementById('ws-status')
const btnStart = document.getElementById('btn-start')
const btnStop  = document.getElementById('btn-stop')
const authCard = document.getElementById('auth-card')
const authCode = document.getElementById('auth-code')
const authUrl  = document.getElementById('auth-url')
const authExp  = document.getElementById('auth-expires')

let currentState = 'idle'
let authExpireTimer = null

function showAuthCard(data) {
  authCode.textContent = data.userCode
  authUrl.href = data.verificationUri
  authCard.style.display = 'flex'

  clearInterval(authExpireTimer)
  let remaining = data.expiresIn
  authExp.textContent = `Expires in ${remaining}s`
  authExpireTimer = setInterval(() => {
    remaining--
    if (remaining <= 0) { clearInterval(authExpireTimer); authExp.textContent = 'Code expired'; return }
    authExp.textContent = `Expires in ${remaining}s`
  }, 1000)
}

function hideAuthCard() {
  authCard.style.display = 'none'
  clearInterval(authExpireTimer)
}

function copyCode() {
  navigator.clipboard.writeText(authCode.textContent)
  authCode.textContent = 'Copied!'
  setTimeout(() => { authCode.textContent = authCode.dataset.code }, 1200)
}

function applyState(state, queuePosition, queueEta) {
  currentState = state
  if (state !== 'connecting') hideAuthCard()

  pill.textContent = state.replace('_', ' ')
  pill.className = 'status-pill ' + state
  stateEl.textContent = state.replace(/_/g, ' ')

  const active = state !== 'idle'
  btnStart.disabled = active
  btnStop.disabled = !active

  if (state === 'queuing') {
    if (queuePosition != null) {
      queueEl.textContent = queuePosition.toLocaleString()
      queueEl.className = 'queue-number'
    }
    etaEl.textContent = queueEta != null ? queueEta : '—'
    etaEl.className = 'queue-eta'
  } else if (state === 'in_game' || state === 'player_connected') {
    queueEl.textContent = 'in game'
    queueEl.className = 'queue-number in-game'
    etaEl.textContent = 'in game'
    etaEl.className = 'queue-eta in-game'
  } else {
    queueEl.textContent = '—'
    queueEl.className = 'queue-number none'
    etaEl.textContent = '—'
    etaEl.className = 'queue-eta none'
  }
}

function handleMessage(msg) {
  if (msg.type === 'auth_code') {
    showAuthCard(msg)
    authCode.dataset.code = msg.userCode
  } else if (msg.type === 'state') {
    applyState(msg.state, msg.queuePosition, msg.queueEta)
  } else if (msg.type === 'queue_position') {
    if (currentState === 'queuing') {
      queueEl.textContent = msg.position.toLocaleString()
      queueEl.className = 'queue-number'
      if (msg.eta != null) {
        etaEl.textContent = msg.eta
        etaEl.className = 'queue-eta'
      }
    }
  } else if (msg.type === 'in_game') {
    applyState('in_game', null, null)
  } else if (msg.type === 'player_connected') {
    applyState('player_connected', null, null)
  } else if (msg.type === 'player_disconnected') {
    applyState(currentState === 'player_connected' ? 'in_game' : currentState, null, null)
  }
}

// WebSocket with exponential backoff reconnect
let retryDelay = 1000
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${proto}://${location.host}`)

  ws.onopen = () => {
    wsEl.textContent = 'live'
    retryDelay = 1000
  }

  ws.onmessage = (e) => {
    try { handleMessage(JSON.parse(e.data)) } catch (_) {}
  }

  ws.onclose = ws.onerror = () => {
    wsEl.textContent = 'reconnecting…'
    setTimeout(connect, retryDelay)
    retryDelay = Math.min(retryDelay * 2, 30000)
  }
}

async function apiCall(action) {
  await fetch(`/api/${action}`, { method: 'POST' })
}

async function generateToken() {
  const btn = document.getElementById('btn-token')
  const display = document.getElementById('token-display')
  const value = document.getElementById('token-value')

  btn.disabled = true
  btn.textContent = 'Generating…'

  const res = await fetch('/api/generate-token', { method: 'POST' })
  const { token } = await res.json()

  value.textContent = token
  display.classList.remove('fading')
  display.style.display = 'block'
  requestAnimationFrame(() => display.classList.add('visible'))

  navigator.clipboard.writeText(token).catch(() => {})

  btn.textContent = 'Copied!'
  setTimeout(() => {
    btn.disabled = false
    btn.textContent = 'Generate & copy'
  }, 3000)

  // Fade out the display after 8 seconds
  setTimeout(() => {
    display.classList.add('fading')
    display.addEventListener('transitionend', () => {
      display.style.display = 'none'
      display.classList.remove('visible', 'fading')
    }, { once: true })
  }, 8000)
}

connect()
