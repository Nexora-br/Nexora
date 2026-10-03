import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './AppNew.jsx'

if (sessionStorage.redirect) {
  const redirect = sessionStorage.redirect
  delete sessionStorage.redirect
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '')
  window.history.replaceState(null, null, base + redirect)
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
