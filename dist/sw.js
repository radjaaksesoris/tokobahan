// Keep the previous cache briefly so open tabs can finish loading their chunks.
const CACHE_NAME = 'konveksipos-v9'
const BASE_PATH = new URL('./', self.registration.scope).pathname
const APP_SHELL = [
  BASE_PATH,
  `${BASE_PATH}index.html`,
  `${BASE_PATH}manifest.webmanifest`,
  `${BASE_PATH}favicon.png`,
  `${BASE_PATH}icon-192.png`,
  `${BASE_PATH}icon-96.png`,
  `${BASE_PATH}icon-512.png`,
  `${BASE_PATH}login-background.jpg`,
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then(async (keys) => {
        const appCaches = keys
          .filter((key) => /^konveksipos-v\d+$/.test(key))
          .sort((left, right) => Number(right.slice('konveksipos-v'.length)) - Number(left.slice('konveksipos-v'.length)))
        const previousCache = appCaches.find((key) => key !== CACHE_NAME)
        const cachesToKeep = new Set([CACHE_NAME, ...(previousCache ? [previousCache] : [])])
        await Promise.all(
          keys
            .filter((key) => key.startsWith('konveksipos-v') && !cachesToKeep.has(key))
            .map((key) => caches.delete(key)),
        )
        await self.clients.claim()
      })
  )
})

self.addEventListener('push', (event) => {
  if (!event.data) return
  event.waitUntil(
    (async () => {
      try {
        const data = event.data.json()
        await self.registration.showNotification(data.title || 'Stok menipis', {
          body: data.body || 'Ada produk yang perlu direstock.',
          icon: `${BASE_PATH}icon-192.png`,
          badge: `${BASE_PATH}favicon.png`,
          tag: data.tag || 'low-stock',
          data: { url: data.url || BASE_PATH },
        })
      } catch (error) {
        console.error('Push notification payload tidak valid:', error)
      }
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil((async () => {
    const requestedUrl = event.notification.data?.url
    const targetPath = !requestedUrl || requestedUrl === '/' ? BASE_PATH : requestedUrl
    const targetUrl = new URL(targetPath, self.location.origin).href
    const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existingClient = windowClients.find((client) => client.url.startsWith(self.location.origin + BASE_PATH))

    if (existingClient) {
      await existingClient.focus()
      if ('navigate' in existingClient && existingClient.url !== targetUrl) await existingClient.navigate(targetUrl)
      return
    }

    await clients.openWindow(targetUrl)
  })())
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone()
          event.waitUntil(
            caches.open(CACHE_NAME)
              .then((cache) => cache.put(`${BASE_PATH}index.html`, copy))
              .catch((error) => console.error('Gagal menyimpan halaman aplikasi ke cache:', error)),
          )
          return response
        })
        .catch(() => caches.open(CACHE_NAME)
          .then((cache) => cache.match(`${BASE_PATH}index.html`))
          .then((cached) => cached || caches.match(`${BASE_PATH}index.html`))),
    )
    return
  }

  // Network-first keeps deployed hashed JS/CSS chunks current while retaining
  // offline support when the network is unavailable.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone()
          event.waitUntil(
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch((error) => {
              console.error('Gagal menyimpan aset aplikasi ke cache:', error)
            }),
          )
          return response
        }
        return caches.match(event.request).then((cached) => cached || response)
      })
      .catch(() => caches.match(event.request).then((cached) => cached || Response.error())),
  )
})
