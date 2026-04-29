const { createQueueWatcher } = require('./queue')
const { startAntiAfk, stopAntiAfk } = require('./antiaafk')

function createBot(upstream, emitter) {
  let detached = false
  let afkInterval = null
  let hasSeenQueue = false
  let lastQueueUpdate = 0

  const queueWatcher = createQueueWatcher(upstream)
  const fakeBot = createFakeBot(upstream)

  const queuePoll = setInterval(() => {
    if (detached) return
    const pos = queueWatcher.getPosition()
    if (pos !== null) {
      hasSeenQueue = true
      lastQueueUpdate = Date.now()
      emitter.emit('queue_position', pos)
    } else if (hasSeenQueue && Date.now() - lastQueueUpdate > 60_000) {
      // Queue was active but position gone for 60s — we're through
      console.log('[bot] queue finished — in game')
      emitter.emit('in_game')
      clearInterval(queuePoll)
      afkInterval = startAntiAfk(fakeBot)
      hasSeenQueue = false
    }
  }, 5000)

  function onHealth(packet) {
    if (detached || packet.health <= 0) return
    // Only trigger auto-respawn in-game, not during queue
  }

  function onDeath(packet) {
    if (detached || packet.health > 0) return
    console.log('[bot] died — respawning')
    setTimeout(() => {
      if (!detached) upstream.write('client_command', { payload: 0 })
    }, 1000)
  }

  // Must acknowledge server-sent position teleports or 2b2t resets position
  function onPosition(packet) {
    if (detached) return
    if (packet.teleportId != null)
      upstream.write('teleport_confirm', { teleportId: packet.teleportId })
    fakeBot._update(packet.x, packet.y, packet.z, packet.yaw)
  }

  upstream.on('update_health', onDeath)
  upstream.on('position', onPosition)

  function detach() {
    detached = true
    clearInterval(queuePoll)
    if (afkInterval) { stopAntiAfk(afkInterval); afkInterval = null }
    upstream.removeListener('update_health', onDeath)
    upstream.removeListener('position', onPosition)
    queueWatcher.destroy()
  }

  return { detach }
}

function createFakeBot(upstream) {
  let pos = null
  let yawDeg = 0

  return {
    _update(x, y, z, yaw) {
      pos = { x, y, z }
      yawDeg = yaw ?? yawDeg
    },
    look(yaw, pitch) {
      yawDeg = ((yaw * 180 / Math.PI) % 360 + 360) % 360
      upstream.write('look', {
        yaw: yawDeg,
        pitch: pitch * 180 / Math.PI,
        onGround: true,
      })
    },
    setControlState(action, value) {
      if (!value || !pos) return
      const yawRad = yawDeg * Math.PI / 180
      if (action === 'forward') {
        pos.x -= Math.sin(yawRad) * 0.15
        pos.z += Math.cos(yawRad) * 0.15
        upstream.write('position', { x: pos.x, y: pos.y, z: pos.z, onGround: true })
      }
      if (action === 'jump') {
        upstream.write('position', { x: pos.x, y: pos.y + 0.42, z: pos.z, onGround: false })
      }
    },
  }
}

module.exports = { createBot }
