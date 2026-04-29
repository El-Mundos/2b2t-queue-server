// Anti-AFK tick — called every INTERVAL ms while the bot is in-game.
// The bot object is a full Mineflayer bot instance.
// Available: bot.setControlState(action, bool), bot.look(yaw, pitch, force),
//            bot.chat(msg), bot.jump(), bot.entity.yaw
//
function tick(bot, state) {
  // Rotate to a random yaw each tick so the bot looks alive
  const yaw = Math.random() * Math.PI * 2
  const pitch = (Math.random() - 0.5) * 0.6
  bot.look(yaw, pitch, true)

  // Walk forward briefly, jump sometimes, then stop
  bot.setControlState('forward', true)
  if (Math.random() > 0.5) bot.setControlState('jump', true)

  setTimeout(() => {
    bot.setControlState('forward', false)
    bot.setControlState('jump', false)
  }, 1500 + Math.random() * 1000)

  state.tick++
}

// ─── runtime — no changes needed below ───────────────────────────────────────

const INTERVAL = 30_000 // ms between ticks

function startAntiAfk(bot) {
  const state = { tick: 0 }
  const id = setInterval(() => tick(bot, state), INTERVAL)
  return id
}

function stopAntiAfk(id) {
  clearInterval(id)
}

module.exports = { startAntiAfk, stopAntiAfk }
