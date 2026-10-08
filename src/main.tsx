import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { recoverFromStaleBuild } from '@/lib/recoverFromStaleBuild'

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  void recoverFromStaleBuild()
})

window.addEventListener('error', (event) => {
  if (event.error instanceof TypeError && /dynamically imported module|importing a module script/i.test(event.error.message)) {
    void recoverFromStaleBuild()
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
