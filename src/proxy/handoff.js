const { createBot } = require('../bot')

// respawn excluded: transient event, client.world goes null mid-init.
// position excluded: bot already confirmed the teleportId; replaying it causes
//   the client to send a duplicate teleport_confirm → rubber-banding.
const PINNED = new Set([
  'login', 'spawn_position', 'abilities', 'held_item_slot', 'game_state_change',
  'experience', 'initialize_world_border', 'playerlist_header', 'difficulty',
])

const BUFFERED = new Set([
  'health', 'update_time', 'player_info',
  'window_items', 'scoreboard_objective', 'display_scoreboard', 'scoreboard_score',
  'teams', 'boss_bar', 'update_view_position',
])

function createHandoff(upstream, emitter, initialLoginPacket) {
  let bot = null
  let client = null
  // login arrives before _bufferListener is attached — seed it from the captured event.
  const pinned = initialLoginPacket ? { login: initialLoginPacket } : {}
  const packetBuffer = new Map() // name → {data, meta} — keeps only latest per type
  const MAX_CHUNKS = 4096
  const chunkCache = {}
  const entityCache = new Map() // entityId → { spawn, metadata, equipment }
  let destroyed = false
  let lastPosition = null

  function _bufferListener(data, meta) {
    if (meta.name === 'position') lastPosition = { x: data.x, y: data.y, z: data.z, yaw: data.yaw, teleportId: data.teleportId }
    if (PINNED.has(meta.name)) {
      pinned[meta.name] = { data, meta }
    } else if (BUFFERED.has(meta.name)) {
      packetBuffer.set(meta.name, { data, meta })
    } else if (meta.name === 'spawn_entity') {
      entityCache.set(data.entityId, { spawn: { ...data } })
    } else if (meta.name === 'entity_teleport') {
      const e = entityCache.get(data.entityId)
      if (e) Object.assign(e.spawn, { x: data.x, y: data.y, z: data.z, yaw: data.yaw, pitch: data.pitch })
    } else if (meta.name === 'entity_metadata') {
      const e = entityCache.get(data.entityId)
      if (e) e.metadata = data
    } else if (meta.name === 'entity_equipment') {
      const e = entityCache.get(data.entityId)
      if (e) e.equipment = data
    } else if (meta.name === 'entity_destroy') {
      for (const id of (data.entityIds ?? [])) entityCache.delete(id)
    } else if (meta.name === 'map_chunk') {
      const key = `${data.x},${data.z}`
      if (!chunkCache[key] && Object.keys(chunkCache).length >= MAX_CHUNKS)
        delete chunkCache[Object.keys(chunkCache)[0]]
      chunkCache[key] = chunkCache[key] || {}
      chunkCache[key].chunk = { data, meta }
    } else if (meta.name === 'update_light') {
      const key = `${data.x},${data.z}`
      chunkCache[key] = chunkCache[key] || {}
      chunkCache[key].light = { data, meta }
    } else if (meta.name === 'unload_chunk') {
      delete chunkCache[`${data.x},${data.z}`]
    }
  }

  upstream.on('packet', _bufferListener)

  function startBotMode() {
    bot = createBot(upstream, emitter)
  }

  function attachClient(downstreamClient, checkAuth = null) {
    if (client === downstreamClient) return  // same client re-joining after reconfiguration
    if (client) { downstreamClient.end('Another client already connected'); return }

    client = downstreamClient
    emitter.emit('player_connected')

    if (bot) { bot.detach(); bot = null }

    // Critical init packets must arrive in this order.
    const replayOrder = [
      'login', 'spawn_position', 'game_state_change', 'abilities', 'held_item_slot',
      'experience', 'initialize_world_border', 'difficulty', 'playerlist_header',
    ]
    for (const name of replayOrder) {
      if (pinned[name]) try { client.write(name, pinned[name].data) } catch (_) {}
    }

    // Position must arrive before chunks so the client knows which chunk to wait for.
    if (lastPosition) {
      try {
        client.write('position', {
          x: lastPosition.x, y: lastPosition.y, z: lastPosition.z,
          yaw: lastPosition.yaw ?? 0, pitch: 0,
          flags: 0, teleportId: lastPosition.teleportId ?? 0,
        })
      } catch (_) {}
    }

    // chunk cache center — client uses this to know which chunk covers the player.
    if (packetBuffer.has('update_view_position')) {
      try { client.write('update_view_position', packetBuffer.get('update_view_position').data) } catch (_) {}
    }

    // Replay cached chunks. LEVEL_CHUNKS_LOAD_START (reason 13) primes the client's
    // loading-screen countdown; without it the client may never dismiss Loading Terrain.
    const chunkEntries = Object.values(chunkCache)
    const chunkDataEntries = chunkEntries.filter(e => e.chunk)
    for (const entry of chunkEntries) {
      if (entry.light) try { client.write('update_light', entry.light.data) } catch (_) {}
    }
    if (chunkDataEntries.length > 0) {
      try { client.write('game_state_change', { reason: 13, gameMode: 0 }) } catch (_) {}
      try { client.write('chunk_batch_start', {}) } catch (_) {}
      for (const entry of chunkDataEntries) {
        try { client.write('map_chunk', entry.chunk.data) } catch (_) {}
      }
      try { client.write('chunk_batch_finished', { batchSize: chunkDataEntries.length }) } catch (_) {}
    }
    const posStr = lastPosition ? `${lastPosition.x.toFixed(1)},${lastPosition.y.toFixed(1)},${lastPosition.z.toFixed(1)}` : 'null'
    console.log(`[handoff] replayed ${chunkEntries.length} chunks, ${entityCache.size} entities, pos=${posStr}`)

    for (const e of entityCache.values()) {
      try { client.write('spawn_entity', e.spawn) } catch (_) {}
      if (e.metadata) try { client.write('entity_metadata', e.metadata) } catch (_) {}
      if (e.equipment) try { client.write('entity_equipment', e.equipment) } catch (_) {}
    }

    for (const { data, meta } of packetBuffer.values()) {
      try { client.write(meta.name, data) } catch (_) {}
    }

    // Packets needed to load terrain — allowed through before auth so the client
    // can dismiss "Loading Terrain" and open the chat to type the password.
    const ALLOW_BEFORE_AUTH = new Set([
      'map_chunk', 'update_light', 'unload_chunk', 'position',
      'chunk_batch_start', 'chunk_batch_finished',
    ])

    function upstreamToClient(data, meta) {
      if (!client || destroyed) return
      if (meta.name === 'start_configuration') {
        // MC client pipelines handle start_configuration at the Netty level — we can't
        // proxy the config phase through a connected client. Disconnect gracefully;
        // the upstream NMP client handles the config phase automatically, and the
        // player can reconnect once the proxy reaches in_game state.
        client.end('Entering game — reconnect in a few seconds')
        return
      }
      if (!authorized && !ALLOW_BEFORE_AUTH.has(meta.name)) return
      try { client.write(meta.name, data) } catch (_) {}
    }

    // When checkAuth is provided, block client→upstream packets until password is
    // entered — except teleport_confirm which must flow to keep 2b2t position sync.
    let authorized = !checkAuth
    function clientToUpstream(data, meta) {
      if (!authorized && meta.name !== 'teleport_confirm' && meta.name !== 'chunk_batch_received') return
      if (!destroyed) try { upstream.write(meta.name, data) } catch (_) {}
    }

    if (checkAuth) {
      try {
        client.write('system_chat', {
          content: { type: 'compound', value: { text: { type: 'string', value: '[Proxy] Enter password in chat to play' } } },
          isActionBar: false,
        })
      } catch (_) {}

      // Timer starts on the first real movement packet — that only fires after Loading
      // Terrain clears, so the user always gets the full 120s from when they can type.
      let authTimer = null
      function onAuthPacket(data, meta) {
        if (meta.name === 'teleport_confirm' || meta.name === 'chunk_batch_received') return
        if (!authTimer) authTimer = setTimeout(() => {
          if (client) client.removeListener('packet', onAuthPacket)
          if (client) client.end('Password timeout')
        }, 120_000)
        if (meta.name !== 'chat_message') return
        client.removeListener('packet', onAuthPacket)
        clearTimeout(authTimer)
        if (checkAuth(data.message)) {
          authorized = true
          try {
            client.write('system_chat', {
              content: { type: 'compound', value: {
                text:  { type: 'string', value: '[Proxy] ' },
                color: { type: 'string', value: 'gray' },
                extra: { type: 'list', value: { type: 'compound', value: [
                  { text: { type: 'string', value: 'Authenticated' }, color: { type: 'string', value: 'green' } },
                ] } },
              } },
              isActionBar: false,
            })
          } catch (_) {}
        } else {
          client.end('Wrong password')
        }
      }
      client.on('packet', onAuthPacket)
    }

    upstream.on('packet', upstreamToClient)
    client.on('packet', clientToUpstream)

    let gone = false
    function onClientGone() {
      if (gone) return
      gone = true
      upstream.removeListener('packet', upstreamToClient)
      client = null
      emitter.emit('player_disconnected')
      if (!destroyed) bot = createBot(upstream, emitter, lastPosition)
    }

    client.on('end', onClientGone)
    client.on('error', onClientGone)
  }

  function destroy() {
    destroyed = true
    upstream.removeListener('packet', _bufferListener)
    if (bot) { bot.detach(); bot = null }
    // Null client before end() so the deferred socket close doesn't trigger onClientGone.
    if (client) { const c = client; client = null; c.end('Proxy stopped') }
    packetBuffer.clear()
    entityCache.clear()
  }

  function updatePinnedLogin(loginPacket) {
    pinned.login = loginPacket
  }

  return { startBotMode, attachClient, updatePinnedLogin, destroy }
}

module.exports = { createHandoff }
