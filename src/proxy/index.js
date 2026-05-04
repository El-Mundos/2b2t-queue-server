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
  let capturedTags = null

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
      profilesFolder: process.env.AUTH_DIR || './auth',
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
      if (meta.name === 'start_configuration') capturedRegistries.length = 0
      if (meta.name === 'registry_data') capturedRegistries.push(data)
      if (meta.name === 'tags') capturedTags = data
    })

    // NMP emits 'login' before our 'packet' listener can see it — capture it here.
    // It also re-fires after 2b2t's start_configuration (queue→game transition) — guard that.
    upstream.on('login', (loginData) => {
      capturedLogin = { data: loginData, meta: { name: 'login' } }
      if (capturedRegistries.length > 0) {
        downstreamServer.options.registryCodec = Object.fromEntries(
          capturedRegistries.map((d, i) => [i, d])
        )
      }
      if (handoff) {
        // Reconfiguration: 2b2t cycled through config phase to enter the game.
        // Update the cached login packet so the next client connect gets the fresh one,
        // and mark as in_game whether or not a player is currently attached.
        handoff.updatePinnedLogin(capturedLogin)
        if (state === STATES.QUEUING || state === STATES.PLAYER_CONNECTED) {
          console.log('[proxy] reconfiguration — entered game')
          setInGame()
        }
        return
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
    _cleanup()
    setState(STATES.IDLE)
  }

  function _cleanup() {
    if (handoff) { handoff.destroy(); handoff = null }
    // Tear down the upstream object fully so stale event listeners don't
    // re-fire login after Velocity's recovery loop sends start_configuration.
    const _up = upstream
    upstream = null
    if (_up) { try { _up.removeAllListeners(); _up.end() } catch (_) {} }
    queuePosition = null
    queueEta = null
    preConnectionState = null
    capturedLogin = null
    capturedTags = null
  }

  function setInGame() {
    if (state === STATES.QUEUING) setState(STATES.IN_GAME)
    else if (state === STATES.PLAYER_CONNECTED) preConnectionState = STATES.IN_GAME
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
      // IP check and "not connected" kicks are deferred to playerJoin (PLAY state).
      // Calling client.end() here (configuration state) sends a login-state disconnect
      // packet (0x00) which the MC client decodes as cookie_request → crash.
      const allowed = config.proxy.allowedIps
      if (allowed.length > 0 && !allowed.includes(client.socket.remoteAddress)) {
        // Store flag; actual kick happens in playerJoin.
        client._notAllowed = true
        return
      }
      // NMP's configuration phase sends registry_data but not tags.
      // Intercept finish_configuration to inject the captured tags packet first.
      if (capturedTags) {
        const tags = capturedTags
        const orig = client.write.bind(client)
        client.write = function (name, data) {
          if (name === 'finish_configuration') {
            client.write = orig
            orig('tags', tags)
          }
          orig(name, data)
        }
      }
    })

    // 'playerJoin' fires after configuration completes (client in PLAY state).
    // Attaching here prevents play-state packets being forwarded during config phase.
    downstreamServer.on('playerJoin', (client) => {
      if (client._notAllowed) { client.end('Not allowed'); return }
      if (!upstream || !handoff) { client.end('Proxy not connected to 2b2t yet'); return }

      const password = config.proxy.password
      if (!password) { handoff.attachClient(client); return }

      client.write('system_chat', {
        content: JSON.stringify({ text: '[Proxy] ', color: 'gray', extra: [{ text: 'Enter password:', color: 'yellow' }] }),
        isActionBar: false,
      })

      const timer = setTimeout(() => {
        client.removeListener('packet', onPacket)
        client.end('Password timeout')
      }, 30_000)

      function onPacket(data, meta) {
        if (meta.name !== 'chat_message') return
        client.removeListener('packet', onPacket)
        clearTimeout(timer)
        if (data.message === password) {
          handoff.attachClient(client)
        } else {
          client.end('Wrong password')
        }
      }

      client.on('packet', onPacket)
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
  emitter.on('player_disconnected', () => {
    setPlayerConnected(false)
    // If returning to in_game, tell the newly-created bot to start anti-AFK.
    // setTimeout(0) lets onClientGone finish creating the bot first.
    if (state === STATES.IN_GAME) setTimeout(() => emitter.emit('in_game'), 0)
  })

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
