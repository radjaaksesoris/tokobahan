import { useEffect, useState } from 'react'
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
import { playLowStockSound } from '@/lib/notifications'
import { CurrentDate } from '@/components/layout/CurrentDate'

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

function attachNotificationClick(notification: Notification) {
  notification.onclick = () => {
    notification.close()
    window.focus()
    window.location.assign(`${import.meta.env.BASE_URL}`)
  }
}

export default function Dashboard() {
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
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported',
  )

  useEffect(() => {
    loadStats()

    // Realtime subscription for sales
    const channel = supabase
      .channel('dashboard-sales')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'sales' },
        () => loadStats()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  async function loadStats() {
    setLoading(true)
    setError(null)
    const todayStart = startOfDay(new Date()).toISOString()
    const todayEnd = endOfDay(new Date()).toISOString()

    const [salesRes, productsRes, weekSales] = await Promise.all([
      supabase
        .from('sales')
        .select('total_amount, total_profit')
        .gte('created_at', todayStart)
        .lte('created_at', todayEnd),
      supabase.from('products').select('id, name, stock, min_stock').eq('is_active', true),
      supabase.rpc('sales_daily_summary', {
        p_start: startOfDay(subDays(new Date(), 6)).toISOString(),
        p_end: endOfDay(new Date()).toISOString(),
      }),
    ])

    const queryError = salesRes.error || productsRes.error || weekSales.error
    if (queryError) {
      setError(queryError.message)
      setLoading(false)
      return
    }
    const todaySales = salesRes.data?.reduce((s, r) => s + Number(r.total_amount), 0) ?? 0
    const todayProfit = salesRes.data?.reduce((s, r) => s + Number(r.total_profit), 0) ?? 0
    const todayOrders = salesRes.data?.length ?? 0
    const totalProducts = productsRes.data?.length ?? 0
    const lowStockRows = (productsRes.data || []).filter((p) => p.stock <= p.min_stock) as LowStockProduct[]
    const lowStock = lowStockRows.length
    setLowStockProducts(lowStockRows)
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
      toast.warning(`Stok menipis: ${product.name}`, {
        description: `Tersisa ${product.stock}, minimum stok ${product.min_stock}.`,
      })
      if (newProducts.length > 0) playLowStockSound()
      notifiedIds.add(product.id)
    })
    window.localStorage.setItem(LOW_STOCK_NOTIFIED_KEY, JSON.stringify([...notifiedIds]))

    if (notificationPermission === 'granted') {
      newProducts.forEach((product) => {
        const notification = new Notification(`Stok menipis: ${product.name}`, {
          body: `Tersisa ${product.stock}, minimum stok ${product.min_stock}.`,
          icon: `${import.meta.env.BASE_URL}icon-192.png`,
          tag: `low-stock-${product.id}`,
        })
        attachNotificationClick(notification)
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
      toast.success('Notifikasi stok diaktifkan')
      lowStockProducts.forEach((product) => {
        const notification = new Notification(`Stok menipis: ${product.name}`, {
          body: `Tersisa ${product.stock}, minimum stok ${product.min_stock}.`,
          icon: `${import.meta.env.BASE_URL}icon-192.png`,
          tag: `low-stock-${product.id}`,
        })
        attachNotificationClick(notification)
      })
    } else {
      toast.error('Izin notifikasi stok ditolak')
    }
  }

  const cards = [
    {
      title: 'Penjualan Hari Ini',
      value: formatCurrency(stats.todaySales),
      icon: ShoppingBag,
      color: 'bg-teal-100 text-teal-700',
    },
    {
      title: 'Laba Bersih Hari Ini',
      value: formatCurrency(stats.todayProfit),
      icon: TrendingUp,
      color: 'bg-emerald-100 text-emerald-700',
    },
    {
      title: 'Transaksi Hari Ini',
      value: formatNumber(stats.todayOrders),
      icon: DollarSign,
      color: 'bg-amber-100 text-amber-700',
    },
    {
      title: 'Produk Aktif',
      value: formatNumber(stats.totalProducts),
      icon: Package,
      color: 'bg-blue-100 text-blue-700',
    },
  ]

  return (
    <div className="mx-auto max-w-[1440px] space-y-7">
      <div className="flex flex-col gap-4 border-b border-stone-300/80 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-primary">Ringkasan operasional</p>
          <h2 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">Dashboard</h2>
          <p className="mt-1 max-w-[42rem] text-sm text-slate-500">Pantau arus penjualan, laba, dan stok dari satu ruang kerja.</p>
        </div>
        <div className="flex items-start gap-4">
          <CurrentDate />
          <div className="self-start rounded-2xl bg-ink px-4 py-3 text-white sm:self-auto">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">Status toko</p>
            <p className="mt-1 flex items-center gap-2 text-sm font-semibold"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Operasional aktif</p>
          </div>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.title} className="overflow-hidden border-0">
            <CardContent className="flex items-start gap-3 p-4">
              <div className={`rounded-xl p-2.5 ${c.color}`}>
                <c.icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-slate-500 truncate">{c.title}</p>
                <p className="text-lg font-bold text-slate-900 truncate">
                  {loading ? '...' : c.value}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {stats.lowStock > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              className="text-left underline-offset-2 hover:underline"
              onClick={() => setShowLowStockModal(true)}
            >
              <strong>{stats.lowStock}</strong> produk stok menipis. Segera restock!
            </button>
            <div className="flex shrink-0 items-center gap-2">
              {notificationPermission === 'default' && (
                <button
                  className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                  onClick={enableStockNotifications}
                >
                  Aktifkan notifikasi
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <Card className="overflow-hidden border-0">
          <CardHeader>
            <CardTitle className="text-base">Penjualan 7 Hari</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
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

        <Card className="overflow-hidden border-0">
          <CardHeader>
            <CardTitle className="text-base">Laba 7 Hari</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
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
                <p className="mt-1 text-sm text-slate-500">{lowStockProducts.length} produk perlu segera direstock.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowLowStockModal(false)}
                aria-label="Tutup daftar stok menipis"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </CardHeader>
            <CardContent className="overflow-y-auto p-0">
              <ul className="divide-y divide-stone-200">
                {lowStockProducts.map((product) => (
                  <li key={product.id} className="flex items-center justify-between gap-4 px-6 py-4">
                    <span className="min-w-0 truncate font-medium text-slate-800">{product.name}</span>
                    <span className="shrink-0 text-right text-sm">
                      <strong className="text-amber-700">{formatNumber(product.stock)}</strong>
                      <span className="text-slate-500"> / min. {formatNumber(product.min_stock)}</span>
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
