import { useEffect, useRef, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { formatCurrency, formatNumber } from '@/lib/utils'
import { formatMixedStockQuantity } from '@/lib/productUnits'
import type { ProductPrice } from '@/types'
import {
  TrendingUp,
  ShoppingBag,
  Package,
  DollarSign,
  Banknote,
  CreditCard,
  ArrowLeftRight,
  QrCode,
  PackageSearch,
  RefreshCw,
  X,
  ArrowDownLeft,
  ArrowUpRight,
  Clock3,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { format } from 'date-fns'
import { id as localeId } from 'date-fns/locale'
import { toast } from 'sonner'
import { playLowStockSound, registerPushSubscription, showLowStockNotification } from '@/lib/notifications'
import { getUnnotifiedProducts } from '@/lib/lowStockNotifications'
import { readOperationalSnapshot } from '@/lib/offlineOperationalSnapshot'
import { getLocalDashboardAnalytics } from '@/lib/offlineOperationalAnalytics'
import {
  initializeOperationalSnapshot,
  hasUnsyncedLocalChanges,
  refreshOperationalSnapshotFromServer,
} from '@/lib/offlineOperationalBootstrap'
import { isMobileDevice } from '@/lib/automaticOperationalSync'

interface Stats {
  todaySales: number
  todayTransactionValue: number
  todayProfit: number
  todayOrders: number
  todayCustomerDebtPayments: {
    amount: number
    count: number
  }
  todayVendorDebtPayments: {
    amount: number
    count: number
  }
  todayPaymentCounts: {
    cash: number
    credit: number
    transfer: number
    qris: number
  }
  todayPaymentTotals: {
    cash: number
    credit: number
    transfer: number
    qris: number
  }
  totalProducts: number
  lowStock: number
}

interface LowStockProduct {
  id: string
  name: string
  stock: number
  min_stock: number
  stock_unit: string
  stock_conversion: number
  prices: ProductPrice[]
}

const LOW_STOCK_NOTIFIED_KEY = 'tokobahan.low-stock-notified'

function downloadSnapshotBackup(snapshot: unknown) {
  const filenameDate = new Date().toISOString().replace(/[:.]/g, '-')
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `tokobahan-backup-${filenameDate}.json`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { setSnapshotGeneratedAt, setDashboardReady, setStartupPhase } = useOutletContext<{
    setSnapshotGeneratedAt: (timestamp: string | null) => void
    setDashboardReady: (ready: boolean) => void
    setStartupPhase: (phase: 'access' | 'data' | 'page') => void
  }>()
  const [stats, setStats] = useState<Stats>({
    todaySales: 0,
    todayTransactionValue: 0,
    todayProfit: 0,
    todayOrders: 0,
    todayCustomerDebtPayments: { amount: 0, count: 0 },
    todayVendorDebtPayments: { amount: 0, count: 0 },
    todayPaymentCounts: { cash: 0, credit: 0, transfer: 0, qris: 0 },
    todayPaymentTotals: { cash: 0, credit: 0, transfer: 0, qris: 0 },
    totalProducts: 0,
    lowStock: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [snapshotMissing, setSnapshotMissing] = useState(false)
  const [lowStockProducts, setLowStockProducts] = useState<LowStockProduct[]>([])
  const [showLowStockModal, setShowLowStockModal] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [reminderNow, setReminderNow] = useState(() => new Date())
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const statsRequestId = useRef(0)
  const initialLoadComplete = useRef(false)
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported',
  )
  const reminderStartsAt = new Date(reminderNow)
  reminderStartsAt.setHours(14, 30, 0, 0)
  const syncStartsAt = new Date(reminderNow)
  syncStartsAt.setHours(15, 0, 0, 0)
  const syncReminderVisible = !isMobileDevice() && reminderNow >= reminderStartsAt && reminderNow < syncStartsAt
  const syncSecondsRemaining = Math.max(0, Math.ceil((syncStartsAt.getTime() - reminderNow.getTime()) / 1000))
  const syncMinutes = Math.floor(syncSecondsRemaining / 60)
  const syncSeconds = syncSecondsRemaining % 60

  useEffect(() => {
    const updateOnlineState = () => setIsOnline(navigator.onLine)
    const updateReminderTime = () => setReminderNow(new Date())
    window.addEventListener('online', updateOnlineState)
    window.addEventListener('offline', updateOnlineState)
    window.addEventListener('focus', updateReminderTime)
    document.addEventListener('visibilitychange', updateReminderTime)
    return () => {
      window.removeEventListener('online', updateOnlineState)
      window.removeEventListener('offline', updateOnlineState)
      window.removeEventListener('focus', updateReminderTime)
      document.removeEventListener('visibilitychange', updateReminderTime)
    }
  }, [])

  useEffect(() => {
    if (isMobileDevice()) return

    const now = new Date(reminderNow)
    const nextReminder = new Date(now)
    nextReminder.setHours(14, 30, 0, 0)
    if (now >= nextReminder) nextReminder.setDate(nextReminder.getDate() + 1)

    const delay = syncReminderVisible
      ? 1000
      : Math.max(0, nextReminder.getTime() - now.getTime())
    const timer = window.setTimeout(() => setReminderNow(new Date()), delay)
    return () => window.clearTimeout(timer)
  }, [reminderNow, syncReminderVisible])

  useEffect(() => {
    void loadStats()
  }, [])

  async function loadStats() {
    const requestId = ++statsRequestId.current
    setStartupPhase('page')
    if (!initialLoadComplete.current) setLoading(true)
    setError(null)
    setSnapshotMissing(false)
    setSnapshotGeneratedAt(null)
    let snapshot
    try {
      snapshot = await readOperationalSnapshot()
    } catch (snapshotError) {
      if (requestId !== statsRequestId.current) return
      setError(`Gagal membaca snapshot lokal: ${snapshotError instanceof Error ? snapshotError.message : 'Kesalahan tidak diketahui'}`)
      setLoading(false)
      initialLoadComplete.current = true
      setDashboardReady(true)
      return
    }
    if (requestId !== statsRequestId.current) return
    if (snapshot) {
      try {
        if (!Number.isFinite(Date.parse(snapshot.generated_at))) {
          throw new Error('Waktu pembuatan snapshot lokal tidak valid')
        }
        const analytics = getLocalDashboardAnalytics(snapshot)
        const nextStats: Stats = {
          todaySales: analytics.todaySales,
          todayTransactionValue: analytics.todayTransactionValue,
          todayProfit: analytics.todayProfit,
          todayOrders: analytics.todayOrders,
          todayCustomerDebtPayments: analytics.todayCustomerDebtPayments,
          todayVendorDebtPayments: analytics.todayVendorDebtPayments,
          todayPaymentCounts: analytics.todayPaymentCounts,
          todayPaymentTotals: analytics.todayPaymentTotals,
          totalProducts: analytics.totalProducts,
          lowStock: analytics.lowStock,
        }
        setStats(nextStats)
        setLowStockProducts(analytics.lowStockProducts)
        notifyLowStock(analytics.lowStockProducts)
        setSnapshotGeneratedAt(snapshot.generated_at)
        setLoading(false)
        initialLoadComplete.current = true
        setDashboardReady(true)
      } catch (snapshotError) {
        setError(`Gagal membaca data snapshot lokal: ${snapshotError instanceof Error ? snapshotError.message : 'Kesalahan tidak diketahui'}`)
        setLoading(false)
        initialLoadComplete.current = true
        setDashboardReady(true)
      }
      return
    }

    setError('Data lokal belum disiapkan. Buka Pengaturan untuk mengambil data awal.')
    setSnapshotMissing(true)
    setLoading(false)
    initialLoadComplete.current = true
    setDashboardReady(true)
  }

  async function initializeDashboardData() {
    setRefreshing(true)
    try {
      await initializeOperationalSnapshot()
      await loadStats()
      toast.success('Data awal berhasil disiapkan di perangkat ini')
    } catch (initializationError) {
      toast.error(`Gagal menyiapkan data awal: ${initializationError instanceof Error ? initializationError.message : 'Kesalahan tidak diketahui'}`)
    } finally {
      setRefreshing(false)
    }
  }

  async function refreshDataAndApp() {
    if (!navigator.onLine) {
      toast.error('Hubungkan perangkat ke internet untuk mengambil data dan versi aplikasi terbaru')
      return
    }

    setRefreshing(true)
    try {
      const snapshot = await readOperationalSnapshot()
      if (snapshot) {
        downloadSnapshotBackup(snapshot)
        const result = await refreshOperationalSnapshotFromServer(
          hasUnsyncedLocalChanges(snapshot)
            ? {
                replaceUnsyncedLocalChanges: true,
                expectedLocalGeneratedAt: snapshot.generated_at,
              }
            : {},
        )
        toast.success(`Data server diperbarui (${result.rows} baris). Memuat versi aplikasi terbaru...`)
      } else {
        const result = await initializeOperationalSnapshot()
        toast.success(`Data awal diunduh (${result.rows} baris). Memuat versi aplikasi terbaru...`)
      }

      await updateAppAndReload()
    } catch (refreshError) {
      toast.error(`Pembaruan gagal: ${refreshError instanceof Error ? refreshError.message : 'Kesalahan tidak diketahui'}`)
    } finally {
      setRefreshing(false)
    }
  }

  async function updateAppAndReload() {
    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration()
        if (registration) {
          await registration.update()
          const worker = registration.installing
          if (worker && worker.state !== 'activated' && worker.state !== 'redundant') {
            await new Promise<void>((resolve) => {
              const finish = () => {
                window.clearTimeout(timeout)
                worker.removeEventListener('statechange', handleStateChange)
                resolve()
              }
              const handleStateChange = () => {
                if (worker.state === 'activated' || worker.state === 'redundant') finish()
              }
              const timeout = window.setTimeout(finish, 10000)
              worker.addEventListener('statechange', handleStateChange)
            })
          }
        }
      }
    } catch (error) {
      toast.error(`Data sudah diperbarui, tetapi pemeriksaan versi aplikasi gagal: ${error instanceof Error ? error.message : 'Kesalahan tidak diketahui'}`)
    }

    window.location.reload()
  }

  function notifyLowStock(products: LowStockProduct[]) {
    if (products.length === 0) {
      window.localStorage.removeItem(LOW_STOCK_NOTIFIED_KEY)
      return
    }

    let storedIds: string[] = []
    try {
      const parsed = JSON.parse(window.localStorage.getItem(LOW_STOCK_NOTIFIED_KEY) || '[]')
      if (Array.isArray(parsed)) storedIds = parsed.filter((id): id is string => typeof id === 'string')
    } catch {
      storedIds = []
    }
    const newProducts = getUnnotifiedProducts(products, storedIds)
    if (newProducts.length > 0) {
      const productNames = newProducts.slice(0, 3).map((product) => product.name).join(', ')
      const remainingCount = newProducts.length - 3
      toast.custom((toastId) => (
        <div className="stock-toast" role="status">
          <span className="stock-toast-icon">
            <PackageSearch className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="stock-toast-content">
            <p className="stock-toast-title">Stok menipis · {newProducts.length} produk</p>
            <p className="stock-toast-product">
              {productNames}{remainingCount > 0 ? ` dan ${remainingCount} lainnya` : ''}
            </p>
          </div>
          <button
            type="button"
            className="stock-toast-close"
            aria-label="Lihat daftar stok menipis"
            onClick={() => {
              toast.dismiss(toastId)
              setShowLowStockModal(true)
            }}
          >
            Lihat
          </button>
          <button
            type="button"
            className="stock-toast-close"
            aria-label="Tutup notifikasi stok menipis"
            onClick={() => toast.dismiss(toastId)}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ), {
        duration: 6000,
        className: 'stock-toast-wrapper',
      })
      playLowStockSound()
    }
    window.localStorage.setItem(
      LOW_STOCK_NOTIFIED_KEY,
      JSON.stringify(products.map((product) => product.id)),
    )

    if (notificationPermission === 'granted') {
      newProducts.forEach((product) => {
        void showLowStockNotification(product).catch((error) => {
          console.warn('Gagal menampilkan notifikasi stok:', error)
        })
      })
    }
  }

  async function enableStockNotifications() {
    if (!('Notification' in window)) {
      setNotificationPermission('unsupported')
      toast.error('Browser ini tidak mendukung notifikasi')
      return
    }

    const permission = await Notification.requestPermission()
    setNotificationPermission(permission)
    if (permission === 'granted') {
      try {
        await registerPushSubscription()
        toast.success('Notifikasi stok diaktifkan')
        lowStockProducts.forEach((product) => {
          void showLowStockNotification(product).catch((error) => {
            console.warn('Gagal menampilkan notifikasi stok:', error)
          })
        })
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Gagal mendaftarkan push notification')
      }
    } else {
      toast.error('Izin notifikasi stok ditolak')
    }
  }

  const cards = [
    {
      title: 'Uang Diterima Hari Ini',
      value: formatCurrency(stats.todaySales),
      icon: ShoppingBag,
      color: 'bg-[#dce6d5] text-[#344b2f]',
      watermark: 'text-[#526b49]/[0.12]',
      surface: 'bg-ink text-white ring-1 ring-ink',
      featured: true,
    },
    {
      title: 'Nilai Transaksi Hari Ini',
      value: formatCurrency(stats.todayTransactionValue),
      icon: DollarSign,
      color: 'bg-[#d8e2d0] text-[#344b2f]',
      watermark: 'text-[#526b49]/[0.12]',
      surface: 'bg-surface/95 ring-1 ring-border',
    },
    {
      title: 'Laba Bersih Hari Ini',
      value: formatCurrency(stats.todayProfit),
      icon: TrendingUp,
      color: 'bg-[#e2e9d8] text-[#3d5035]',
      watermark: 'text-[#526b49]/[0.12]',
      surface: 'bg-muted/50 ring-1 ring-border',
      className: 'lg:hidden',
    },
    {
      title: 'Produk Aktif',
      value: formatNumber(stats.totalProducts),
      icon: Package,
      color: 'bg-[#d5dfcc] text-[#344b2f]',
      watermark: 'text-[#526b49]/[0.12]',
      surface: 'bg-surface/95 ring-1 ring-border',
      isProductCard: true,
    },
  ]

  return (
    <div className="mx-auto max-w-[1440px] space-y-5">
      <div className="page-header sticky top-[-1rem] z-30 -mx-4 -mt-4 flex flex-col gap-4 overflow-hidden border-b border-accent/30 bg-ink px-4 py-4 text-white shadow-[0_8px_24px_rgba(32,42,46,0.16)] sm:top-[-1.25rem] sm:-mx-5 sm:-mt-5 sm:flex-row sm:items-start sm:justify-between sm:px-5 lg:top-[-2rem] lg:-mx-8 lg:-mt-8 lg:items-end lg:px-8 lg:py-5">
        <div className="pointer-events-none absolute -right-10 -top-20 h-48 w-48 rounded-full bg-accent/10 blur-3xl" aria-hidden="true" />
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Transaksi Hari Ini</h2>
          <p className="mt-1 text-sm font-medium text-white/65">{format(new Date(), 'EEEE, d MMMM yyyy', { locale: localeId })}</p>
        </div>
        <div className="mx-auto flex w-full max-w-md flex-wrap justify-center gap-2 lg:mx-0 lg:w-auto lg:max-w-none lg:flex-nowrap">
          {isMobileDevice() && (
            <button
              type="button"
              onClick={() => void refreshDataAndApp()}
              disabled={refreshing || !isOnline}
              className="inline-flex min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl border border-white/20 bg-ink px-3 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 lg:hidden"
              aria-label={refreshing ? 'Sedang mengambil pembaruan data dan aplikasi' : 'Ambil pembaruan data dan aplikasi'}
              title={isOnline ? 'Ambil data terbaru dari server dan periksa pembaruan aplikasi' : 'Hubungkan perangkat ke internet'}
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
              {refreshing ? 'Mengambil pembaruan...' : 'Refresh / Perbarui'}
            </button>
          )}
          {syncReminderVisible ? (
            <div
              className={`flex min-w-0 flex-1 items-center gap-2 rounded-2xl border px-3 py-2.5 text-left text-xs shadow-sm lg:flex-none ${
                isOnline
                  ? 'border-sky-300 bg-sky-100 text-sky-950'
                  : 'border-amber-300 bg-amber-100 text-amber-950'
              }`}
              role="status"
            >
              {isOnline ? <Wifi className="h-4 w-4 shrink-0" aria-hidden="true" /> : <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />}
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">
                  {isOnline ? 'Sinkronisasi ke server' : 'Hubungkan ke internet sebelum pukul 15.00'}
                </span>
                <span className="block text-[11px] opacity-80">Pastikan aplikasi tetap terbuka.</span>
              </span>
              <span className="flex shrink-0 items-center gap-1 font-mono font-bold tabular-nums" aria-label={`${syncMinutes} menit ${syncSeconds} detik lagi`}>
                <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                {String(syncMinutes).padStart(2, '0')}:{String(syncSeconds).padStart(2, '0')}
              </span>
            </div>
          ) : (
            <>
              <div
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2.5 text-center text-white lg:flex-none lg:px-4 lg:text-left"
                aria-label={`Status toko ${isOnline ? 'aktif' : 'offline'}`}
              >
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/55">Status toko</p>
                <p className="mt-1 flex items-center justify-center gap-2 text-sm font-semibold lg:justify-start">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${isOnline ? 'bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.15)]' : 'bg-red-400 shadow-[0_0_0_3px_rgba(248,113,113,0.15)]'}`} />
                  {isOnline ? 'Aktif' : 'Offline'}
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {error && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold text-ink">
                {snapshotMissing ? 'Data toko belum disiapkan di perangkat ini' : 'Dashboard belum dapat memuat data'}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {snapshotMissing && (
                <button
                  type="button"
                  onClick={() => void initializeDashboardData()}
                  disabled={refreshing}
                  className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60"
                >
                  {refreshing ? 'Menyiapkan...' : 'Siapkan data lokal'}
                </button>
              )}
              <button
                type="button"
                onClick={() => navigate('/settings')}
                className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-stone-50"
              >
                Buka Pengaturan
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.title} className={`relative overflow-hidden border-0 ${c.surface} ${'className' in c ? c.className : ''} ${'featured' in c && c.featured ? 'shadow-[0_12px_28px_rgba(64,87,55,0.18)]' : 'shadow-[0_8px_24px_rgba(32,42,46,0.05)]'}`}>
                <c.icon
                  aria-hidden="true"
                  className={`pointer-events-none absolute -right-3 -top-3 h-24 w-24 rotate-12 ${'featured' in c && c.featured ? 'text-white/[0.08]' : c.watermark}`}
                />
                <CardContent className="relative z-10 flex min-h-28 items-center gap-3 p-4">
              <div className={`rounded-xl p-2.5 ${'featured' in c && c.featured ? 'bg-accent text-ink' : c.color}`}>
                <c.icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className={`truncate text-[11px] font-semibold uppercase tracking-[0.1em] ${'featured' in c && c.featured ? 'text-white/70' : 'text-muted-foreground'}`}>{c.title}</p>
                <p className={`mt-0.5 truncate text-xl font-bold tracking-tight tabular-nums ${'featured' in c && c.featured ? 'text-white' : 'text-ink'}`}>
                  {loading ? '...' : c.value}
                </p>
                {'isProductCard' in c && c.isProductCard && stats.lowStock > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800 underline-offset-2 hover:underline"
                      aria-label={`Lihat ${stats.lowStock} produk dengan stok menipis`}
                      onClick={() => setShowLowStockModal(true)}
                    >
                      <PackageSearch className="h-3.5 w-3.5" aria-hidden="true" />
                      Stok menipis: {formatNumber(stats.lowStock)} produk
                    </button>
                    {notificationPermission === 'default' && (
                      <button
                        type="button"
                        className="text-xs font-semibold text-primary underline-offset-2 hover:underline"
                        onClick={enableStockNotifications}
                      >
                        Aktifkan notifikasi
                      </button>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="relative overflow-hidden border-0 bg-surface/95 shadow-[0_12px_32px_rgba(32,42,46,0.06)]">
        <CardHeader className="border-b border-[#e9e9df] px-5 pb-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Arus pembayaran</p>
          <CardTitle className="text-lg tracking-tight">Pembayaran hutang hari ini</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-4 text-ink">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface text-primary shadow-sm">
              <ArrowDownLeft className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] opacity-75">Diterima dari pelanggan</p>
              <p className="mt-1 truncate text-xl font-bold tracking-tight tabular-nums">{loading ? '...' : formatCurrency(stats.todayCustomerDebtPayments.amount)}</p>
              <p className="mt-1 text-xs opacity-70">{loading ? '...' : `${formatNumber(stats.todayCustomerDebtPayments.count)} pembayaran`}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-muted/50 px-4 py-4 text-ink">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface text-primary shadow-sm">
              <ArrowUpRight className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] opacity-75">Dibayarkan ke supplier</p>
              <p className="mt-1 truncate text-xl font-bold tracking-tight tabular-nums">{loading ? '...' : formatCurrency(stats.todayVendorDebtPayments.amount)}</p>
              <p className="mt-1 text-xs opacity-70">{loading ? '...' : `${formatNumber(stats.todayVendorDebtPayments.count)} pembayaran`}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="relative overflow-hidden border-0 bg-surface/95 shadow-[0_12px_32px_rgba(32,42,46,0.06)]">
        <DollarSign aria-hidden="true" className="pointer-events-none absolute -right-3 -top-3 h-24 w-24 -rotate-12 text-[#657b52]/[0.08]" />
        <CardHeader className="relative z-10 border-b border-[#e9e9df] px-5 pb-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Aktivitas penjualan</p>
              <CardTitle className="mt-1 text-lg tracking-tight">Rincian transaksi hari ini</CardTitle>
            </div>
            <div className="shrink-0 rounded-xl bg-ink px-3 py-2 text-right text-white shadow-[0_5px_12px_rgba(32,42,46,0.2)]">
              <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-white/65">Total</p>
              <p className="text-2xl font-bold leading-none tabular-nums">{loading ? '...' : formatNumber(stats.todayOrders)}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="relative z-10 grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
          {([
            ['CASH', stats.todayPaymentTotals.cash, stats.todayPaymentCounts.cash, Banknote, 'border-border bg-surface text-ink'],
            ['KREDIT', stats.todayPaymentTotals.credit, stats.todayPaymentCounts.credit, CreditCard, 'border-border bg-muted/50 text-ink'],
            ['TRANSFER', stats.todayPaymentTotals.transfer, stats.todayPaymentCounts.transfer, ArrowLeftRight, 'border-border bg-surface text-ink'],
            ['QR', stats.todayPaymentTotals.qris, stats.todayPaymentCounts.qris, QrCode, 'border-border bg-muted/50 text-ink'],
          ] as const).map(([label, total, count, Icon, color]) => (
            <div key={label} className={`rounded-xl border border-t-2 px-4 py-3.5 ${color}`}>
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
                <p>{label}</p>
              </div>
              <p className="mt-1.5 truncate text-lg font-bold tracking-tight tabular-nums">{loading ? '...' : formatCurrency(total)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{loading ? '...' : `${formatNumber(count)} transaksi`}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {showLowStockModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          role="presentation"
          onClick={() => setShowLowStockModal(false)}
        >
          <Card
            className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-2xl sm:rounded-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="low-stock-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <CardHeader className="flex-row items-center justify-between border-b">
              <div>
                <CardTitle id="low-stock-modal-title">Stok Menipis</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">{lowStockProducts.length} produk perlu segera direstock.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowLowStockModal(false)}
                aria-label="Tutup daftar stok menipis"
                className="rounded-lg p-2 text-muted-foreground hover:bg-slate-100 hover:text-ink"
              >
                <X className="h-5 w-5" />
              </button>
            </CardHeader>
            <CardContent className="overflow-y-auto p-0">
              <ul className="divide-y divide-stone-200">
                {lowStockProducts.map((product) => (
                  <li key={product.id} className="flex items-center justify-between gap-4 px-6 py-4">
                    <span className="min-w-0 truncate font-medium text-ink/90">{product.name}</span>
                    <span className="shrink-0 text-right text-sm">
                      <strong className="text-amber-700">
                        {formatMixedStockQuantity({ ...product, stock: product.stock })}
                      </strong>
                      <span className="text-muted-foreground">
                        {' / min. '}
                        {formatMixedStockQuantity({ ...product, stock: product.min_stock })}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
