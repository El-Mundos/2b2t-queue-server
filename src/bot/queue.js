function createQueueWatcher(upstream) {
  let lastPosition = null

  function onSubtitle(packet) {
    try {
      const text = JSON.parse(packet.text)
      const str = text.text ?? text.translate ?? ''
      const match = str.match(/Position in queue:\s*(\d+)/)
      if (match) lastPosition = parseInt(match[1], 10)
    } catch (_) {}
  }

  upstream.on('set_title_subtitle', onSubtitle)

  function getPosition() { return lastPosition }

  function destroy() {
    upstream.removeListener('set_title_subtitle', onSubtitle)
  }

  return { getPosition, destroy }
}

module.exports = { createQueueWatcher }
