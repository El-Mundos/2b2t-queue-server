function createQueueWatcher(upstream) {
  const objectives = {}
  let sidebarObjective = null

  function onObjective(packet) {
    if (packet.action === 0) objectives[packet.name] = { scores: new Map() }
    else if (packet.action === 1) delete objectives[packet.name]
  }

  function onDisplay(packet) {
    // position 1 = sidebar
    if (packet.position === 1) sidebarObjective = packet.name
  }

  // 1.20.1+ packet name
  function onUpdateScore(packet) {
    if (objectives[packet.scoreName])
      objectives[packet.scoreName].scores.set(packet.itemName, packet.value)
  }

  // 1.20.1+ removal packet
  function onResetScore(packet) {
    if (packet.scoreName && objectives[packet.scoreName])
      objectives[packet.scoreName].scores.delete(packet.entityName)
  }

  upstream.on('scoreboard_objective', onObjective)
  upstream.on('display_scoreboard', onDisplay)
  upstream.on('update_score', onUpdateScore)
  upstream.on('reset_score', onResetScore)

  function getPosition() {
    if (!sidebarObjective || !objectives[sidebarObjective]) return null
    for (const name of objectives[sidebarObjective].scores.keys()) {
      const clean = name.replace(/§./g, '').trim()
      if (/^\d+$/.test(clean)) return parseInt(clean, 10)
    }
    return null
  }

  function destroy() {
    upstream.removeListener('scoreboard_objective', onObjective)
    upstream.removeListener('display_scoreboard', onDisplay)
    upstream.removeListener('update_score', onUpdateScore)
    upstream.removeListener('reset_score', onResetScore)
  }

  return { getPosition, destroy }
}

module.exports = { createQueueWatcher }
