const RELOAD_KEY_PREFIX = 'vite-build-reload:'

function waitForWorkerActivation(worker: ServiceWorker): Promise<void> {
  if (worker.state === 'activated' || worker.state === 'redundant') return Promise.resolve()

  return new Promise((resolve) => {
    const finish = () => {
      window.clearTimeout(timeout)
      worker.removeEventListener('statechange', handleStateChange)
      resolve()
    }
    const handleStateChange = () => {
      if (worker.state === 'activated' || worker.state === 'redundant') finish()
    }
    const timeout = window.setTimeout(finish, 8000)
    worker.addEventListener('statechange', handleStateChange)
  })
}

export async function recoverFromStaleBuild(): Promise<void> {
  if (!navigator.onLine) return

  const entryScript = document.querySelector<HTMLScriptElement>('script[type="module"][src]')
  const buildKey = entryScript?.src || window.location.pathname
  const reloadKey = `${RELOAD_KEY_PREFIX}${buildKey}`
  if (sessionStorage.getItem(reloadKey)) return
  sessionStorage.setItem(reloadKey, '1')

  try {
    const registration = await navigator.serviceWorker?.getRegistration()
    if (registration) {
      const previousWorker = registration.active
      await registration.update()
      const updatedWorker = registration.installing || registration.waiting || registration.active
      if (updatedWorker && updatedWorker !== previousWorker) {
        const controllerChanged = new Promise<void>((resolve) => {
          const timeout = window.setTimeout(resolve, 3000)
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            window.clearTimeout(timeout)
            resolve()
          }, { once: true })
        })
        await waitForWorkerActivation(updatedWorker)
        if (registration.active === updatedWorker) await controllerChanged
      }
    }
  } catch (error) {
    console.warn('Gagal memperbarui aplikasi setelah asset gagal dimuat:', error)
  } finally {
    window.location.reload()
  }
}
