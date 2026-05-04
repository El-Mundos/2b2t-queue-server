const crypto = require('crypto')
const config = require('./config')

const oneTimeTokens = new Map() // token → expiry ms

function generateToken() {
  const now = Date.now()
  for (const [t, exp] of oneTimeTokens) if (exp <= now) oneTimeTokens.delete(t)
  const token = crypto.randomBytes(6).toString('hex') // 12-char hex
  oneTimeTokens.set(token, now + 5 * 60 * 1000)
  return token
}

function checkPassword(input) {
  if (!config.proxy.password) return true
  if (input === config.proxy.password) return true
  const expiry = oneTimeTokens.get(input)
  if (expiry && expiry > Date.now()) {
    oneTimeTokens.delete(input)
    return true
  }
  return false
}

module.exports = { generateToken, checkPassword }
