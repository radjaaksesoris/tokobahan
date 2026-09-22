const CACHE_NAME = 'konveksipos-v3'
const BASE_PATH = new URL('./', self.registration.scope).pathname
const APP_SHELL = [
  BASE_PATH,
  `${BASE_PATH}index.html`,
  `${BASE_PATH}manifest.webmanifest`,
  `${BASE_PATH}favicon.png`,
  `${BASE_PATH}icon-192.png`,
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
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
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
          caches.open(CACHE_NAME).then((cache) => cache.put(`${BASE_PATH}index.html`, copy))
          return response
        })
        .catch(() => caches.match(`${BASE_PATH}index.html`)),
    )
    return
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
        }
        return response
      })
    }),
  )
})
