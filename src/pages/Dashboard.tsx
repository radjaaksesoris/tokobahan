import { useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { formatCurrency, formatNumber } from '@/lib/utils'
import {
  TrendingUp,
  ShoppingBag,
  Package,
  DollarSign,
  PackageSearch,
  RefreshCw,
  X,
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
  refreshOperationalSnapshotFromServer,
} from '@/lib/offlineOperationalBootstrap'

interface Stats {
  todaySales: number
  todayProfit: number
  todayOrders: number
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
}

const LOW_STOCK_NOTIFIED_KEY = 'tokobahan.low-stock-notified'
export default function Dashboard() {
  const [stats, setStats] = useState<Stats>({
    todaySales: 0,
    todayProfit: 0,
    todayOrders: 0,
    todayPaymentCounts: { cash: 0, credit: 0, transfer: 0, qris: 0 },
    todayPaymentTotals: { cash: 0, credit: 0, transfer: 0, qris: 0 },
    totalProducts: 0,
    lowStock: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [snapshotGeneratedAt, setSnapshotGeneratedAt] = useState<string | null>(null)
  const [lowStockProducts, setLowStockProducts] = useState<LowStockProduct[]>([])
  const [showLowStockModal, setShowLowStockModal] = useState(false)
  const [lowStockDismissed, setLowStockDismissed] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const statsRequestId = useRef(0)
  const initialLoadComplete = useRef(false)
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported',
  )

  useEffect(() => {
    void loadStats()
  }, [])

  async function loadStats() {
    const requestId = ++statsRequestId.current
    if (!initialLoadComplete.current) setLoading(true)
    setError(null)
    setSnapshotGeneratedAt(null)
    let snapshot
    try {
      snapshot = await readOperationalSnapshot()
    } catch (snapshotError) {
      if (requestId !== statsRequestId.current) return
      setError(`Gagal membaca snapshot lokal: ${snapshotError instanceof Error ? snapshotError.message : 'Kesalahan tidak diketahui'}`)
      setLoading(false)
      initialLoadComplete.current = true
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
          todayProfit: analytics.todayProfit,
          todayOrders: analytics.todayOrders,
          todayPaymentCounts: analytics.todayPaymentCounts,
          todayPaymentTotals: analytics.todayPaymentTotals,
          totalProducts: analytics.totalProducts,
          lowStock: analytics.lowStock,
        }
        setStats(nextStats)
        setLowStockProducts(analytics.lowStockProducts)
        if (analytics.lowStock === 0) setLowStockDismissed(false)
        notifyLowStock(analytics.lowStockProducts)
        setSnapshotGeneratedAt(snapshot.generated_at)
        setLoading(false)
        initialLoadComplete.current = true
      } catch (snapshotError) {
        setError(`Gagal membaca data snapshot lokal: ${snapshotError instanceof Error ? snapshotError.message : 'Kesalahan tidak diketahui'}`)
        setLoading(false)
        initialLoadComplete.current = true
      }
      return
    }

    setError('Data lokal belum disiapkan. Buka Pengaturan untuk mengambil data awal.')
    setLoading(false)
    initialLoadComplete.current = true
  }

  async function refreshMobileData() {
    if (!navigator.onLine) {
      toast.error('Refresh membutuhkan koneksi internet')
      return
    }

    setRefreshing(true)
    try {
      const localSnapshot = await readOperationalSnapshot()
      const hasPendingChanges = Boolean(
        localSnapshot?.synced_generated_at && localSnapshot.synced_generated_at !== localSnapshot.generated_at,
      )
      if (hasPendingChanges) {
        toast.warning('Data lokal belum tersinkron. Lakukan sinkronisasi dari PC sebelum refresh mobile.')
        return
      }
      if (localSnapshot) await refreshOperationalSnapshotFromServer()
      else await initializeOperationalSnapshot()
      await loadStats()
      toast.success('Data transaksi berhasil diperbarui')
    } catch (refreshError) {
      toast.error(`Refresh gagal: ${refreshError instanceof Error ? refreshError.message : 'Kesalahan tidak diketahui'}`)
    } finally {
      setRefreshing(false)
    }
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

  function dismissLowStockAlert() {
    setLowStockDismissed(true)
  }

  const cards = [
    {
      title: 'Penjualan Hari Ini',
      value: formatCurrency(stats.todaySales),
      icon: ShoppingBag,
      color: 'bg-teal-100 text-teal-700',
      watermark: 'text-teal-700/[0.08]',
    },
    {
      title: 'Laba Bersih Hari Ini',
      value: formatCurrency(stats.todayProfit),
      icon: TrendingUp,
      color: 'bg-emerald-100 text-emerald-700',
      watermark: 'text-emerald-600/[0.09]',
    },
    {
      title: 'Produk Aktif',
      value: formatNumber(stats.totalProducts),
      icon: Package,
      color: 'bg-blue-100 text-blue-700',
      watermark: 'text-blue-600/[0.08]',
    },
  ]

  return (
    <div className="mx-auto max-w-[1440px] space-y-7">
      <div className="page-header sticky top-[-1rem] z-30 -mx-4 -mt-4 flex flex-col gap-4 bg-ink px-4 py-4 text-white shadow-[0_3px_0_rgba(32,42,46,0.2)] sm:top-[-1.25rem] sm:-mx-5 sm:-mt-5 sm:flex-row sm:items-start sm:justify-between sm:px-5 lg:top-[-2rem] lg:-mx-8 lg:-mt-8 lg:px-8 lg:py-5">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white">Transaksi Hari Ini</h2>
          <p className="mt-1 text-sm font-medium text-accent">{format(new Date(), 'EEEE, d MMMM yyyy', { locale: localeId })}</p>
          {snapshotGeneratedAt && (
            <p className="mt-1 text-xs font-medium text-emerald-200" role="status">
              Snapshot lokal · dibuat {format(new Date(snapshotGeneratedAt), 'd MMM yyyy HH:mm', { locale: localeId })}
            </p>
          )}
        </div>
        <div className="mx-auto flex w-full max-w-md flex-wrap justify-center gap-2 lg:mx-0 lg:w-auto lg:max-w-none lg:flex-nowrap">
          <button
            type="button"
            onClick={() => void refreshMobileData()}
            disabled={refreshing}
            className="inline-flex min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl border border-white/20 bg-ink px-3 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10 disabled:cursor-wait disabled:opacity-60 lg:hidden"
            aria-label="Refresh data transaksi dari Supabase"
            title="Refresh data transaksi dari Supabase"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </button>
          <div
            className="min-w-0 flex-1 rounded-2xl bg-ink px-3 py-3 text-center text-white lg:flex-none lg:px-4 lg:text-left"
            aria-label="Status toko aktif"
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">Status toko</p>
            <p className="mt-1 flex items-center justify-center gap-2 text-sm font-semibold lg:justify-start"><span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" /> Aktif</p>
          </div>
          {stats.lowStock > 0 && !lowStockDismissed && (
            <div
              role="alert"
              aria-live="polite"
              className="relative min-w-0 flex-1 rounded-2xl bg-ink px-3 py-3 text-white sm:min-w-[9.5rem] lg:flex-none"
            >
              <button
                type="button"
                className="flex w-full items-center gap-2 pr-5 text-left"
                onClick={() => setShowLowStockModal(true)}
              >
                <span className="rounded-lg bg-amber-400/15 p-1.5 text-amber-300">
                  <PackageSearch className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.18em] text-accent">Stok menipis</span>
                  <span className="mt-1 block truncate text-sm font-semibold">{stats.lowStock} produk</span>
                </span>
              </button>
              {notificationPermission === 'default' && (
                <button
                  type="button"
                  className="mt-2 text-left text-[10px] font-semibold text-accent underline-offset-2 hover:underline"
                  onClick={enableStockNotifications}
                >
                  Aktifkan notifikasi
                </button>
              )}
              <button
                type="button"
                aria-label="Tutup notifikasi stok menipis"
                className="absolute right-2 top-2 hidden rounded-md p-1 text-stone-300 hover:bg-white/10 hover:text-white lg:block"
                onClick={dismissLowStockAlert}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
        {error && <p className="sr-only" role="status">{error}</p>}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.title} className="relative overflow-hidden border-0">
                <c.icon
                  aria-hidden="true"
                  className={`pointer-events-none absolute -right-3 -top-3 h-24 w-24 rotate-12 ${c.watermark}`}
                />
                <CardContent className="relative z-10 flex items-start gap-3 p-4">
              <div className={`rounded-xl p-2.5 ${c.color}`}>
                <c.icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs text-muted-foreground">{c.title}</p>
                <p className="truncate text-lg font-bold text-ink">
                  {loading ? '...' : c.value}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="relative overflow-hidden border-0">
        <DollarSign aria-hidden="true" className="pointer-events-none absolute -right-3 -top-3 h-24 w-24 -rotate-12 text-amber-600/[0.09]" />
        <CardHeader className="relative z-10 border-b border-stone-100 pb-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <CardTitle className="text-base">Rincian Transaksi Hari Ini</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Jumlah transaksi berdasarkan metode pembayaran</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Total</p>
              <p className="text-2xl font-bold text-ink">{loading ? '...' : formatNumber(stats.todayOrders)}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="relative z-10 grid grid-cols-2 gap-3 pt-4 sm:grid-cols-4">
          {([
            ['CASH', stats.todayPaymentTotals.cash, stats.todayPaymentCounts.cash, 'bg-teal-50 text-teal-800'],
            ['KREDIT', stats.todayPaymentTotals.credit, stats.todayPaymentCounts.credit, 'bg-amber-50 text-amber-800'],
            ['TRANSFER', stats.todayPaymentTotals.transfer, stats.todayPaymentCounts.transfer, 'bg-blue-50 text-blue-800'],
            ['QR', stats.todayPaymentTotals.qris, stats.todayPaymentCounts.qris, 'bg-violet-50 text-violet-800'],
          ] as const).map(([label, total, count, color]) => (
            <div key={label} className={`rounded-xl px-4 py-3 ${color}`}>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] opacity-80">{label}</p>
              <p className="mt-1 text-lg font-bold">{loading ? '...' : formatCurrency(total)}</p>
              <p className="mt-0.5 text-xs opacity-75">{loading ? '...' : `${formatNumber(count)} transaksi`}</p>
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
                      <strong className="text-amber-700">{formatNumber(product.stock)}</strong>
                      <span className="text-muted-foreground"> / min. {formatNumber(product.min_stock)}</span>
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
