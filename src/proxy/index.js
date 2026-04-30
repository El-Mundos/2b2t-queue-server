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
  let queueEta = null
  let preConnectionState = null
  let capturedLogin = null

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
        emitter.emit('auth_code', {
          userCode: data.user_code,
          verificationUri: data.verification_uri,
          expiresIn: data.expires_in,
        })
      },
    })

    const capturedRegistries = []
    upstream.on('packet', (data, meta) => {
      if (meta.name === 'registry_data') capturedRegistries.push(data)
    })

    // NMP emits 'login' before our 'packet' listener can see it — capture it here.
    upstream.on('login', (loginData) => {
      capturedLogin = { data: loginData, meta: { name: 'login' } }
      if (capturedRegistries.length > 0) {
        downstreamServer.options.registryCodec = Object.fromEntries(
          capturedRegistries.map((d, i) => [i, d])
        )
      }
      console.log('[proxy] connected to 2b2t — in queue')
      setState(STATES.QUEUING)
      emitter.emit('upstream_ready', upstream)
    })

    upstream.on('disconnect', ({ reason }) => {
      console.log('[proxy] disconnected:', reason)
      _cleanup()
      setState(STATES.IDLE, { disconnectReason: reason })
    })

    upstream.on('end', () => { _cleanup(); setState(STATES.IDLE) })
    upstream.on('error', (err) => { console.error('[proxy] upstream error:', err.message); _cleanup(); setState(STATES.IDLE) })
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
    queueEta = null
    preConnectionState = null
    capturedLogin = null
  }

  function setInGame() {
    if (state === STATES.QUEUING) setState(STATES.IN_GAME)
  }

  function setPlayerConnected(connected) {
    if (connected) {
      preConnectionState = state
      setState(STATES.PLAYER_CONNECTED)
    } else {
      setState(preConnectionState || STATES.QUEUING)
      preConnectionState = null
    }
  }

  function startDownstreamServer() {
    downstreamServer = mc.createServer({
      'online-mode': false,
      port: config.proxy.port,
      version: config.mc.version,
      motd: '2b2t Queue Proxy',
      maxPlayers: 1,
      // Use the real Mojang UUID so skin textures resolve correctly.
      beforeLogin: (client) => {
        if (upstream && upstream.uuid) client.uuid = upstream.uuid
      },
    })

    downstreamServer.on('login', (client) => {
      const allowed = config.proxy.allowedIps
      if (allowed.length > 0 && !allowed.includes(client.socket.remoteAddress)) {
        client.end('Not allowed')
        return
      }
      if (!upstream || state === STATES.IDLE || state === STATES.CONNECTING) {
        client.end('Proxy not connected to 2b2t yet')
      }
    })

    // 'playerJoin' fires after configuration completes (client in PLAY state).
    // Attaching here prevents play-state packets being forwarded during config phase.
    downstreamServer.on('playerJoin', (client) => {
      if (!upstream || !handoff) { client.end('Proxy not connected to 2b2t yet'); return }
      handoff.attachClient(client)
    })

    console.log(`[proxy] listening on :${config.proxy.port}`)
  }

  emitter.on('upstream_ready', () => {
    handoff = createHandoff(upstream, emitter, capturedLogin)
    handoff.startBotMode()
  })

  emitter.on('queue_position', (pos, eta) => { queuePosition = pos; queueEta = eta ?? queueEta })
  emitter.on('in_game', () => setInGame())
  emitter.on('player_connected', () => setPlayerConnected(true))
  emitter.on('player_disconnected', () => setPlayerConnected(false))

  return {
    start,
    stop,
    startDownstreamServer,
    getState: () => ({ state, queuePosition, queueEta }),
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    emit: emitter.emit.bind(emitter),
  }
}

module.exports = { createProxy, STATES }
