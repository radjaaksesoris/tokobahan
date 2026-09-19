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

interface Stats {
  todaySales: number
  todayProfit: number
  todayOrders: number
  totalProducts: number
  lowStock: number
  weekData: { date: string; sales: number; profit: number }[]
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
      supabase.from('products').select('id, stock, min_stock').eq('is_active', true),
      supabase
        .from('sales')
        .select('total_amount, total_profit, created_at')
        .gte('created_at', startOfDay(subDays(new Date(), 6)).toISOString()),
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
    const lowStock = productsRes.data?.filter((p) => p.stock <= p.min_stock).length ?? 0

    // Aggregate week
    const days: Record<string, { sales: number; profit: number }> = {}
    for (let i = 6; i >= 0; i--) {
      const d = format(subDays(new Date(), i), 'yyyy-MM-dd')
      days[d] = { sales: 0, profit: 0 }
    }
    weekSales.data?.forEach((s) => {
      const d = format(new Date(s.created_at), 'yyyy-MM-dd')
      if (days[d]) {
        days[d].sales += Number(s.total_amount)
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
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Dashboard</h2>
        <p className="text-sm text-slate-500">Monitoring real-time toko grosir</p>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.title}>
            <CardContent className="flex items-start gap-3 p-4">
              <div className={`rounded-lg p-2.5 ${c.color}`}>
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
          <span>
            <strong>{stats.lowStock}</strong> produk stok menipis. Segera restock!
          </span>
        </div>
      )}

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
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

        <Card>
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
    </div>
  )
}
