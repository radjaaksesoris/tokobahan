import { clearOfflineOperationalCache } from '@/lib/offlineCache'
import { clearOfflineOperationalData } from '@/lib/offlineOperationalData'
import { supabase } from '@/lib/supabase'

const RESET_GENERATION_KEY = 'konveksi-pos:operational-reset-generation'
let resetCheck: Promise<boolean> | null = null

async function fetchResetGeneration() {
  const { data, error } = await supabase.rpc('get_operational_reset_generation')
  if (error) throw new Error(`Gagal memeriksa status reset data: ${error.message}`)
  if (typeof data !== 'number' || !Number.isSafeInteger(data) || data < 0) {
    throw new Error('Status reset data dari server tidak valid')
  }
  return data
}

export async function rememberCurrentResetGeneration() {
  const generation = await fetchResetGeneration()
  globalThis.localStorage.setItem(RESET_GENERATION_KEY, String(generation))
}

export async function prepareOfflineQueuesForSync() {
  if (!navigator.onLine) return false
  if (resetCheck) return resetCheck

  resetCheck = (async () => {
    const generation = await fetchResetGeneration()
    const previousValue = globalThis.localStorage.getItem(RESET_GENERATION_KEY)
    const previousGeneration = previousValue === null ? null : Number(previousValue)

    if (previousValue !== null && previousGeneration !== generation) {
      await clearOfflineOperationalData()
      clearOfflineOperationalCache()
    } else if (previousValue === null && generation > 0) {
      await clearOfflineOperationalData()
      clearOfflineOperationalCache()
    }

    globalThis.localStorage.setItem(RESET_GENERATION_KEY, String(generation))
    return true
  })().finally(() => {
    resetCheck = null
  })

  return resetCheck
}
