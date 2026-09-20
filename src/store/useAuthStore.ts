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

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  profile: null,
  loading: true,

  initialize: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('id, full_name, role, avatar_url, created_at')
          .eq('id', session.user.id)
          .single()
        if (profileError) {
          console.error('Failed to load user profile:', profileError)
        }
        set({ user: session.user, profile: profile as Profile | null, loading: false })
      } else {
        set({ user: null, profile: null, loading: false })
      }
    } catch (error) {
      console.error('Failed to initialize authentication:', error)
      set({ loading: false })
    }

    supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('id, full_name, role, avatar_url, created_at')
          .eq('id', session.user.id)
          .single()
        if (profileError) {
          console.error('Failed to load user profile after auth change:', profileError)
        }
        set({ user: session.user, profile: profile as Profile | null })
      } else {
        set({ user: null, profile: null })
      }
    })
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
