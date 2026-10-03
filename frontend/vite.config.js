import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev
export default defineConfig({
  base: '/Nexora/',
  plugins: [react()],
})
