import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { formatCurrency, formatNumber } from '@/lib/utils'
import { format, startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, startOfYear, endOfYear } from 'date-fns'
import { id as localeId } from 'date-fns/locale'
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Percent,
  Coins,
  Calendar,
  X,
  WalletCards,
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

type Period = 'today' | 'week' | 'month' | 'year' | 'custom'

interface DailySummaryRow {
  sale_date: string
  total_revenue: number
  total_cost: number
  total_profit: number
  transaction_count: number
}
interface VendorPaymentRow {
  amount: number
  paid_at: string
}

export default function Reports() {
  const [period, setPeriod] = useState<Period>('today')
  const [selectedDate, setSelectedDate] = useState('')
  const [dailySummary, setDailySummary] = useState<DailySummaryRow[]>([])
  const [vendorPayments, setVendorPayments] = useState<VendorPaymentRow[]>([])
  const [summary, setSummary] = useState({
    total_revenue: 0,
    total_cost: 0,
    total_profit: 0,
    transaction_count: 0,
  })
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)

  useEffect(() => {
    load()

    const channel = supabase
      .channel('reports-sales')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'sales' },
        () => load(),
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [period, selectedDate])

  function getRange() {
    const now = new Date()
    if (period === 'custom' && selectedDate) {
      const selected = new Date(`${selectedDate}T00:00:00`)
      return { start: startOfDay(selected), end: endOfDay(selected) }
    }
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
    const currentRequest = ++requestId.current
    setError(null)
    const { start, end } = getRange()
    const [
      { data: summaryData, error: summaryError },
      { data: dailyData, error: dailyError },
      { data: vendorPaymentData, error: vendorPaymentError },
    ] = await Promise.all([
      supabase.rpc('sales_summary', {
        p_start: start.toISOString(),
        p_end: end.toISOString(),
      }),
      supabase.rpc('sales_daily_summary', {
        p_start: start.toISOString(),
        p_end: end.toISOString(),
      }),
      supabase
        .from('vendor_debt_payments')
        .select('amount, paid_at')
        .gte('paid_at', start.toISOString())
        .lte('paid_at', end.toISOString()),
    ])
    if (currentRequest !== requestId.current) return

    if (dailyError) {
      setDailySummary([])
      setError(dailyError.message || 'Gagal memuat grafik laporan')
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
    if (vendorPaymentError) {
      setVendorPayments([])
      setError(vendorPaymentError.message || 'Gagal memuat pembayaran vendor')
    } else {
      setVendorPayments((vendorPaymentData || []) as VendorPaymentRow[])
    }
  }

  const totalRevenue = Number(summary.total_revenue)
  const totalCost = Number(summary.total_cost)
  const totalProfit = Number(summary.total_profit)
  const zakatAmount = Math.max(0, totalProfit) * 0.025
  const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0
  const totalVendorPayments = vendorPayments.reduce((sum, payment) => sum + Number(payment.amount), 0)
  const netCash = totalRevenue - totalVendorPayments

  // daily breakdown for chart
  const dailyMap: Record<string, { revenue: number; cost: number; profit: number; vendorPayments: number }> = {}
  dailySummary.forEach((s) => {
    const d = s.sale_date
    dailyMap[d] = {
      revenue: Number(s.total_revenue),
      cost: Number(s.total_cost),
      profit: Number(s.total_profit),
      vendorPayments: 0,
    }
  })
  vendorPayments.forEach((payment) => {
    const date = payment.paid_at.slice(0, 10)
    if (!dailyMap[date]) dailyMap[date] = { revenue: 0, cost: 0, profit: 0, vendorPayments: 0 }
    dailyMap[date].vendorPayments += Number(payment.amount)
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
      <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-primary">Baca performa toko</p>
          <h2 className="text-3xl font-bold tracking-tight text-ink">Laporan laba rugi</h2>
          <p className="mt-1 text-sm text-muted-foreground">Uang masuk, biaya, dan laba bersih.</p>
        </div>
        <div className="flex gap-1 rounded-xl border border-border bg-surface p-1">
          {periods.map((p) => (
            <button
              key={p.key}
              onClick={() => {
                setPeriod(p.key)
                setSelectedDate('')
              }}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                period === p.key
                  ? 'bg-ink text-white'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {p.label}
            </button>
          ))}
          <div className="relative ml-1 flex h-9 min-w-[7.5rem] items-center rounded-md border border-border bg-surface">
            <Calendar className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted-foreground" />
            <span className="pointer-events-none pl-8 pr-7 text-sm text-muted-foreground">
              {selectedDate ? format(new Date(`${selectedDate}T00:00:00`), 'dd MMM yyyy', { locale: localeId }) : 'Tanggal'}
            </span>
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => {
                setSelectedDate(event.target.value)
                if (event.target.value) setPeriod('custom')
              }}
              aria-label="Pilih tanggal laporan"
              className="absolute inset-0 h-full w-full cursor-pointer rounded-md border-0 bg-transparent text-transparent opacity-0 outline-none"
              title="Pilih tanggal laporan"
            />
            {selectedDate && (
              <button
                type="button"
                onClick={() => {
                  setSelectedDate('')
                  setPeriod('today')
                }}
                className="absolute right-1.5 rounded p-1 text-muted-foreground hover:bg-muted hover:text-ink"
                aria-label="Hapus filter tanggal"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-10">
        <Card className="relative overflow-hidden lg:col-span-2">
          <DollarSign className="pointer-events-none absolute -right-3 -top-3 h-24 w-24 rotate-12 text-teal-700/[0.08]" />
          <CardContent className="relative z-10 p-4">
            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
              <DollarSign className="h-4 w-4" /> Uang Masuk
            </div>
            <p className="text-xl font-bold text-ink">{formatCurrency(totalRevenue)}</p>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden lg:col-span-2">
          <WalletCards className="pointer-events-none absolute -right-3 -top-3 h-24 w-24 rotate-12 text-orange-600/[0.09]" />
          <CardContent className="relative z-10 p-4">
            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
              <WalletCards className="h-4 w-4" /> Bayar Vendor
            </div>
            <p className="text-xl font-bold text-orange-600">{formatCurrency(totalVendorPayments)}</p>
            <p className="text-xs text-muted-foreground">Uang keluar</p>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden border-emerald-200 bg-emerald-50 lg:col-span-2">
          <DollarSign className="pointer-events-none absolute -right-3 -top-3 h-24 w-24 text-emerald-700/[0.12]" />
          <CardContent className="relative z-10 p-4">
            <div className="mb-1 flex items-center gap-2 text-xs font-medium text-emerald-900">
              <DollarSign className="h-4 w-4" /> Kas Bersih
            </div>
            <p className={`text-xl font-bold ${netCash >= 0 ? 'text-emerald-800' : 'text-red-700'}`}>{formatCurrency(netCash)}</p>
            <p className="text-xs text-emerald-800/80">Uang masuk - vendor</p>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden lg:col-span-2">
          <TrendingDown className="pointer-events-none absolute -right-3 -top-3 h-24 w-24 -rotate-12 text-red-600/[0.08]" />
          <CardContent className="relative z-10 p-4">
            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
              <TrendingDown className="h-4 w-4" /> HPP / Modal
            </div>
            <p className="text-xl font-bold text-red-600">{formatCurrency(totalCost)}</p>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden lg:col-span-2">
          <TrendingUp className="pointer-events-none absolute -right-3 -top-3 h-24 w-24 rotate-12 text-emerald-600/[0.09]" />
          <CardContent className="relative z-10 p-4">
            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
              <TrendingUp className="h-4 w-4" /> Laba Bersih
            </div>
            <p className="text-xl font-bold text-emerald-600">{formatCurrency(totalProfit)}</p>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden lg:col-span-5">
          <Percent className="pointer-events-none absolute -right-3 -top-3 h-24 w-24 -rotate-12 text-teal-700/[0.08]" />
          <CardContent className="relative z-10 p-4">
            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
              <DollarSign className="h-4 w-4" /> Margin
            </div>
            <p className="text-xl font-bold text-teal-700">{margin.toFixed(1)}%</p>
            <p className="text-xs text-muted-foreground">{formatNumber(summary.transaction_count)} transaksi</p>
          </CardContent>
        </Card>
        <Card className="relative col-span-2 overflow-hidden lg:col-span-5">
          <Coins className="pointer-events-none absolute -right-3 -top-3 h-24 w-24 rotate-12 text-amber-600/[0.09]" />
          <CardContent className="relative z-10 p-4">
            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
              <DollarSign className="h-4 w-4" /> Zakat (2,5%)
            </div>
            <p className="text-xl font-bold text-amber-600">{formatCurrency(zakatAmount)}</p>
            <p className="text-xs text-muted-foreground">Dari laba bersih</p>
          </CardContent>
        </Card>
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Arus Kas dan Laba</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-80 lg:h-64">
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
                  <Bar dataKey="revenue" name="Uang Masuk" fill="#0f766e" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="profit" name="Laba" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="vendorPayments" name="Bayar Vendor" fill="#ea580c" radius={[3, 3, 0, 0]} />
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
