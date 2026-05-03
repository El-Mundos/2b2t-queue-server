const { createBot } = require('../bot')

// respawn excluded: transient event, client.world goes null mid-init.
// position excluded: bot already confirmed the teleportId; replaying it causes
//   the client to send a duplicate teleport_confirm → rubber-banding.
const PINNED = new Set([
  'login', 'spawn_position', 'abilities', 'held_item_slot', 'game_state_change',
  'experience', 'initialize_world_border', 'playerlist_header', 'difficulty',
])

const BUFFERED = new Set([
  'health', 'update_time', 'player_info', 'entity_equipment',
  'window_items', 'scoreboard_objective', 'display_scoreboard', 'scoreboard_score',
  'teams', 'boss_bar',
])

function createHandoff(upstream, emitter, initialLoginPacket) {
  let bot = null
  let client = null
  // login arrives before _bufferListener is attached — seed it from the captured event.
  const pinned = initialLoginPacket ? { login: initialLoginPacket } : {}
  let packetBuffer = []
  const chunkCache = {}
  let destroyed = false

  function _bufferListener(data, meta) {
    if (PINNED.has(meta.name)) {
      pinned[meta.name] = { data, meta }
    } else if (BUFFERED.has(meta.name)) {
      packetBuffer.push({ data, meta })
      if (packetBuffer.length > 500) packetBuffer.shift()
    } else if (meta.name === 'map_chunk') {
      const key = `${data.x},${data.z}`
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

  function attachClient(downstreamClient) {
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

    // Replay cached chunks: light first, then chunk data.
    const chunkEntries = Object.values(chunkCache)
    for (const entry of chunkEntries) {
      if (entry.light) try { client.write('update_light', entry.light.data) } catch (_) {}
    }
    for (const entry of chunkEntries) {
      if (entry.chunk) try { client.write('map_chunk', entry.chunk.data) } catch (_) {}
    }
    console.log(`[handoff] replayed ${chunkEntries.length} chunks`)

    for (const { data, meta } of packetBuffer) {
      try { client.write(meta.name, data) } catch (_) {}
    }

    let inConfigPhase = false

    function upstreamToClient(data, meta) {
      if (!client || destroyed) return
      try { client.write(meta.name, data) } catch (_) {}
      if (meta.name === 'start_configuration') {
        client.state = 'configuration'
        inConfigPhase = true
      } else if (meta.name === 'finish_configuration') {
        client.state = 'play'
        inConfigPhase = false
      }
    }

    // During config phase NMP's internal state machine handles the client's
    // config responses (configuration_acknowledged, select_known_packs, etc.).
    // Forwarding them here too would send duplicates to Velocity.
    function clientToUpstream(data, meta) {
      if (!destroyed && !inConfigPhase) try { upstream.write(meta.name, data) } catch (_) {}
    }

    upstream.on('packet', upstreamToClient)
    client.on('packet', clientToUpstream)

    function onClientGone() {
      upstream.removeListener('packet', upstreamToClient)
      client = null
      emitter.emit('player_disconnected')
      if (!destroyed) bot = createBot(upstream, emitter)
    }

    client.on('end', onClientGone)
    client.on('error', onClientGone)
  }

  function destroy() {
    destroyed = true
    upstream.removeListener('packet', _bufferListener)
    if (bot) { bot.detach(); bot = null }
    if (client) { client.end('Proxy stopped'); client = null }
    packetBuffer = []
  }

  function updatePinnedLogin(loginPacket) {
    pinned.login = loginPacket
  }

  return { startBotMode, attachClient, updatePinnedLogin, destroy }
}

module.exports = { createHandoff }
