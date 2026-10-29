const configuredApiUrl = import.meta.env.VITE_API_URL?.trim()
// Em dev a API é alcançada pelo proxy do Vite (/api -> 127.0.0.1:3333),
// o que mantém a mesma origem e evita CORS tanto local quanto no preview.
const defaultApiUrl = import.meta.env.DEV
  ? '/api'
  : 'https://nexora-backend-w7aa.onrender.com/api'

export const API_URL = (configuredApiUrl || defaultApiUrl).replace(/\/+$/, '')
