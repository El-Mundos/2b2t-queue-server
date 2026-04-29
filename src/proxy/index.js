const mc = require('minecraft-protocol')
const EventEmitter = require('events')
const config = require('../config')
const { createHandoff } = require('./handoff')

const STATES = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  QUEUING: 'queuing',
  IN_GAME: 'in_game',
  PLAYER_CONNECTED: 'player_connected',
}

function createProxy() {
  const emitter = new EventEmitter()
  let upstream = null
  let downstreamServer = null
  let handoff = null
  let state = STATES.IDLE
  let queuePosition = null

  function setState(s, data = {}) {
    state = s
    emitter.emit('state', { state, queuePosition, ...data })
  }

  function start() {
    if (state !== STATES.IDLE) return
    setState(STATES.CONNECTING)

    upstream = mc.createClient({
      host: config.mc.host,
      port: config.mc.port,
      username: config.mc.username,
      password: config.mc.password,
      auth: config.mc.auth,
      version: config.mc.version,
      hideErrors: false,
      profilesFolder: '/app/auth',
      onMsaCode: (data) => {
        // Forward device code to dashboard so user can auth from the web UI
        emitter.emit('auth_code', {
          userCode: data.user_code,
          verificationUri: data.verification_uri,
          expiresIn: data.expires_in,
        })
      },
    })

    upstream.on('login', () => {
      setState(STATES.QUEUING)
      emitter.emit('upstream_ready', upstream)
    })

    upstream.on('disconnect', ({ reason }) => {
      console.log('[proxy] disconnected:', reason)
      _cleanup()
      setState(STATES.IDLE, { disconnectReason: reason })
    })

    upstream.on('end', () => {
      _cleanup()
      setState(STATES.IDLE)
    })

    upstream.on('error', (err) => {
      console.error('[proxy] upstream error:', err.message)
      _cleanup()
      setState(STATES.IDLE)
    })
  }

  function stop() {
    if (upstream) upstream.end('proxy stopped')
    _cleanup()
    setState(STATES.IDLE)
  }

  function _cleanup() {
    if (handoff) { handoff.destroy(); handoff = null }
    upstream = null
    queuePosition = null
  }

  function setQueuePosition(pos) {
    queuePosition = pos
    emitter.emit('state', { state, queuePosition })
  }

  function setInGame() {
    if (state === STATES.QUEUING) setState(STATES.IN_GAME)
  }

  function setPlayerConnected(connected) {
    setState(connected ? STATES.PLAYER_CONNECTED : state === STATES.QUEUING ? STATES.QUEUING : STATES.IN_GAME)
  }

  function startDownstreamServer() {
    downstreamServer = mc.createServer({
      'online-mode': false,
      port: config.proxy.port,
      version: config.mc.version,
      motd: '2b2t Queue Proxy',
      maxPlayers: 1,
    })

    downstreamServer.on('login', (client) => {
      const allowed = config.proxy.allowedIps
      if (allowed.length > 0 && !allowed.includes(client.socket.remoteAddress)) {
        client.end('Not allowed')
        return
      }

      if (!upstream || state === STATES.IDLE || state === STATES.CONNECTING) {
        client.end('Proxy not connected to 2b2t yet')
        return
      }

      if (handoff) handoff.attachClient(client)
    })

    console.log(`[proxy] listening on :${config.proxy.port}`)
  }

  emitter.on('upstream_ready', () => {
    handoff = createHandoff(upstream, emitter)
    handoff.startBotMode()
  })

  return {
    start,
    stop,
    startDownstreamServer,
    setQueuePosition,
    setInGame,
    setPlayerConnected,
    getState: () => ({ state, queuePosition }),
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    emit: emitter.emit.bind(emitter),
  }
}

module.exports = { createProxy, STATES }
