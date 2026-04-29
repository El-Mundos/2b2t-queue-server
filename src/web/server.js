const express = require('express')
const { WebSocketServer } = require('ws')
const http = require('http')
const path = require('path')
const config = require('../config')
const { createApiRouter } = require('./api')

function createWebServer(proxy) {
  const app = express()
  app.use(express.json())
  app.use(express.static(path.join(__dirname, '../../public')))
  app.use('/api', createApiRouter(proxy))

  const server = http.createServer(app)
  const wss = new WebSocketServer({ server })

  function broadcast(data) {
    const msg = JSON.stringify(data)
    for (const ws of wss.clients) {
      if (ws.readyState === ws.OPEN) ws.send(msg)
    }
  }

  proxy.on('state', (stateData) => broadcast({ type: 'state', ...stateData }))
  proxy.on('queue_position', (pos) => broadcast({ type: 'queue_position', position: pos }))
  proxy.on('in_game', () => broadcast({ type: 'in_game' }))
  proxy.on('player_connected', () => broadcast({ type: 'player_connected' }))
  proxy.on('player_disconnected', () => broadcast({ type: 'player_disconnected' }))

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
