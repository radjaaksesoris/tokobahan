import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { formatCurrency, formatNumber } from '@/lib/utils'
import { startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, startOfYear, endOfYear } from 'date-fns'
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
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

interface DailySummaryRow {
  sale_date: string
  total_revenue: number
  total_cost: number
  total_profit: number
  transaction_count: number
}

export default function Reports() {
  const [period, setPeriod] = useState<Period>('today')
  const [dailySummary, setDailySummary] = useState<DailySummaryRow[]>([])
  const [summary, setSummary] = useState({
    total_revenue: 0,
    total_cost: 0,
    total_profit: 0,
    transaction_count: 0,
  })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [period])

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
    setError(null)
    const { start, end } = getRange()
    const [{ data: summaryData, error: summaryError }, { data: dailyData, error: dailyError }] = await Promise.all([
      supabase.rpc('sales_summary', {
        p_start: start.toISOString(),
        p_end: end.toISOString(),
      }),
      supabase.rpc('sales_daily_summary', {
        p_start: start.toISOString(),
        p_end: end.toISOString(),
      }),
    ])

    if (dailyError) {
      setDailySummary([])
    } else {
      setDailySummary((dailyData || []) as DailySummaryRow[])
    }

    if (summaryError) {
      setError(summaryError.message || 'Gagal memuat ringkasan laporan')
      setSummary({
        total_revenue: 0,
        total_cost: 0,
        total_profit: 0,
        transaction_count: 0,
      })
    } else {
      setSummary(summaryData?.[0] || {
        total_revenue: 0,
        total_cost: 0,
        total_profit: 0,
        transaction_count: 0,
      })
    }
  }

  const totalRevenue = Number(summary.total_revenue)
  const totalCost = Number(summary.total_cost)
  const totalProfit = Number(summary.total_profit)
  const zakatAmount = Math.max(0, totalProfit) * 0.025
  const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0

  // daily breakdown for chart
  const dailyMap: Record<string, { revenue: number; cost: number; profit: number }> = {}
  dailySummary.forEach((s) => {
    const d = s.sale_date
    dailyMap[d] = {
      revenue: Number(s.total_revenue),
      cost: Number(s.total_cost),
      profit: Number(s.total_profit),
    }
  })
  const chartData = Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
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
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

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
              <DollarSign className="h-4 w-4" /> Margin
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
    </div>
  )
}
