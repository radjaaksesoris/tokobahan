import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

const configuredUrl = import.meta.env.VITE_SUPABASE_URL?.trim() || ''
const configuredAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || ''

function isValidSupabaseUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname.endsWith('.supabase.co')
  } catch {
    return false
  }
}

export const isSupabaseConfigured = Boolean(
  isValidSupabaseUrl(configuredUrl) && configuredAnonKey,
)

if (!isSupabaseConfigured) {
  console.warn('Supabase credentials missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY')
}

export const supabase = createClient<Database>(
  isSupabaseConfigured ? configuredUrl : 'https://supabase-not-configured.supabase.co',
  isSupabaseConfigured ? configuredAnonKey : 'supabase-not-configured',
)
