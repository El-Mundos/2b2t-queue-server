// packet.text in NMP 1.66+ is NBT-tagged, not a JSON string.
// Recursively unwrap all NBT container types and chat component fields.
function extractText(obj) {
  if (obj == null) return ''
  if (typeof obj === 'string') return obj
  if (Array.isArray(obj)) return obj.map(extractText).join('')
  if (typeof obj !== 'object') return ''
  // NBT primitives
  if (obj.type === 'string') return obj.value || ''
  if (obj.type === 'compound') return extractText(obj.value)
  if (obj.type === 'list') return extractText(obj.value?.value)
  // Chat component fields (obj.text may itself be an NBT object)
  let str = ''
  if (obj.text != null) str += extractText(obj.text)
  if (obj.extra != null) str += extractText(obj.extra)
  // Empty-string key used by 2b2t for plain text segments: {"": {type:"string", value:"\n"}}
  if ('' in obj) str += extractText(obj[''])
  return str
}

function createQueueWatcher(upstream) {
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
    }
  }

  function onTabList(packet) {
    try {
      const raw = packet.header
      const obj = typeof raw === 'string' ? JSON.parse(raw) : raw
      const str = extractText(obj)
      const etaMatch = str.match(/Estimated time:\s*(\S+)/)
      if (etaMatch) lastEta = etaMatch[1]
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
