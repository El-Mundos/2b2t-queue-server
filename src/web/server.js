const express = require('express')
const { WebSocketServer } = require('ws')
const http = require('http')
const path = require('path')
const config = require('../config')
const { createApiRouter } = require('./api')

function checkAuth(req) {
  const password = config.proxy.password
  if (!password) return true
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Basic ')) return false
  const decoded = Buffer.from(auth.slice(6), 'base64').toString()
  return decoded.slice(decoded.indexOf(':') + 1) === password
}

function createWebServer(proxy) {
  const app = express()
  app.use((req, res, next) => {
    if (checkAuth(req)) return next()
    res.set('WWW-Authenticate', 'Basic realm="2b2t Proxy"')
    res.status(401).send('Unauthorized')
  })
  app.use(express.json())
  app.use(express.static(path.join(__dirname, '../../public')))
  app.use('/api', createApiRouter(proxy))

  const server = http.createServer(app)
  const wss = new WebSocketServer({
    server,
    verifyClient: ({ req }) => checkAuth(req),
  })

  function broadcast(data) {
    const msg = JSON.stringify(data)
    for (const ws of wss.clients) {
      if (ws.readyState === ws.OPEN) ws.send(msg)
    }
  }

  proxy.on('state', (stateData) => broadcast({ type: 'state', ...stateData }))
  proxy.on('queue_position', (pos, eta) => {
    broadcast({ type: 'queue_position', position: pos, eta: eta ?? null })
  })
  proxy.on('in_game', () => { broadcast({ type: 'in_game' }) })
  proxy.on('player_connected', () => broadcast({ type: 'player_connected' }))
  proxy.on('player_disconnected', () => broadcast({ type: 'player_disconnected' }))
  proxy.on('auth_code', (data) => broadcast({ type: 'auth_code', ...data }))

  wss.on('connection', (ws) => {
    // Send current state immediately on connect
    ws.send(JSON.stringify({ type: 'state', ...proxy.getState() }))
  })

  function listen() {
    server.listen(config.web.port, () => {
      console.log(`[web] dashboard at http://localhost:${config.web.port}`)
    })
  }

  return { listen }
}

module.exports = { createWebServer }
