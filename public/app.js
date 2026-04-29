const pill    = document.getElementById('status-pill')
const queueEl = document.getElementById('queue-number')
const stateEl = document.getElementById('state-value')
const wsEl    = document.getElementById('ws-status')
const btnStart = document.getElementById('btn-start')
const btnStop  = document.getElementById('btn-stop')

let currentState = 'idle'

function applyState(state, queuePosition) {
  currentState = state

  pill.textContent = state.replace('_', ' ')
  pill.className = 'status-pill ' + state
  stateEl.textContent = state.replace(/_/g, ' ')

  const active = state !== 'idle'
  btnStart.disabled = active
  btnStop.disabled = !active

  if (state === 'queuing' && queuePosition != null) {
    queueEl.textContent = queuePosition.toLocaleString()
    queueEl.className = 'queue-number'
  } else if (state === 'in_game' || state === 'player_connected') {
    queueEl.textContent = 'in game'
    queueEl.className = 'queue-number in-game'
  } else {
    queueEl.textContent = '—'
    queueEl.className = 'queue-number none'
  }
}

function handleMessage(msg) {
  if (msg.type === 'state') {
    applyState(msg.state, msg.queuePosition)
  } else if (msg.type === 'queue_position') {
    if (currentState === 'queuing') {
      queueEl.textContent = msg.position.toLocaleString()
      queueEl.className = 'queue-number'
    }
  } else if (msg.type === 'in_game') {
    applyState('in_game', null)
  } else if (msg.type === 'player_connected') {
    applyState('player_connected', null)
  } else if (msg.type === 'player_disconnected') {
    applyState(currentState === 'player_connected' ? 'in_game' : currentState, null)
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

connect()
