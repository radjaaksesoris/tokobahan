import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

function recoverFromStaleBuild() {
  const reloadKey = 'vite-build-reload'
  if (sessionStorage.getItem(reloadKey)) return
  sessionStorage.setItem(reloadKey, '1')
  window.location.reload()
}

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  recoverFromStaleBuild()
})

window.addEventListener('error', (event) => {
  if (event.error instanceof TypeError && /dynamically imported module|importing a module script/i.test(event.error.message)) {
    recoverFromStaleBuild()
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' })
      .then((registration) => registration.update())
      .catch((error) => {
        console.error('KonveksiPOS service worker registration failed:', error)
      })
  })
}
