import { Component, lazy, Suspense, useEffect, useRef, type ErrorInfo, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { isSupabaseConfigured } from '@/lib/supabase'
import { registerPushSubscription } from '@/lib/notifications'
import { checkTauriUpdate, installTauriUpdate } from '@/lib/tauriUpdater'
import {
  OPERATIONAL_SNAPSHOT_CHANGE_EVENT,
  pruneStoredOperationalSales,
  readOperationalSnapshot,
} from '@/lib/offlineOperationalSnapshot'
import { startAutomaticOperationalSync } from '@/lib/automaticOperationalSync'
import {
  LOCAL_BACKUP_COMPLETED_EVENT,
  LOCAL_BACKUP_LAST_GENERATED_KEY,
  startAutomaticLocalBackup,
  startTauriCloseGuard,
} from '@/lib/localBackup'
import { useAuthStore } from '@/store/useAuthStore'
import { AppLayout } from '@/components/layout/AppLayout'
import { StartupLoadingScreen } from '@/components/ui/StartupLoadingScreen'
import { getPageChunkImporter } from '@/lib/pageChunks'
import Dashboard from '@/pages/Dashboard'
import Login from '@/pages/Login'
import { recoverFromStaleBuild } from '@/lib/recoverFromStaleBuild'

function lazyWithRecovery<T extends React.ComponentType<unknown>>(
  importer: () => Promise<{ default: T }>,
  key: string,
) {
  return lazy(async () => {
    try {
      return await importer()
    } catch (error) {
      console.error(`Gagal memuat halaman ${key}:`, error)
      void recoverFromStaleBuild()
      throw error
    }
  })
}

const POS = lazyWithRecovery(getPageChunkImporter('pos'), 'pos')
const Products = lazyWithRecovery(getPageChunkImporter('products'), 'products')
const StockHistory = lazyWithRecovery(getPageChunkImporter('stockHistory'), 'stock-history')
const Reports = lazyWithRecovery(getPageChunkImporter('reports'), 'reports')
const TransactionHistory = lazyWithRecovery(getPageChunkImporter('transactions'), 'transactions')
const SettingsPage = lazyWithRecovery(getPageChunkImporter('settings'), 'settings')
const Settlements = lazyWithRecovery(getPageChunkImporter('settlements'), 'settlements')
const StockOpname = lazyWithRecovery(getPageChunkImporter('stockOpname'), 'stock-opname')
const NotFound = lazyWithRecovery(getPageChunkImporter('notFound'), 'not-found')

class AppErrorBoundary extends Component<
  { children: ReactNode; resetKey?: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidUpdate(previousProps: Readonly<{ children: ReactNode; resetKey?: string }>) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Halaman gagal ditampilkan:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas p-6">
        <div className="w-full max-w-md rounded-2xl border border-red-200 bg-surface p-6 text-center shadow-sm">
          <h2 className="text-lg font-semibold text-ink">Halaman tidak dapat ditampilkan</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Terjadi kendala saat membuka halaman. Muat ulang aplikasi untuk mencoba kembali.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90"
          >
            Muat ulang aplikasi
          </button>
        </div>
      </div>
    )
  }
}

function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation()
  return <AppErrorBoundary resetKey={location.pathname}>{children}</AppErrorBoundary>
}

function PageLoader() {
  const { pathname } = useLocation()
  const pageName = ({
    '/': 'Ringkasan',
    '/dashboard': 'Ringkasan',
    '/pos': 'Kasir',
    '/products': 'Produk',
    '/products/history': 'Riwayat stok',
    '/products/stock-opname': 'Stok opname',
    '/reports': 'Laporan',
    '/transactions': 'Riwayat transaksi',
    '/settings': 'Pengaturan',
    '/settlements': 'Pelunasan hutang',
    '/login': 'Login',
  } as Record<string, string>)[pathname] || 'halaman'

  return (
    <section className="route-loader" role="status" aria-label={`Memuat ${pageName}`}>
      <div className="route-loader__heading">
        <span className="route-loader__indicator" aria-hidden="true" />
        <div>
          <p>RUANG KERJA TOKO</p>
          <h2>Membuka {pageName}</h2>
        </div>
      </div>
      <div className="route-loader__placeholder" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <span className="sr-only">Memuat halaman...</span>
    </section>
  )
}

function PageSuspense({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>
}

const LOCAL_SALES_RETENTION_MIGRATION_KEY = 'tokobahan.sales-retention-500-v1'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuthStore()

  if (loading) return <StartupLoadingScreen phase="access" />

  if (!user || profile?.role !== 'admin') return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  const initialize = useAuthStore((s) => s.initialize)
  const user = useAuthStore((s) => s.user)
  const profile = useAuthStore((s) => s.profile)
  const authLoading = useAuthStore((s) => s.loading)
  const isAdmin = profile?.role === 'admin'
  const hasPendingLocalChangesRef = useRef(false)

  useEffect(() => {
    initialize()
  }, [initialize])

  useEffect(() => {
    if (authLoading || !user || !isAdmin || !('Notification' in window) || Notification.permission !== 'granted') return

    registerPushSubscription().catch((error) => {
      console.warn('Push subscription sync failed:', error)
    })
  }, [authLoading, isAdmin, user])

  useEffect(() => {
    if (authLoading || !user || !isAdmin) return

    void checkTauriUpdate().then((update) => {
      if (!update) return
      const promptKey = `tauri-update-prompted:${update.version}`
      if (window.sessionStorage.getItem(promptKey)) return
      window.sessionStorage.setItem(promptKey, '1')
      const notes = update.notes ? `\n\nCatatan: ${update.notes}` : ''
      if (!window.confirm(`Versi aplikasi baru tersedia: ${update.version}.${notes}\n\nPasang sekarang?`)) return
      void installTauriUpdate().catch((error) => {
        window.alert(`Pembaruan gagal dipasang: ${error instanceof Error ? error.message : 'Kesalahan tidak diketahui'}`)
      })
    }).catch((error) => {
      console.info('Pemeriksaan pembaruan Tauri dilewati:', error)
    })
  }, [authLoading, isAdmin, user])

  useEffect(() => {
    if (authLoading || !user || !isAdmin) return
    return startAutomaticLocalBackup()
  }, [authLoading, isAdmin, user])

  useEffect(() => {
    if (authLoading || !user || !isAdmin) return
    return startAutomaticOperationalSync()
  }, [authLoading, isAdmin, user])

  useEffect(() => {
    if (authLoading || !user || !isAdmin) return
    try {
      if (window.localStorage.getItem(LOCAL_SALES_RETENTION_MIGRATION_KEY) === '1') return
    } catch (error) {
      console.warn('Gagal memeriksa status pembatasan riwayat lokal:', error)
    }

    const timer = window.setTimeout(() => {
      void pruneStoredOperationalSales()
        .then(() => {
          window.localStorage.setItem(LOCAL_SALES_RETENTION_MIGRATION_KEY, '1')
        })
        .catch((error) => {
          console.error('Gagal membatasi riwayat transaksi lokal:', error)
        })
    }, 2000)
    return () => window.clearTimeout(timer)
  }, [authLoading, isAdmin, user])

  useEffect(() => {
    if (authLoading || !user || !isAdmin) return
    let cleanup: (() => void) | undefined
    void startTauriCloseGuard().then((unlisten) => {
      cleanup = unlisten
    })
    return () => cleanup?.()
  }, [authLoading, isAdmin, user])

  useEffect(() => {
    if (authLoading || !user || !isAdmin) return

    let checking = false
    let stateVersion = 0
    const updatePendingState = async () => {
      if (checking) return
      checking = true
      const currentVersion = stateVersion
      try {
        const snapshot = await readOperationalSnapshot()
        if (currentVersion === stateVersion) {
          hasPendingLocalChangesRef.current = Boolean(
            snapshot && window.localStorage.getItem(LOCAL_BACKUP_LAST_GENERATED_KEY) !== snapshot.generated_at,
          )
        }
      } catch (error) {
        console.warn('Gagal memeriksa perubahan data lokal:', error)
        if (currentVersion === stateVersion) hasPendingLocalChangesRef.current = false
      } finally {
        checking = false
      }
    }

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void updatePendingState()
    }
    const markLocalChangesPending = () => {
      stateVersion += 1
      hasPendingLocalChangesRef.current = true
    }
    const markLocalChangesBackedUp = () => {
      stateVersion += 1
      hasPendingLocalChangesRef.current = false
    }

    const warnBeforeOfflineClose = (event: BeforeUnloadEvent) => {
      if (!hasPendingLocalChangesRef.current) return
      event.preventDefault()
      event.returnValue = 'Ada perubahan data lokal. Buat backup terlebih dahulu sebelum menutup aplikasi.'
    }

    const timer = window.setTimeout(() => void updatePendingState(), 1000)
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener(OPERATIONAL_SNAPSHOT_CHANGE_EVENT, markLocalChangesPending)
    window.addEventListener(LOCAL_BACKUP_COMPLETED_EVENT, markLocalChangesBackedUp)
    window.addEventListener('beforeunload', warnBeforeOfflineClose)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener(OPERATIONAL_SNAPSHOT_CHANGE_EVENT, markLocalChangesPending)
      window.removeEventListener(LOCAL_BACKUP_COMPLETED_EVENT, markLocalChangesBackedUp)
      window.removeEventListener('beforeunload', warnBeforeOfflineClose)
      hasPendingLocalChangesRef.current = false
    }
  }, [authLoading, isAdmin, user])

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
            <Route index element={<Navigate to="/pos" replace />} />
            <Route path="dashboard" element={<PageSuspense><Dashboard /></PageSuspense>} />
            <Route path="pos" element={<PageSuspense><POS /></PageSuspense>} />
            <Route path="products" element={<PageSuspense><Products /></PageSuspense>} />
            <Route path="products/history" element={<PageSuspense><StockHistory /></PageSuspense>} />
            <Route path="products/stock-opname" element={<PageSuspense><StockOpname /></PageSuspense>} />
            <Route path="reports" element={<PageSuspense><Reports /></PageSuspense>} />
            <Route path="transactions" element={<PageSuspense><TransactionHistory /></PageSuspense>} />
            <Route path="settings" element={<PageSuspense><SettingsPage /></PageSuspense>} />
            <Route path="settlements" element={<PageSuspense><Settlements /></PageSuspense>} />
          </Route>
          <Route path="*" element={<PageSuspense><NotFound /></PageSuspense>} />
        </Routes>
      </RouteErrorBoundary>
    </BrowserRouter>
  )
}
