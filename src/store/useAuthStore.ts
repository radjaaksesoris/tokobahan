import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/types'
import type { User } from '@supabase/supabase-js'
import { readOfflineCache, removeOfflineCache, writeOfflineCache } from '@/lib/offlineCache'

interface AuthState {
  user: User | null
  profile: Profile | null
  loading: boolean
  initialize: () => Promise<void>
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

let authInitialized = false
let authInitializationPromise: Promise<void> | null = null
const AUTH_CACHE_KEY = 'auth-session'
const PROFILE_CACHE_PREFIX = 'profile:'

function profileCacheKey(userId: string) {
  return `${PROFILE_CACHE_PREFIX}${userId}`
}

function cacheAuth(user: User, expiresAt?: number | null) {
  writeOfflineCache(AUTH_CACHE_KEY, { user, expiresAt: expiresAt || null })
}

async function loadProfile(user: User) {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, avatar_url, created_at')
    .eq('id', user.id)
    .single()

  if (error) {
    console.error('Failed to load user profile:', error)
    return navigator.onLine ? null : readOfflineCache<Profile>(profileCacheKey(user.id))
  }

  if (profile) writeOfflineCache(profileCacheKey(user.id), profile)
  return profile as Profile | null
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  profile: null,
  loading: true,

  initialize: async () => {
    if (authInitialized) return
    if (authInitializationPromise) return authInitializationPromise

    authInitializationPromise = (async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession()
        if (session?.user) {
          cacheAuth(session.user, session.expires_at)
          set({ user: session.user, profile: await loadProfile(session.user), loading: false })
        } else {
          const cached = (error || !navigator.onLine)
            ? readOfflineCache<{ user: User; expiresAt: number | null }>(AUTH_CACHE_KEY)
            : null
          if (cached?.user) {
            set({ user: cached.user, profile: readOfflineCache<Profile>(profileCacheKey(cached.user.id)), loading: false })
          } else {
            set({ user: null, profile: null, loading: false })
          }
        }

        supabase.auth.onAuthStateChange((event, session) => {
          if (!session?.user) {
            if (!navigator.onLine) {
              const cached = readOfflineCache<{ user: User; expiresAt: number | null }>(AUTH_CACHE_KEY)
              if (cached?.user) {
                set({ user: cached.user, profile: readOfflineCache<Profile>(profileCacheKey(cached.user.id)), loading: false })
                return
              }
            }
            set({ user: null, profile: null })
            return
          }

          set({ user: session.user })
          cacheAuth(session.user, session.expires_at)
          if (event !== 'INITIAL_SESSION') {
            void loadProfile(session.user).then((profile) => set({ profile }))
          }
        })
        authInitialized = true
      } catch (error) {
        console.error('Failed to initialize authentication:', error)
        const cached = readOfflineCache<{ user: User; expiresAt: number | null }>(AUTH_CACHE_KEY)
        if (cached?.user) {
          set({ user: cached.user, profile: readOfflineCache<Profile>(profileCacheKey(cached.user.id)), loading: false })
        } else set({ loading: false })
      } finally {
        authInitializationPromise = null
      }
    })()

    return authInitializationPromise
  },

  signIn: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })
    if (error) return { error: error.message }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', data.user.id)
      .maybeSingle()

    if (profileError || profile?.role !== 'admin') {
      const { error: signOutError } = await supabase.auth.signOut()
      if (signOutError) console.error('Failed to sign out non-admin user:', signOutError)
      return { error: 'Aplikasi ini hanya menerima akun administrator.' }
    }

    return { error: null }
  },

  signOut: async () => {
    await supabase.auth.signOut()
    removeOfflineCache(AUTH_CACHE_KEY)
    if (get().user) removeOfflineCache(profileCacheKey(get().user!.id))
    set({ user: null, profile: null })
  },
}))
