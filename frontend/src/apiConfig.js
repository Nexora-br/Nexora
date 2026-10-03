const configuredApiUrl = import.meta.env.VITE_API_URL?.trim()
const defaultApiUrl = import.meta.env.DEV
  ? 'http://localhost:3333/api'
  : '/api'

export const API_URL = (configuredApiUrl || defaultApiUrl).replace(/\/+$/, '')
