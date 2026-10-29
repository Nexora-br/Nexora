import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev
export default defineConfig({
  base: '/Nexora/',
  plugins: [react()],
  // Em dev a API roda na porta 3333; o proxy mantém /api na mesma origem da
  // página, então o login funciona tanto no seu navegador quanto no preview.
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:3333', changeOrigin: true },
    },
  },
})
