import { supabase } from '@/lib/supabase'

const RESET_GENERATION_KEY = 'konveksi-pos:operational-reset-generation'

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
