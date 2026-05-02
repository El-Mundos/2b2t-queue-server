function extractText(obj) {
  if (obj == null) return ''
  if (typeof obj === 'string') return obj
  if (Array.isArray(obj)) return obj.map(extractText).join('')
  if (typeof obj !== 'object') return ''
  if (obj.type === 'string') return obj.value || ''
  if (obj.type === 'compound') return extractText(obj.value)
  if (obj.type === 'list') return extractText(obj.value?.value)
  let str = ''
  if (obj.text != null) str += extractText(obj.text)
  if (obj.extra != null) str += extractText(obj.extra)
  if ('' in obj) str += extractText(obj[''])
  return str
}

function createQueueWatcher(upstream, onChange) {
  let lastPosition = null
  let lastEta = null
  let lastUpdate = 0

  function parsePacketText(packet) {
    try {
      const raw = packet.text
      const obj = typeof raw === 'string' ? JSON.parse(raw) : raw
      return extractText(obj)
    } catch (_) { return '' }
  }

  function onSubtitle(packet) {
    const str = parsePacketText(packet)
    if (!str) return
    const posMatch = str.match(/Position in queue:\s*(\d+)/)
    if (posMatch) {
      lastPosition = parseInt(posMatch[1], 10)
      lastUpdate = Date.now()
      onChange?.()
    }
  }

  function onTabList(packet) {
    try {
      const raw = packet.header
      const obj = typeof raw === 'string' ? JSON.parse(raw) : raw
      const str = extractText(obj)
      let changed = false
      const etaMatch = str.match(/Estimated time:\s*(.+)/)
      if (etaMatch) { lastEta = etaMatch[1].trim(); changed = true }
      const posMatch = str.match(/Position in queue:\s*(\d+)/)
      if (posMatch) { lastPosition = parseInt(posMatch[1], 10); lastUpdate = Date.now(); changed = true }
      if (changed) onChange?.()
    } catch (_) {}
  }

  upstream.on('set_title_subtitle', onSubtitle)
  upstream.on('playerlist_header', onTabList)

  return {
    getPosition() { return lastPosition },
    getEta() { return lastEta },
    getLastUpdate() { return lastUpdate },
    destroy() {
      upstream.removeListener('set_title_subtitle', onSubtitle)
      upstream.removeListener('playerlist_header', onTabList)
    },
  }
}

module.exports = { createQueueWatcher }
