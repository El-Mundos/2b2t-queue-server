const { createBot } = require('../bot')

// Packets we capture from upstream to replay on client connect (world state)
const BUFFER_PACKETS = new Set([
  'login', 'respawn', 'position', 'health', 'game_state_change',
  'update_time', 'spawn_position', 'player_info', 'abilities',
  'held_item_slot', 'entity_equipment', 'window_items',
  'scoreboard_objective', 'display_scoreboard', 'scoreboard_score',
  'teams', 'boss_bar',
])

function createHandoff(upstream, emitter) {
  let bot = null
  let client = null
  let packetBuffer = []
  let destroyed = false

  // Capture world state packets to replay when player connects
  function _bufferListener(data, meta) {
    if (BUFFER_PACKETS.has(meta.name)) {
      packetBuffer.push({ data, meta })
      if (packetBuffer.length > 500) packetBuffer.shift()
    }
  }

  upstream.on('packet', _bufferListener)

  function startBotMode() {
    bot = createBot(upstream, emitter)
  }

  function attachClient(downstreamClient) {
    if (client) {
      downstreamClient.end('Another client already connected')
      return
    }

    client = downstreamClient
    emitter.emit('player_connected')

    // Step bot aside
    if (bot) { bot.detach(); bot = null }

    // Replay buffered world state so client doesn't see black screen
    for (const { data, meta } of packetBuffer) {
      try { client.write(meta.name, data) } catch (_) {}
    }

    // Passthrough: upstream → client
    function upstreamToClient(data, meta) {
      if (client && !destroyed) {
        try { client.write(meta.name, data) } catch (_) {}
      }
    }

    // Passthrough: client → upstream
    function clientToUpstream(data, meta) {
      if (!destroyed) {
        try { upstream.write(meta.name, data) } catch (_) {}
      }
    }

    upstream.on('packet', upstreamToClient)
    client.on('packet', clientToUpstream)

    client.on('end', () => {
      upstream.removeListener('packet', upstreamToClient)
      client = null
      emitter.emit('player_disconnected')

      if (!destroyed) {
        bot = createBot(upstream, emitter)
      }
    })

    client.on('error', () => {
      upstream.removeListener('packet', upstreamToClient)
      client = null
      if (!destroyed) {
        bot = createBot(upstream, emitter)
      }
    })
  }

  function destroy() {
    destroyed = true
    upstream.removeListener('packet', _bufferListener)
    if (bot) { bot.detach(); bot = null }
    if (client) { client.end('Proxy stopped'); client = null }
    packetBuffer = []
  }

  return { startBotMode, attachClient, destroy }
}

module.exports = { createHandoff }
