import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import { isSupabaseConfigured } from '@/lib/supabase'
import { registerPushSubscription } from '@/lib/notifications'
import { useAuthStore } from '@/store/useAuthStore'
import { AppLayout } from '@/components/layout/AppLayout'
import { Loader2 } from 'lucide-react'

const Login = lazy(() => import('@/pages/Login'))
const Dashboard = lazy(() => import('@/pages/Dashboard'))
const POS = lazy(() => import('@/pages/POS'))
const Products = lazy(() => import('@/pages/Products'))
const Reports = lazy(() => import('@/pages/Reports'))
const TransactionHistory = lazy(() => import('@/pages/TransactionHistory'))
const SettingsPage = lazy(() => import('@/pages/Settings'))
const NotFound = lazy(() => import('@/pages/NotFound'))

function PageLoader() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Loader2 className="h-7 w-7 animate-spin text-primary" aria-label="Memuat halaman" />
    </div>
  )
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthStore()

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas">
        <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
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

  if (!isSupabaseConfigured) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-lg rounded-xl border border-amber-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-bold text-slate-900">Konfigurasi aplikasi belum lengkap</h1>
          <p className="mt-2 text-sm text-slate-600">
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
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="pos" element={<POS />} />
            <Route path="products" element={<Products />} />
            <Route path="reports" element={<Reports />} />
            <Route path="transactions" element={<TransactionHistory />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
