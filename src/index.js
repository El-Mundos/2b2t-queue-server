const { createProxy } = require('./proxy')
const { createWebServer } = require('./web/server')

const proxy = createProxy()
const web = createWebServer(proxy)

web.listen()

process.on('SIGINT', () => {
  proxy.stop()
  process.exit(0)
})
