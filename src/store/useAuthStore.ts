import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/types'
import type { User } from '@supabase/supabase-js'
import { readOfflineCache, removeOfflineCache, writeOfflineCache } from '@/lib/offlineCache'
import { isOfflineAuthSessionValid, type CachedAuthSession } from '@/lib/offlineAuth'

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
let explicitSignOutInProgress = false
const AUTH_CACHE_KEY = 'auth-session'
const PROFILE_CACHE_PREFIX = 'profile:'
const OFFLINE_ACCESS_DAYS = 30

function profileCacheKey(userId: string) {
  return `${PROFILE_CACHE_PREFIX}${userId}`
}

function readValidCachedAuth() {
  const cached = readOfflineCache<CachedAuthSession<User>>(AUTH_CACHE_KEY)
  if (isOfflineAuthSessionValid(cached)) return cached

  const cachedUserId = cached?.user?.id
  removeOfflineCache(AUTH_CACHE_KEY)
  if (cachedUserId) removeOfflineCache(profileCacheKey(cachedUserId))
  return null
}

function cacheAuth(user: User, expiresAt?: number | null) {
  writeOfflineCache(AUTH_CACHE_KEY, {
    user,
    expiresAt: expiresAt || null,
    offlineExpiresAt: (Date.now() + OFFLINE_ACCESS_DAYS * 24 * 60 * 60 * 1000) / 1000,
  })
}

function applyCachedAuth(set: (state: Partial<AuthState>) => void, cached: CachedAuthSession<User>) {
  set({
    user: cached.user,
    profile: readOfflineCache<Profile>(profileCacheKey(cached.user.id)),
    loading: false,
  })
}

async function loadProfile(user: User) {
  const cachedProfile = readOfflineCache<Profile>(profileCacheKey(user.id))
  if (!navigator.onLine) return cachedProfile

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, avatar_url, created_at')
    .eq('id', user.id)
    .single()

  if (error) {
    console.error('Failed to load user profile:', error)
    return cachedProfile
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
        const { data: { session } } = await supabase.auth.getSession()
        const cached = readValidCachedAuth()
        if (session?.user && navigator.onLine) {
          cacheAuth(session.user, session.expires_at)
          set({ user: session.user, profile: await loadProfile(session.user), loading: false })
        } else if (cached?.user && isOfflineAuthSessionValid(cached)) {
          set({ user: cached.user, profile: readOfflineCache<Profile>(profileCacheKey(cached.user.id)), loading: false })
        } else if (session?.user && isOfflineAuthSessionValid({ user: session.user, expiresAt: session.expires_at ?? null })) {
          set({ user: session.user, profile: readOfflineCache<Profile>(profileCacheKey(session.user.id)), loading: false })
        } else {
          set({ user: null, profile: null, loading: false })
        }

        supabase.auth.onAuthStateChange((event, session) => {
          console.info('[auth] Supabase auth event:', event, { hasSession: Boolean(session?.user) })
          if (!navigator.onLine) {
            const cached = readValidCachedAuth()
            if (cached?.user) {
              applyCachedAuth(set, cached)
              return
            }
          }
          if (!session?.user) {
            // Supabase can temporarily remove its session after a refresh/network
            // failure. Keep the current admin session available while the local
            // cache is still valid. Explicit logout clears the cache first, so it
            // still takes effect immediately.
            const cached = readValidCachedAuth()
            const currentUser = get().user
            if (!explicitSignOutInProgress && cached?.user && currentUser?.id === cached.user.id) {
              applyCachedAuth(set, cached)
              return
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
        const cached = readValidCachedAuth()
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
      .select('id, full_name, role, avatar_url, created_at')
      .eq('id', data.user.id)
      .maybeSingle()

    if (profileError) {
      console.error('Failed to verify admin profile after sign-in:', profileError)
      const cachedProfile = readOfflineCache<Profile>(profileCacheKey(data.user.id))
      if (cachedProfile?.role === 'admin') {
        cacheAuth(data.user, data.session?.expires_at)
        set({ user: data.user, profile: cachedProfile, loading: false })
        return { error: null }
      }
      return { error: 'Login berhasil, tetapi profil admin belum dapat diperiksa. Periksa koneksi lalu coba lagi.' }
    }

    if (!profile || profile.role !== 'admin') {
      const { error: signOutError } = await supabase.auth.signOut()
      if (signOutError) console.error('Failed to sign out non-admin user:', signOutError)
      return { error: 'Aplikasi ini hanya menerima akun administrator.' }
    }

    cacheAuth(data.user, data.session?.expires_at)
    writeOfflineCache(profileCacheKey(data.user.id), profile)
    set({ user: data.user, profile: profile as Profile, loading: false })

    return { error: null }
  },

  signOut: async () => {
    const userId = get().user?.id
    explicitSignOutInProgress = true
    removeOfflineCache(AUTH_CACHE_KEY)
    if (userId) removeOfflineCache(profileCacheKey(userId))
    try {
      await supabase.auth.signOut()
    } catch (error) {
      console.warn('Remote sign-out failed; clearing local session anyway:', error)
    } finally {
      explicitSignOutInProgress = false
      set({ user: null, profile: null })
    }
  },
}))
