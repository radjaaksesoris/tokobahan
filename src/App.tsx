import { Component, lazy, Suspense, useEffect, type ErrorInfo, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { isSupabaseConfigured } from '@/lib/supabase'
import { registerPushSubscription } from '@/lib/notifications'
import { useAuthStore } from '@/store/useAuthStore'
import { AppLayout } from '@/components/layout/AppLayout'
import { LoadingDots } from '@/components/ui/LoadingDots'

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

const Login = lazyWithRecovery(() => import('@/pages/Login'), 'login')
const Dashboard = lazyWithRecovery(() => import('@/pages/Dashboard'), 'dashboard')
const POS = lazyWithRecovery(() => import('@/pages/POS'), 'pos')
const Products = lazyWithRecovery(() => import('@/pages/Products'), 'products')
const StockHistory = lazyWithRecovery(() => import('@/pages/StockHistory'), 'stock-history')
const Reports = lazyWithRecovery(() => import('@/pages/Reports'), 'reports')
const TransactionHistory = lazyWithRecovery(() => import('@/pages/TransactionHistory'), 'transactions')
const SettingsPage = lazyWithRecovery(() => import('@/pages/Settings'), 'settings')
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
            Terjadi kendala saat membuka tab ini. Coba muat ulang halaman.
          </p>
          <button
            type="button"
            className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90"
            onClick={() => window.location.reload()}
          >
            Muat ulang
          </button>
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
    <div className="flex min-h-dvh items-center justify-center bg-canvas lg:min-h-[40vh]">
      <LoadingDots className="text-primary" />
    </div>
  )
}

function PageSuspense({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>
}

function preloadPageChunks() {
  void Promise.all([
    import('@/pages/Dashboard'),
    import('@/pages/Products'),
  ]).catch((error) => {
    console.warn('Gagal melakukan prefetch halaman:', error)
  })
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthStore()

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-primary lg:bg-canvas">
        <LoadingDots className="text-white lg:text-primary" dotClassName="h-2.5 w-2.5" />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
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

    const browserWindow = window as Window & {
      requestIdleCallback?: (callback: () => void) => number
      cancelIdleCallback?: (handle: number) => void
    }
    const idleCallback = browserWindow.requestIdleCallback
      ? browserWindow.requestIdleCallback(preloadPageChunks)
      : window.setTimeout(preloadPageChunks, 200)

    return () => {
      if (browserWindow.cancelIdleCallback && browserWindow.requestIdleCallback) {
        browserWindow.cancelIdleCallback(idleCallback)
      } else {
        window.clearTimeout(idleCallback)
      }
    }
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
            <Route path="pos" element={<PageSuspense><POS /></PageSuspense>} />
            <Route path="products" element={<PageSuspense><Products /></PageSuspense>} />
            <Route path="products/history" element={<PageSuspense><StockHistory /></PageSuspense>} />
            <Route path="reports" element={<PageSuspense><Reports /></PageSuspense>} />
            <Route path="transactions" element={<PageSuspense><TransactionHistory /></PageSuspense>} />
            <Route path="settings" element={<PageSuspense><SettingsPage /></PageSuspense>} />
          </Route>
          <Route path="*" element={<PageSuspense><NotFound /></PageSuspense>} />
        </Routes>
      </RouteErrorBoundary>
    </BrowserRouter>
  )
}
