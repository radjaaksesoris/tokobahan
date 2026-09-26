import { supabase } from '@/lib/supabase'

const SOUND_ENABLED_KEY = 'tokobahan.low-stock-sound-enabled'
const PUSH_COOLDOWN_KEY = 'tokobahan.low-stock-push-last-request'
const PUSH_COOLDOWN_MS = 5 * 60 * 1000

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext
  }
}

export function isStockSoundEnabled() {
  return window.localStorage.getItem(SOUND_ENABLED_KEY) === 'true'
}

export function setStockSoundEnabled(enabled: boolean) {
  window.localStorage.setItem(SOUND_ENABLED_KEY, String(enabled))
}

export function playLowStockSound() {
  if (!isStockSoundEnabled()) return

  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!AudioContextClass) return

  const context = new AudioContextClass()
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  const now = context.currentTime

  oscillator.type = 'sine'
  oscillator.frequency.setValueAtTime(880, now)
  oscillator.frequency.exponentialRampToValueAtTime(660, now + 0.18)
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.16, now + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22)

  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.start(now)
  oscillator.stop(now + 0.22)
  oscillator.addEventListener('ended', () => {
    void context.close()
  }, { once: true })
}

function getVapidPublicKey() {
  return import.meta.env.VITE_VAPID_PUBLIC_KEY?.trim() || ''
}

function urlBase64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(window.atob(base64), (char) => char.charCodeAt(0))
}

export async function registerPushSubscription(options: { force?: boolean } = {}) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Browser tidak mendukung push notification')
  }
  const vapidPublicKey = getVapidPublicKey()
  if (!vapidPublicKey) {
    throw new Error('VAPID public key belum dikonfigurasi')
  }

  const registration = await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()
  if (options.force && subscription) {
    await subscription.unsubscribe()
    subscription = null
  }
  subscription = subscription || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    })
  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error('Subscription push tidak valid')
  }

  const { error } = await supabase.from('push_subscriptions').upsert({
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
  }, { onConflict: 'endpoint' })
  if (error) throw error
}

export async function showLowStockNotification(product: {
  id: string
  name: string
  stock: number
  min_stock: number
}) {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service worker tidak tersedia untuk notifikasi stok')
  }

  const registration = await navigator.serviceWorker.ready
  await registration.showNotification(`Stok menipis: ${product.name}`, {
    body: `Tersisa ${product.stock}, minimum stok ${product.min_stock}.`,
    icon: `${import.meta.env.BASE_URL}icon-192.png`,
    tag: `low-stock-${product.id}`,
    data: { url: import.meta.env.BASE_URL },
  })
}

export async function notifyLowStockPush(options: { force?: boolean } = {}) {
  if (!options.force) {
    const lastRequest = Number(window.localStorage.getItem(PUSH_COOLDOWN_KEY) || 0)
    if (Number.isFinite(lastRequest) && Date.now() - lastRequest < PUSH_COOLDOWN_MS) {
      return { sent: 0, removed: 0, skipped: true }
    }
  }
  window.localStorage.setItem(PUSH_COOLDOWN_KEY, String(Date.now()))
  const { data, error } = await supabase.functions.invoke('notify-low-stock', {
    body: {},
  })
  if (error) {
    if (error.context instanceof Response) {
      const responseBody = await error.context.text()
      if (responseBody) {
        try {
          const payload = JSON.parse(responseBody) as { error?: string; message?: string }
          throw new Error(payload.error || payload.message || responseBody)
        } catch (parseError) {
          if (parseError instanceof Error && parseError.message !== responseBody) throw parseError
          throw new Error(responseBody)
        }
      }
    }
    throw error
  }
  return { ...(data as { sent?: number; removed?: number }), skipped: false }
}
