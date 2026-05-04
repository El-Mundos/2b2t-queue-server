require('dotenv').config({ path: process.env.ENV_FILE || '.env' })

module.exports = {
  mc: {
    username: process.env.MC_USERNAME,
    password: process.env.MC_PASSWORD,
    auth: process.env.MC_AUTH || 'microsoft',
    host: process.env.MC_HOST || '2b2t.org',
    port: parseInt(process.env.MC_PORT) || 25565,
    version: process.env.MC_VERSION || '1.21.4',
  },
  proxy: {
    port: parseInt(process.env.PROXY_PORT) || 25565,
    password: process.env.PROXY_PASSWORD || null,
    allowedIps: process.env.ALLOWED_IPS
      ? process.env.ALLOWED_IPS.split(',').map(s => s.trim())
      : [],
  },
  web: {
    port: parseInt(process.env.WEB_PORT) || 3000,
  },
}
