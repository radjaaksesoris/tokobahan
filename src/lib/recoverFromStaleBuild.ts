const RELOAD_KEY_PREFIX = 'vite-build-reload:'
export const STALE_BUILD_RECOVERY_PARAM = '__app_recovery'
let recoveryFallbackShown = false

function showRecoveryFallback(reloadKey: string): void {
  if (recoveryFallbackShown) return
  const root = document.getElementById('root')
  if (!root) return
  recoveryFallbackShown = true

  const section = document.createElement('section')
  section.className = 'stale-build-recovery'
  section.setAttribute('role', 'alert')

  const content = document.createElement('div')
  content.className = 'stale-build-recovery__content'

  const heading = document.createElement('h1')
  heading.textContent = 'Aplikasi perlu dimuat ulang'

  const message = document.createElement('p')
  message.textContent = 'Pembaruan aplikasi belum selesai dimuat. Periksa koneksi internet, lalu coba lagi.'

  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = 'Coba muat ulang'
  button.addEventListener('click', () => {
    button.disabled = true
    void navigator.serviceWorker?.getRegistration()
      .then((registration) => registration?.update())
      .catch((error) => console.warn('Gagal memeriksa pembaruan aplikasi saat pemulihan:', error))
    sessionStorage.removeItem(reloadKey)
    window.location.reload()
  })

  content.append(heading, message, button)
  section.append(content)
  root.replaceChildren(section)
}

export function clearStaleBuildRecoveryParam(): void {
  const url = new URL(window.location.href)
  const isRecoveryAttempt = url.searchParams.has(STALE_BUILD_RECOVERY_PARAM)

  if (isRecoveryAttempt) {
    url.searchParams.delete(STALE_BUILD_RECOVERY_PARAM)
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
    window.setTimeout(() => {
      for (const key of Object.keys(sessionStorage)) {
        if (key.startsWith(RELOAD_KEY_PREFIX)) sessionStorage.removeItem(key)
      }
    }, 10000)
    return
  }

  for (const key of Object.keys(sessionStorage)) {
    if (key.startsWith(RELOAD_KEY_PREFIX)) sessionStorage.removeItem(key)
  }
}

export async function recoverFromStaleBuild(): Promise<void> {
  const reloadKey = `${RELOAD_KEY_PREFIX}${window.location.origin}${window.location.pathname}`
  if (recoveryFallbackShown) return
  if (sessionStorage.getItem(reloadKey)) {
    showRecoveryFallback(reloadKey)
    return
  }
  sessionStorage.setItem(reloadKey, '1')
  showRecoveryFallback(reloadKey)
}
