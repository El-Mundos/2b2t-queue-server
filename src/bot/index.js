const { createQueueWatcher } = require('./queue')
const { startAntiAfk, stopAntiAfk } = require('./antiaafk')

function createBot(upstream, emitter) {
  let detached = false
  let afkInterval = null
  let inGame = false

const queueWatcher = createQueueWatcher(upstream)
  const fakeBot = createFakeBot(upstream)

  const queuePoll = setInterval(() => {
    if (detached) return
    const pos = queueWatcher.getPosition()
    if (pos !== null) emitter.emit('queue_position', pos)
  }, 5000)

  function onHealth(packet) {
    if (detached) return
    if (!inGame) {
      inGame = true
      console.log('[bot] spawned — in game')
      emitter.emit('in_game')
      clearInterval(queuePoll)
      afkInterval = startAntiAfk(fakeBot)
    }
    if (packet.health <= 0) {
      console.log('[bot] died — respawning')
      setTimeout(() => {
        if (!detached) upstream.write('client_command', { payload: 0 })
      }, 1000)
    }
  }

  // Must acknowledge server-sent position teleports or 2b2t resets position
  function onPosition(packet) {
    if (detached) return
    if (packet.teleportId != null)
      upstream.write('teleport_confirm', { teleportId: packet.teleportId })
    fakeBot._update(packet.x, packet.y, packet.z, packet.yaw)
  }

  upstream.on('update_health', onHealth)
  upstream.on('position', onPosition)

  function detach() {
    detached = true
    clearInterval(queuePoll)
    if (afkInterval) { stopAntiAfk(afkInterval); afkInterval = null }
    upstream.removeListener('update_health', onHealth)
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
    // yaw/pitch in radians, matches mineflayer's bot.look() API
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
