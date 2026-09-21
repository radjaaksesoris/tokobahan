import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import type { Profile, UserRole } from '@/types'
import type { User } from '@supabase/supabase-js'

interface AuthState {
  user: User | null
  profile: Profile | null
  loading: boolean
  initialize: () => Promise<void>
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  isRole: (...roles: UserRole[]) => boolean
}

function normalizeLoginIdentifier(identifier: string) {
  const normalizedIdentifier = identifier.trim().toLowerCase()
  return normalizedIdentifier.includes('@')
    ? normalizedIdentifier
    : `${normalizedIdentifier}@outlook.com`
}

let authInitialized = false
let authInitializationPromise: Promise<void> | null = null

async function loadProfile(user: User) {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, avatar_url, created_at')
    .eq('id', user.id)
    .single()

  if (error) {
    console.error('Failed to load user profile:', error)
  }

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
        if (session?.user) {
          set({ user: session.user, profile: await loadProfile(session.user), loading: false })
        } else {
          set({ user: null, profile: null, loading: false })
        }

        supabase.auth.onAuthStateChange((event, session) => {
          if (!session?.user) {
            set({ user: null, profile: null })
            return
          }

          set({ user: session.user })
          if (event !== 'INITIAL_SESSION') {
            void loadProfile(session.user).then((profile) => set({ profile }))
          }
        })
        authInitialized = true
      } catch (error) {
        console.error('Failed to initialize authentication:', error)
        set({ loading: false })
      } finally {
        authInitializationPromise = null
      }
    })()

    return authInitializationPromise
  },

  signIn: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: normalizeLoginIdentifier(email),
      password,
    })
    if (error) return { error: error.message }
    return { error: null }
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({ user: null, profile: null })
  },

  isRole: (...roles) => {
    const role = get().profile?.role
    return role ? roles.includes(role) : false
  },
}))
