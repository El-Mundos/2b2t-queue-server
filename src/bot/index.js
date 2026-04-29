const mineflayer = require('mineflayer')
const { parseQueuePosition } = require('./queue')
const { startAntiAfk, stopAntiAfk } = require('./antiaafk')

function createBot(upstreamClient, emitter) {
  let detached = false
  let afkInterval = null

  const bot = mineflayer.createBot({
    client: upstreamClient,
    version: upstreamClient.version,
    // Prevent mineflayer from opening its own TCP connection
    connect: () => {},
  })

  // Poll scoreboard every 5s for queue position
  const queuePoll = setInterval(() => {
    if (detached) return
    const pos = parseQueuePosition(bot)
    if (pos !== null) {
      emitter.emit('queue_position', pos)
    }
  }, 5000)

  bot.on('spawn', () => {
    console.log('[bot] spawned — in game')
    emitter.emit('in_game')
    clearInterval(queuePoll)
    afkInterval = startAntiAfk(bot)
  })

  bot.on('death', () => {
    console.log('[bot] died — respawning')
    setTimeout(() => {
      if (!detached) bot.respawn()
    }, 1000)
  })

  bot.on('kicked', (reason) => {
    console.log('[bot] kicked:', reason)
  })

  bot.on('error', (err) => {
    console.error('[bot] error:', err.message)
  })

  function detach() {
    detached = true
    clearInterval(queuePoll)
    if (afkInterval) { stopAntiAfk(afkInterval); afkInterval = null }
    bot.removeAllListeners()
  }

  return { detach }
}

module.exports = { createBot }
