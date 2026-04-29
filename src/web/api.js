const { Router } = require('express')

function createApiRouter(proxy) {
  const router = Router()

  router.get('/status', (req, res) => {
    res.json(proxy.getState())
  })

  router.post('/start', (req, res) => {
    proxy.start()
    res.json({ ok: true })
  })

  router.post('/stop', (req, res) => {
    proxy.stop()
    res.json({ ok: true })
  })

  return router
}

module.exports = { createApiRouter }
