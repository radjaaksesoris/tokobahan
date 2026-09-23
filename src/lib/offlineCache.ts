const CACHE_PREFIX = 'konveksi-pos:offline:'
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000

interface CacheEnvelope<T> {
  value: T
  cachedAt: number
  expiresAt: number
}

function storageKey(key: string) {
  return `${CACHE_PREFIX}${key}`
}

export function writeOfflineCache<T>(key: string, value: T, ttlMs = MAX_CACHE_AGE_MS) {
  try {
    const now = Date.now()
    const envelope: CacheEnvelope<T> = { value, cachedAt: now, expiresAt: now + Math.min(ttlMs, MAX_CACHE_AGE_MS) }
    window.localStorage.setItem(storageKey(key), JSON.stringify(envelope))
  } catch (error) {
    console.warn(`Unable to cache ${key} locally:`, error)
  }
}

export function readOfflineCacheEntry<T>(key: string): CacheEnvelope<T> | null {
  try {
    const raw = window.localStorage.getItem(storageKey(key))
    if (!raw) return null
    const envelope = JSON.parse(raw) as CacheEnvelope<T>
    if (!envelope || typeof envelope.expiresAt !== 'number' || envelope.expiresAt <= Date.now()) return null
    return envelope
  } catch { return null }
}

export function readOfflineCache<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(storageKey(key))
    if (!raw) return null
    const envelope = JSON.parse(raw) as CacheEnvelope<T>
    if (!envelope || typeof envelope.expiresAt !== 'number' || envelope.expiresAt <= Date.now()) {
      window.localStorage.removeItem(storageKey(key))
      return null
    }
    return envelope.value
  } catch {
    return null
  }
}

export function removeOfflineCache(key: string) {
  try {
    window.localStorage.removeItem(storageKey(key))
  } catch {
    // Storage can be unavailable in private browsing; the app can continue online.
  }
}
