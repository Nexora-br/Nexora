const path = require('path')

function normalizeList(value) {
  if (!value) return []
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

const defaultOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
]

const config = {
  isProduction: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT || 3333),
  frontendOrigin: process.env.FRONTEND_ORIGIN || '',
  frontendOrigins: [...new Set([...defaultOrigins, ...normalizeList(process.env.FRONTEND_ORIGIN)])],
  storagePath: process.env.NEXORA_STORAGE_PATH || path.join(__dirname, 'storage'),
  isCloudEnvironment: Boolean(process.env.RENDER || process.env.VERCEL || process.env.DATABASE_URL || process.env.SUPABASE_URL),
  databaseUrl: process.env.DATABASE_URL || null,
}

function buildCorsOptions({ frontendOrigin = config.frontendOrigin, isProduction = config.isProduction } = {}) {
  const requestedOrigins = frontendOrigin
    ? [frontendOrigin, ...config.frontendOrigins]
    : config.frontendOrigins

  const allowedOrigins = [...new Set(requestedOrigins.filter(Boolean))]

  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true)

      // Allow exact matches
      if (allowedOrigins.includes(origin)) return callback(null, true)

      // Allow GitHub Pages domains (*.github.io)
      if (origin.endsWith('.github.io')) return callback(null, true)

      // Allow localhost and 127.0.0.1 in development
      if (!isProduction) return callback(null, true)

      return callback(new Error('Origin não permitida pela configuração do backend.'))
    },
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }
}

module.exports = { config, buildCorsOptions }

