// Strips Minecraft color/format codes (§X)
function stripColor(str) {
  return str.replace(/§./g, '')
}

function parseQueuePosition(bot) {
  const sb = bot.scoreboard
  if (!sb) return null

  // Find the sidebar display objective
  const sidebarName = sb.sidebar
  if (!sidebarName) return null

  const objective = sb[sidebarName]
  if (!objective) return null

  // Score entries are keyed by their display name (which contains the position number)
  // 2b2t puts the queue number as a score *name* entry, value is the display order
  for (const itemName of Object.keys(objective.itemsMap || {})) {
    const clean = stripColor(itemName).trim()
    if (/^\d+$/.test(clean)) {
      return parseInt(clean, 10)
    }
  }

  return null
}

module.exports = { parseQueuePosition }
