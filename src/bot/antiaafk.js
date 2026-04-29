// Anti-AFK tick — called every INTERVAL ms while the bot is in-game.
// The bot object is a full Mineflayer bot instance.
// Available: bot.setControlState(action, bool), bot.look(yaw, pitch, force),
//            bot.chat(msg), bot.jump(), bot.entity.yaw
//
// TODO: implement your movement pattern here (5-10 lines)
function tick(bot, state) {

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
