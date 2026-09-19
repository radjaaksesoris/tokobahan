import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { formatCurrency, formatNumber } from '@/lib/utils'
import { format, startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, startOfYear, endOfYear } from 'date-fns'
import { id as localeId } from 'date-fns/locale'
import {
  TrendingUp,
  TrendingDown,
  Receipt,
  DollarSign,
  Calendar,
} from 'lucide-react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'

type Period = 'today' | 'week' | 'month' | 'year'

interface SaleRow {
  id: string
  invoice_no: string
  total_amount: number
  total_cost: number
  total_profit: number
  payment_method: string
  created_at: string
}

export default function Reports() {
  const [period, setPeriod] = useState<Period>('today')
  const [sales, setSales] = useState<SaleRow[]>([])
  const [summary, setSummary] = useState({
    total_revenue: 0,
    total_cost: 0,
    total_profit: 0,
    transaction_count: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const pageSize = 100

  useEffect(() => {
    load()
  }, [period, page])

  function getRange() {
    const now = new Date()
    if (period === 'today') {
      return { start: startOfDay(now), end: endOfDay(now) }
    }
    if (period === 'week') {
      return { start: startOfDay(subDays(now, 6)), end: endOfDay(now) }
    }
    if (period === 'year') {
      return { start: startOfYear(now), end: endOfYear(now) }
    }
    return { start: startOfMonth(now), end: endOfMonth(now) }
  }

  async function load() {
    setLoading(true)
    setError(null)
    const { start, end } = getRange()
    const [{ data, error: queryError }, { data: summaryData, error: summaryError }] = await Promise.all([
      supabase
      .from('sales')
      .select('*')
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())
      .order('created_at', { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1),
      supabase.rpc('sales_summary', {
        p_start: start.toISOString(),
        p_end: end.toISOString(),
      }),
    ])

    if (queryError) {
      setError(queryError.message || 'Gagal memuat transaksi')
      setSales([])
      setLoading(false)
      return
    }

    setSales((data as SaleRow[]) || [])

    if (summaryError) {
      // Older production databases may not have the sales_summary RPC yet.
      // Keep the report usable by calculating the totals from the same date range.
      const { data: fallbackRows, error: fallbackError } = await supabase
        .from('sales')
        .select('total_amount, total_cost, total_profit')
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString())

      if (fallbackError) {
        setError(summaryError.message || 'Gagal memuat ringkasan laporan')
      } else {
        const fallbackSummary = (fallbackRows || []).reduce(
          (result, sale) => ({
            total_revenue: result.total_revenue + Number(sale.total_amount),
            total_cost: result.total_cost + Number(sale.total_cost),
            total_profit: result.total_profit + Number(sale.total_profit),
            transaction_count: result.transaction_count + 1,
          }),
          { total_revenue: 0, total_cost: 0, total_profit: 0, transaction_count: 0 },
        )
        setSummary(fallbackSummary)
      }
    } else {
      setSummary(summaryData?.[0] || {
        total_revenue: 0,
        total_cost: 0,
        total_profit: 0,
        transaction_count: 0,
      })
    }
    setLoading(false)
  }

  const totalRevenue = Number(summary.total_revenue)
  const totalCost = Number(summary.total_cost)
  const totalProfit = Number(summary.total_profit)
  const zakatAmount = Math.max(0, totalProfit) * 0.025
  const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0

  // daily breakdown for chart
  const dailyMap: Record<string, { revenue: number; cost: number; profit: number }> = {}
  sales.forEach((s) => {
    const d = format(new Date(s.created_at), 'yyyy-MM-dd')
    if (!dailyMap[d]) dailyMap[d] = { revenue: 0, cost: 0, profit: 0 }
    dailyMap[d].revenue += Number(s.total_amount)
    dailyMap[d].cost += Number(s.total_cost)
    dailyMap[d].profit += Number(s.total_profit)
  })
  const chartData = Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date: format(new Date(date), 'dd MMM', { locale: localeId }),
      ...v,
    }))

  const periods: { key: Period; label: string }[] = [
    { key: 'today', label: 'Hari Ini' },
    { key: 'week', label: '7 Hari' },
    { key: 'month', label: 'Bulan Ini' },
    { key: 'year', label: 'Tahun Ini' },
  ]

  return (
    <div className="mx-auto max-w-[1440px] space-y-7">
      <div className="flex flex-col gap-4 border-b border-stone-300/80 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-primary">Baca performa toko</p>
          <h2 className="text-3xl font-bold tracking-tight text-ink">Laporan laba rugi</h2>
          <p className="mt-1 text-sm text-slate-500">Pendapatan, biaya, dan laba bersih.</p>
        </div>
        <div className="flex gap-1 rounded-xl border border-stone-300 bg-surface p-1">
          {periods.map((p) => (
            <button
              key={p.key}
              onClick={() => {
                setPeriod(p.key)
                setPage(0)
              }}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                period === p.key
                  ? 'bg-ink text-white'
                  : 'text-slate-600 hover:bg-stone-100'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
              <DollarSign className="h-4 w-4" /> Pendapatan
            </div>
            <p className="text-xl font-bold text-slate-900">{formatCurrency(totalRevenue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
              <TrendingDown className="h-4 w-4" /> HPP / Modal
            </div>
            <p className="text-xl font-bold text-red-600">{formatCurrency(totalCost)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
              <TrendingUp className="h-4 w-4" /> Laba Bersih
            </div>
            <p className="text-xl font-bold text-emerald-600">{formatCurrency(totalProfit)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
              <Receipt className="h-4 w-4" /> Margin
            </div>
            <p className="text-xl font-bold text-teal-700">{margin.toFixed(1)}%</p>
            <p className="text-xs text-slate-400">{formatNumber(summary.transaction_count)} transaksi</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
              <DollarSign className="h-4 w-4" /> Zakat (2,5%)
            </div>
            <p className="text-xl font-bold text-amber-600">{formatCurrency(zakatAmount)}</p>
            <p className="text-xs text-slate-400">Dari laba bersih</p>
          </CardContent>
        </Card>
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Grafik Pendapatan vs Laba</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    formatter={(v: number) => formatCurrency(v)}
                    contentStyle={{ borderRadius: 8 }}
                  />
                  <Legend />
                  <Bar dataKey="revenue" name="Pendapatan" fill="#0f766e" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="profit" name="Laba" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Transaction list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Riwayat Transaksi
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <p className="py-8 text-center text-slate-400">Memuat...</p>
          ) : error ? (
            <p className="py-8 text-center text-red-600">{error}</p>
          ) : sales.length === 0 ? (
            <p className="py-8 text-center text-slate-400">Belum ada transaksi</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {sales.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between px-4 py-3 hover:bg-slate-50"
                >
                  <div>
                    <p className="text-sm font-medium">{s.invoice_no}</p>
                    <p className="text-xs text-slate-400">
                      {format(new Date(s.created_at), 'dd MMM yyyy HH:mm', { locale: localeId })} ·{' '}
                      {s.payment_method}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">{formatCurrency(s.total_amount)}</p>
                    <p className="text-xs text-emerald-600">
                      +{formatCurrency(s.total_profit)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
          {!loading && !error && sales.length === pageSize && (
            <div className="flex items-center justify-between border-t p-4">
              <button
                className="rounded border px-3 py-1 text-sm disabled:opacity-40"
                disabled={page === 0}
                onClick={() => setPage((current) => current - 1)}
              >
                Sebelumnya
              </button>
              <span className="text-xs text-slate-500">Halaman {page + 1}</span>
              <button
                className="rounded border px-3 py-1 text-sm"
                onClick={() => setPage((current) => current + 1)}
              >
                Berikutnya
              </button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
