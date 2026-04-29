require('dotenv').config()

module.exports = {
  mc: {
    username: process.env.MC_USERNAME,
    password: process.env.MC_PASSWORD,
    auth: process.env.MC_AUTH || 'microsoft',
    host: '2b2t.org',
    port: 25565,
    version: '1.20.1',
  },
  proxy: {
    port: parseInt(process.env.PROXY_PORT) || 25565,
    allowedIps: process.env.ALLOWED_IPS
      ? process.env.ALLOWED_IPS.split(',').map(s => s.trim())
      : [],
  },
  web: {
    port: parseInt(process.env.WEB_PORT) || 3000,
  },
}
