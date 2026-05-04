const express = require('express')
const { WebSocketServer } = require('ws')
const http = require('http')
const path = require('path')
const crypto = require('crypto')
const config = require('../config')
const { createApiRouter } = require('./api')

const sessionToken = crypto.randomBytes(32).toString('hex')

function parseCookies(cookieHeader = '') {
  return Object.fromEntries(
    cookieHeader.split(';').flatMap(c => {
      const i = c.indexOf('=')
      if (i < 0) return []
      return [[c.slice(0, i).trim(), c.slice(i + 1).trim()]]
    })
  )
}

function isAuthenticated(req) {
  if (!config.proxy.password) return true
  return parseCookies(req.headers.cookie).token === sessionToken
}

function createWebServer(proxy) {
  const app = express()
  app.use(express.json())
  app.use(express.urlencoded({ extended: false }))

  app.post('/login', (req, res) => {
    if (req.body.password === config.proxy.password) {
      res.setHeader('Set-Cookie', `token=${sessionToken}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Strict`)
      res.redirect('/')
    } else {
      res.redirect('/login.html?error=1')
    }
  })

  app.use((req, res, next) => {
    if (!config.proxy.password) return next()
    if (req.path === '/login.html') return next()
    if (isAuthenticated(req)) return next()
    res.redirect('/login.html')
  })

  app.use(express.static(path.join(__dirname, '../../public')))
  app.use('/api', createApiRouter(proxy))

  const server = http.createServer(app)
  const wss = new WebSocketServer({
    server,
    verifyClient: ({ req }) => isAuthenticated(req),
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
