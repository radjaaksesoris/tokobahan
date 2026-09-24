import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { formatCurrency, formatNumber } from '@/lib/utils'
import {
  TrendingUp,
  ShoppingBag,
  Package,
  DollarSign,
  AlertTriangle,
  X,
} from 'lucide-react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from 'recharts'
import { format, subDays, startOfDay, endOfDay } from 'date-fns'
import { id as localeId } from 'date-fns/locale'
import { toast } from 'sonner'
import { playLowStockSound, registerPushSubscription, showLowStockNotification } from '@/lib/notifications'
import { useAuthStore } from '@/store/useAuthStore'

interface Stats {
  todaySales: number
  todayProfit: number
  todayOrders: number
  totalProducts: number
  lowStock: number
  weekData: { date: string; sales: number; profit: number }[]
}

interface LowStockProduct {
  id: string
  name: string
  stock: number
  min_stock: number
}

const LOW_STOCK_NOTIFIED_KEY = 'tokobahan.low-stock-notified'

export default function Dashboard() {
  const signOut = useAuthStore((state) => state.signOut)
  const navigate = useNavigate()
  const [stats, setStats] = useState<Stats>({
    todaySales: 0,
    todayProfit: 0,
    todayOrders: 0,
    totalProducts: 0,
    lowStock: 0,
    weekData: [],
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lowStockProducts, setLowStockProducts] = useState<LowStockProduct[]>([])
  const [showLowStockModal, setShowLowStockModal] = useState(false)
  const [lowStockDismissed, setLowStockDismissed] = useState(false)
  const [lowStockSwipeOffset, setLowStockSwipeOffset] = useState(0)
  const lowStockTouchStart = useRef<number | null>(null)
  const statsRequestId = useRef(0)
  const initialLoadComplete = useRef(false)
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported',
  )

  async function handleMobileStatusLogout() {
    if (!window.matchMedia('(max-width: 1023px)').matches) return
    await signOut()
    navigate('/login', { replace: true })
  }

  useEffect(() => {
    let refreshTimer: number | null = null
    const scheduleRefresh = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null
        void loadStats()
      }, 750)
    }

    void loadStats()

    // Realtime subscription for sales
    const channel = supabase
      .channel('dashboard-sales')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'sales' },
        () => scheduleRefresh()
      )
      .subscribe()

    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer)
      supabase.removeChannel(channel)
    }
  }, [])

  async function loadStats() {
    const requestId = ++statsRequestId.current
    if (!initialLoadComplete.current) setLoading(true)
    setError(null)
    const todayStart = startOfDay(new Date()).toISOString()
    const todayEnd = endOfDay(new Date()).toISOString()

    const [todaySummaryRes, inventoryRes, weekSales] = await Promise.all([
      supabase
        .rpc('sales_summary', {
          p_start: todayStart,
          p_end: todayEnd,
        }),
      supabase.rpc('inventory_summary'),
      supabase.rpc('sales_daily_summary', {
        p_start: startOfDay(subDays(new Date(), 6)).toISOString(),
        p_end: endOfDay(new Date()).toISOString(),
      }),
    ])

    const queryError = todaySummaryRes.error || inventoryRes.error || weekSales.error
    if (requestId !== statsRequestId.current) return
    if (queryError) {
      setError(queryError.message)
      setLoading(false)
      initialLoadComplete.current = true
      return
    }

    const todaySummary = todaySummaryRes.data?.[0]
    const todaySales = Number(todaySummary?.total_revenue ?? 0)
    const todayProfit = Number(todaySummary?.total_profit ?? 0)
    const todayOrders = Number(todaySummary?.transaction_count ?? 0)
    const inventory = (inventoryRes.data || {}) as {
      total_products?: number
      low_stock_count?: number
      low_stock_products?: LowStockProduct[]
    }
    const totalProducts = Number(inventory.total_products || 0)
    const lowStockRows = inventory.low_stock_products || []
    const lowStock = Number(inventory.low_stock_count || 0)
    setLowStockProducts(lowStockRows)
    if (lowStock === 0) setLowStockDismissed(false)
    notifyLowStock(lowStockRows)

    // Aggregate week
    const days: Record<string, { sales: number; profit: number }> = {}
    for (let i = 6; i >= 0; i--) {
      const d = format(subDays(new Date(), i), 'yyyy-MM-dd')
      days[d] = { sales: 0, profit: 0 }
    }
    weekSales.data?.forEach((s) => {
      const d = s.sale_date
      if (days[d]) {
        days[d].sales += Number(s.total_revenue)
        days[d].profit += Number(s.total_profit)
      }
    })

    const weekData = Object.entries(days).map(([date, v]) => ({
      date: format(new Date(date), 'EEE', { locale: localeId }),
      sales: v.sales,
      profit: v.profit,
    }))

    setStats({ todaySales, todayProfit, todayOrders, totalProducts, lowStock, weekData })
    setLoading(false)
    initialLoadComplete.current = true
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
    const notifiedIds = new Set(storedIds)
    const newProducts = products.filter((product) => !notifiedIds.has(product.id))
    newProducts.forEach((product) => {
      toast.custom((toastId) => (
        <div className="stock-toast" role="status">
          <span className="stock-toast-icon">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="stock-toast-content">
            <p className="stock-toast-title">Stok menipis</p>
            <p className="stock-toast-product">{product.name}</p>
            <p className="stock-toast-detail">
              Tersisa <strong>{product.stock}</strong> · minimum <strong>{product.min_stock}</strong>
            </p>
          </div>
          <button
            type="button"
            className="stock-toast-close"
            aria-label="Tutup notifikasi"
            onClick={() => toast.dismiss(toastId)}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ), {
        duration: 6000,
        className: 'stock-toast-wrapper',
      })
      if (newProducts.length > 0) playLowStockSound()
      notifiedIds.add(product.id)
    })
    window.localStorage.setItem(LOW_STOCK_NOTIFIED_KEY, JSON.stringify([...notifiedIds]))

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

  function dismissLowStockAlert(direction: 1 | -1 = 1) {
    setLowStockSwipeOffset(direction * 120)
    window.setTimeout(() => setLowStockDismissed(true), 180)
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
      title: 'Transaksi Hari Ini',
      value: formatNumber(stats.todayOrders),
      icon: DollarSign,
      color: 'bg-amber-100 text-amber-700',
      watermark: 'text-amber-600/[0.09]',
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
      <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">Transaksi Hari Ini</h2>
          <p className="mt-1 text-sm font-medium text-primary">{format(new Date(), 'EEEE, d MMMM yyyy', { locale: localeId })}</p>
        </div>
        <div className="mx-auto flex w-full max-w-md flex-wrap justify-center gap-2 lg:mx-0 lg:w-auto lg:max-w-none lg:flex-nowrap">
          <button
            type="button"
            onClick={handleMobileStatusLogout}
            className="min-w-0 flex-1 rounded-2xl bg-ink px-3 py-3 text-center text-white transition-transform active:scale-[0.98] lg:pointer-events-none lg:flex-none lg:px-4 lg:text-left"
            aria-label="Keluar dari aplikasi"
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">Status toko</p>
            <p className="mt-1 flex items-center justify-center gap-2 text-sm font-semibold lg:justify-start"><span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" /> Operasional aktif</p>
          </button>
          {stats.lowStock > 0 && !lowStockDismissed && (
            <div
              role="alert"
              aria-live="polite"
              className="relative min-w-0 flex-1 touch-pan-y rounded-2xl bg-ink px-3 py-3 text-white transition-[transform,opacity] duration-200 ease-out sm:min-w-[9.5rem] lg:flex-none"
              style={{
                opacity: Math.max(0, 1 - Math.abs(lowStockSwipeOffset) / 120),
                transform: `translateX(${lowStockSwipeOffset}px)`,
              }}
              onTouchStart={(event) => {
                lowStockTouchStart.current = event.touches[0]?.clientX ?? null
              }}
              onTouchMove={(event) => {
                if (lowStockTouchStart.current === null) return
                setLowStockSwipeOffset(event.touches[0].clientX - lowStockTouchStart.current)
              }}
              onTouchEnd={() => {
                const offset = lowStockSwipeOffset
                lowStockTouchStart.current = null
                if (Math.abs(offset) >= 80) {
                  dismissLowStockAlert(offset > 0 ? 1 : -1)
                } else {
                  setLowStockSwipeOffset(0)
                }
              }}
            >
              <button
                type="button"
                className="flex w-full items-center gap-2 pr-5 text-left"
                onClick={() => setShowLowStockModal(true)}
              >
                <span className="rounded-lg bg-amber-400/15 p-1.5 text-amber-300">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-accent">Stok menipis</span>
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
                className="absolute right-2 top-2 rounded-md p-1 text-stone-300 hover:bg-white/10 hover:text-white"
                onClick={() => dismissLowStockAlert()}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <Card className="relative overflow-hidden border-0">
          <TrendingUp aria-hidden="true" className="pointer-events-none absolute -right-3 -top-3 h-24 w-24 rotate-12 text-teal-700/[0.08]" />
          <CardHeader className="relative z-10">
            <CardTitle className="text-base">Penjualan 7 Hari</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-44 sm:h-56 lg:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={stats.weekData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    formatter={(v: number) => formatCurrency(v)}
                    contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="sales"
                    stroke="#0f766e"
                    fill="#99f6e4"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-0">
          <DollarSign aria-hidden="true" className="pointer-events-none absolute -right-3 -top-3 h-24 w-24 -rotate-12 text-amber-600/[0.09]" />
          <CardHeader className="relative z-10">
            <CardTitle className="text-base">Laba 7 Hari</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-44 sm:h-56 lg:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.weekData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    formatter={(v: number) => formatCurrency(v)}
                    contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }}
                  />
                  <Bar dataKey="profit" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

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
