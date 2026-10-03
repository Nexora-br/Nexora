export function resolveApiUrl(env = import.meta.env) {
  const configuredApiUrl = env.VITE_API_URL?.trim()
  if (configuredApiUrl) return configuredApiUrl.replace(/\/+$/, '')

  const defaultApiUrl = env.DEV
    ? 'http://localhost:3333/api'
    : '/api'

  return defaultApiUrl.replace(/\/+$/, '')
}

export const API_URL = resolveApiUrl()
