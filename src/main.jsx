import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// ── Service worker update safety net ─────────────────────────────────────────
// The PWA is registered by the injected /registerSW.js, which only calls
// register() — it never reloads the page when a new worker takes control.
// With registerType: 'autoUpdate' the new worker skip-waits and claims open
// clients, but the page keeps running the old bundle until the user manually
// hard-reloads (twice, if the HTML itself was precached) — which is how a
// deploy can be live while a returning user still sees the previous build.
// Reload exactly once, and only if the page was already under SW control
// (so first-time visitors don't get an extra reload on initial install).
if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
  let refreshed = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshed) return
    refreshed = true
    window.location.reload()
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
