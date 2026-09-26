import { Component, lazy, Suspense, useEffect, useState, type ErrorInfo, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { isSupabaseConfigured } from '@/lib/supabase'
import { registerPushSubscription } from '@/lib/notifications'
import { syncQueuedSettlements } from '@/lib/offlineSettlements'
import { syncQueuedTransactions } from '@/lib/offlineTransactions'
import { startInactivityLogout } from '@/lib/inactivityLogout'
import { useAuthStore } from '@/store/useAuthStore'
import { AppLayout } from '@/components/layout/AppLayout'
import { LoadingDots } from '@/components/ui/LoadingDots'
import Login from '@/pages/Login'
import type { UserRole } from '@/types'

function lazyWithRecovery<T extends React.ComponentType<unknown>>(
  importer: () => Promise<{ default: T }>,
  key: string,
) {
  return lazy(async () => {
    try {
      const module = await importer()
      sessionStorage.removeItem(`chunk-reload:${key}`)
      return module
    } catch (error) {
      const reloadKey = `chunk-reload:${key}`
      if (!sessionStorage.getItem(reloadKey)) {
        sessionStorage.setItem(reloadKey, '1')
        window.location.reload()
      }
      throw error
    }
  })
}

const Dashboard = lazyWithRecovery(() => import('@/pages/Dashboard'), 'dashboard')
const POS = lazyWithRecovery(() => import('@/pages/POS'), 'pos')
const Products = lazyWithRecovery(() => import('@/pages/Products'), 'products')
const StockHistory = lazyWithRecovery(() => import('@/pages/StockHistory'), 'stock-history')
const Reports = lazyWithRecovery(() => import('@/pages/Reports'), 'reports')
const TransactionHistory = lazyWithRecovery(() => import('@/pages/TransactionHistory'), 'transactions')
const SettingsPage = lazyWithRecovery(() => import('@/pages/Settings'), 'settings')
const Settlements = lazyWithRecovery(() => import('@/pages/Settlements'), 'settlements')
const StockOpname = lazyWithRecovery(() => import('@/pages/StockOpname'), 'stock-opname')
const NotFound = lazyWithRecovery(() => import('@/pages/NotFound'), 'not-found')

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Halaman gagal ditampilkan:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="flex min-h-[40vh] items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-red-200 bg-surface p-6 text-center shadow-sm">
          <h2 className="text-lg font-semibold text-ink">Halaman tidak dapat ditampilkan</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Terjadi kendala saat membuka tab ini. Silakan buka kembali tab ini.
          </p>
        </div>
      </div>
    )
  }
}

function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation()
  return <AppErrorBoundary key={location.pathname}>{children}</AppErrorBoundary>
}

function PageLoader() {
  return (
    <div className="min-h-[40vh] animate-pulse space-y-6" aria-label="Memuat halaman" role="status">
      <div className="space-y-3 border-b border-border pb-5">
        <div className="h-3 w-32 rounded-full bg-muted" />
        <div className="h-9 w-56 rounded-lg bg-muted" />
        <div className="h-4 w-72 max-w-full rounded-full bg-muted" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-24 rounded-2xl border border-border/60 bg-surface" />
        ))}
      </div>
      <div className="h-64 rounded-2xl border border-border/60 bg-surface" />
      <span className="sr-only">Memuat halaman...</span>
    </div>
  )
}

function PageSuspense({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>
}

function preloadPageChunks() {
  void Promise.all([
    import('@/pages/Dashboard'),
    import('@/pages/POS'),
    import('@/pages/Products'),
    import('@/pages/StockHistory'),
    import('@/pages/TransactionHistory'),
    import('@/pages/Settings'),
    import('@/pages/Settlements'),
  ]).catch((error) => {
    console.warn('Gagal melakukan prefetch halaman:', error)
  })
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches
  ))

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1023px)')
    const update = () => setIsMobile(mediaQuery.matches)
    update()
    mediaQuery.addEventListener('change', update)
    return () => mediaQuery.removeEventListener('change', update)
  }, [])

  return isMobile
}

function ProtectedRoute({ children, roles }: { children: React.ReactNode; roles?: UserRole[] }) {
  const { user, profile, loading } = useAuthStore()

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-primary lg:bg-canvas">
        <LoadingDots className="text-white lg:text-primary" dotClassName="h-2.5 w-2.5" />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />
  if (roles && (!profile || !roles.includes(profile.role))) return <Navigate to="/" replace />
  return <>{children}</>
}

function RoleGate({ children, roles, monitoring = false }: { children: React.ReactNode; roles: UserRole[]; monitoring?: boolean }) {
  const isMobile = useIsMobile()
  if (isMobile && !monitoring) return <Navigate to="/" replace />
  return <ProtectedRoute roles={roles}>{children}</ProtectedRoute>
}

export default function App() {
  const initialize = useAuthStore((s) => s.initialize)
  const user = useAuthStore((s) => s.user)
  const authLoading = useAuthStore((s) => s.loading)

  useEffect(() => {
    initialize()
  }, [initialize])

  useEffect(() => {
    if (authLoading || !user || !('Notification' in window) || Notification.permission !== 'granted') return

    registerPushSubscription().catch((error) => {
      console.warn('Push subscription sync failed:', error)
    })
  }, [authLoading, user])

  useEffect(() => {
    if (authLoading || !user) return

    preloadPageChunks()
  }, [authLoading, user])

  useEffect(() => {
    if (authLoading || !user) return

    const syncOfflineQueues = () => {
      syncQueuedTransactions().catch((error) => {
        console.error('Offline transaction sync failed:', error)
      })
      syncQueuedSettlements().catch((error) => {
        console.error('Offline settlement sync failed:', error)
      })
    }
    const syncWhenVisible = () => {
      if (document.visibilityState === 'visible') syncOfflineQueues()
    }
    const interval = window.setInterval(syncOfflineQueues, 30_000)
    window.addEventListener('online', syncOfflineQueues)
    window.addEventListener('offline', syncOfflineQueues)
    window.addEventListener('focus', syncWhenVisible)
    document.addEventListener('visibilitychange', syncWhenVisible)
    syncOfflineQueues()

    return () => {
      window.clearInterval(interval)
      window.removeEventListener('online', syncOfflineQueues)
      window.removeEventListener('offline', syncOfflineQueues)
      window.removeEventListener('focus', syncWhenVisible)
      document.removeEventListener('visibilitychange', syncWhenVisible)
    }
  }, [authLoading, user])

  useEffect(() => {
    if (authLoading || !user || !window.matchMedia('(max-width: 1023px)').matches) return

    return startInactivityLogout(() => {
      void useAuthStore.getState().signOut()
    }, 10 * 60 * 1000)
  }, [authLoading, user])

  if (!isSupabaseConfigured) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-6">
        <div className="w-full max-w-lg rounded-2xl border border-amber-200 bg-surface p-6 text-center shadow-sm">
          <h1 className="text-xl font-bold text-ink">Konfigurasi aplikasi belum lengkap</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Periksa secrets <code>VITE_SUPABASE_URL</code> dan <code>VITE_SUPABASE_ANON_KEY</code>
            di GitHub Repository Settings, lalu jalankan deploy ulang. URL harus berbentuk
            <code>https://project-id.supabase.co</code>.
          </p>
        </div>
      </div>
    )
  }

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Toaster position="top-center" richColors closeButton />
      <RouteErrorBoundary>
        <Routes>
          <Route path="/login" element={<PageSuspense><Login /></PageSuspense>} />
          <Route
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<PageSuspense><Dashboard /></PageSuspense>} />
            <Route path="pos" element={<RoleGate roles={['admin', 'cashier']}><PageSuspense><POS /></PageSuspense></RoleGate>} />
            <Route path="products" element={<RoleGate roles={['admin', 'cashier']}><PageSuspense><Products /></PageSuspense></RoleGate>} />
            <Route path="products/history" element={<RoleGate roles={['admin', 'cashier']}><PageSuspense><StockHistory /></PageSuspense></RoleGate>} />
            <Route path="products/stock-opname" element={<RoleGate roles={['admin']}><PageSuspense><StockOpname /></PageSuspense></RoleGate>} />
            <Route path="reports" element={<RoleGate roles={['admin', 'monitor']} monitoring><PageSuspense><Reports /></PageSuspense></RoleGate>} />
            <Route path="transactions" element={<RoleGate roles={['admin', 'monitor']} monitoring><PageSuspense><TransactionHistory /></PageSuspense></RoleGate>} />
            <Route path="settings" element={<RoleGate roles={['admin']}><PageSuspense><SettingsPage /></PageSuspense></RoleGate>} />
            <Route path="settlements" element={<RoleGate roles={['admin', 'cashier']} monitoring><PageSuspense><Settlements /></PageSuspense></RoleGate>} />
          </Route>
          <Route path="*" element={<PageSuspense><NotFound /></PageSuspense>} />
        </Routes>
      </RouteErrorBoundary>
    </BrowserRouter>
  )
}
