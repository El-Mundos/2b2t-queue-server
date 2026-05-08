const fs = require('fs')
const path = require('path')

const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), 'logs')

fs.mkdirSync(LOG_DIR, { recursive: true })

const streams = new Map()

function getStream(name) {
  if (!streams.has(name)) {
    streams.set(name, fs.createWriteStream(path.join(LOG_DIR, `${name}.log`), { flags: 'a' }))
  }
  return streams.get(name)
}

function fmt(...args) {
  return args.map(a => (typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a))).join(' ')
}

function log(category, ...args) {
  const ts = new Date().toISOString()
  const msg = fmt(...args)
  getStream(category).write(`${ts}  ${msg}\n`)
  process.stdout.write(`[${category}] ${msg}\n`)
}

function error(category, ...args) {
  const ts = new Date().toISOString()
  const msg = fmt(...args)
  getStream(category).write(`${ts}  ${msg}\n`)
  getStream('error').write(`${ts}  [${category}] ${msg}\n`)
  process.stderr.write(`[${category}] ${msg}\n`)
}

module.exports = { log, error }
