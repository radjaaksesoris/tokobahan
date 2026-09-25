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
import { readOfflineCacheEntry, writeOfflineCache } from '@/lib/offlineCache'

type Period = 'today' | 'week' | 'month' | 'year' | 'custom'

interface DailySummaryRow {
  sale_date: string
  total_revenue: number
  total_credit: number
  total_cost: number
  total_profit: number
  transaction_count: number
}
interface VendorPaymentRow {
  total_amount: number
  paid_date: string
}

const chartColors = {
  revenue: '#0f766e',
  credit: '#b45309',
  profit: '#d97706',
  vendorPayments: '#c2410c',
  axis: '#526064',
  grid: '#d9e1df',
} as const

export default function Reports() {
  const [period, setPeriod] = useState<Period>('today')
  const [selectedDate, setSelectedDate] = useState('')
  const [dailySummary, setDailySummary] = useState<DailySummaryRow[]>([])
  const [vendorPayments, setVendorPayments] = useState<VendorPaymentRow[]>([])
  const [summary, setSummary] = useState({
    total_revenue: 0,
    total_credit: 0,
    total_cost: 0,
    total_profit: 0,
    transaction_count: 0,
  })
  const [error, setError] = useState<string | null>(null)
  const [cachedAt, setCachedAt] = useState<number | null>(null)
  const requestId = useRef(0)

  useEffect(() => {
    let refreshTimer: number | null = null
    const scheduleRefresh = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null
        void load()
      }, 750)
    }

    void load()

    const channel = supabase
      .channel('reports-sales')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'sales' },
        () => scheduleRefresh(),
      )
      .subscribe()

    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer)
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
      supabase.rpc('vendor_payment_daily_summary', {
        p_start: start.toISOString(),
        p_end: end.toISOString(),
      }),
    ])
    if (currentRequest !== requestId.current) return

    const cacheKey = `reports:${period}:${selectedDate || 'current'}`
    if (summaryError || dailyError || vendorPaymentError) {
      const cached = readOfflineCacheEntry<{ summary: typeof summary; dailySummary: DailySummaryRow[]; vendorPayments: VendorPaymentRow[] }>(cacheKey)
      if (cached) { setSummary(cached.value.summary); setDailySummary(cached.value.dailySummary); setVendorPayments(cached.value.vendorPayments); setCachedAt(cached.cachedAt); setError(null) }
      else setError(summaryError?.message || dailyError?.message || vendorPaymentError?.message || 'Laporan belum tersedia secara offline')
      return
    }
    const nextSummary = summaryData?.[0] || { total_revenue: 0, total_credit: 0, total_cost: 0, total_profit: 0, transaction_count: 0 }
    const nextDailySummary = (dailyData || []) as DailySummaryRow[]
    const nextVendorPayments = (vendorPaymentData || []) as VendorPaymentRow[]
    setSummary(nextSummary); setDailySummary(nextDailySummary); setVendorPayments(nextVendorPayments); setCachedAt(Date.now())
    writeOfflineCache(cacheKey, { summary: nextSummary, dailySummary: nextDailySummary, vendorPayments: nextVendorPayments })
  }

  const totalRevenue = Number(summary.total_revenue)
  const totalCredit = Number(summary.total_credit || 0)
  const totalCost = Number(summary.total_cost)
  const totalProfit = Number(summary.total_profit)
  const zakatAmount = Math.max(0, totalProfit) * 0.025
  const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0
  const totalVendorPayments = vendorPayments.reduce((sum, payment) => sum + Number(payment.total_amount), 0)
  const netCash = totalRevenue - totalVendorPayments

  // daily breakdown for chart
  const dailyMap: Record<string, { revenue: number; credit: number; cost: number; profit: number; vendorPayments: number }> = {}
  dailySummary.forEach((s) => {
    const d = s.sale_date
    dailyMap[d] = {
      revenue: Number(s.total_revenue),
      credit: Number(s.total_credit || 0),
      cost: Number(s.total_cost),
      profit: Number(s.total_profit),
      vendorPayments: 0,
    }
  })
  vendorPayments.forEach((payment) => {
    const date = payment.paid_date
    if (!dailyMap[date]) dailyMap[date] = { revenue: 0, credit: 0, cost: 0, profit: 0, vendorPayments: 0 }
    dailyMap[date].vendorPayments += Number(payment.total_amount)
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
      <div className="sticky top-[-1rem] z-30 -mx-4 -mt-4 flex min-h-[9rem] flex-col gap-4 bg-ink px-4 py-5 text-white shadow-[0_3px_0_rgba(32,42,46,0.2)] sm:top-[-1.25rem] sm:-mx-5 sm:-mt-5 sm:flex-row sm:items-end sm:justify-between sm:px-5 lg:top-[-2rem] lg:-mx-8 lg:-mt-8 lg:min-h-[9rem] lg:px-8 lg:py-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white">Laporan laba rugi</h2>
          <p className="mt-1 text-xs text-accent">
            {cachedAt
              ? `${navigator.onLine ? 'Snapshot cache terbaru' : 'Offline · '}Diperbarui ${format(new Date(cachedAt), 'dd MMM yyyy HH:mm', { locale: localeId })}`
              : 'Snapshot cache terbaru · Memuat...'}
          </p>
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

      <Card className="overflow-hidden border-primary/15 bg-primary text-white shadow-[0_16px_32px_rgba(33,108,104,0.16)]">
        <CardContent className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="max-w-xl">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/70">Kesimpulan periode ini</p>
            <h3 className="mt-2 text-2xl font-bold tracking-tight">Laba bersih {formatCurrency(totalProfit)}</h3>
            <p className="mt-2 text-sm leading-6 text-white/80">
              Setelah dikurangi modal barang {formatCurrency(totalCost)}, setiap Rp100 penjualan menghasilkan laba sekitar Rp{Math.round(margin)}.
            </p>
          </div>
          <div className="shrink-0 rounded-2xl bg-white/10 px-5 py-4 sm:min-w-44">
            <div className="flex items-center gap-2 text-sm text-white/75">
              <TrendingUp className="h-4 w-4" /> Margin laba
            </div>
            <p className="mt-1 text-3xl font-bold tabular-nums">{margin.toFixed(1)}%</p>
            <p className="mt-1 text-xs text-white/65">{formatNumber(summary.transaction_count)} transaksi</p>
          </div>
        </CardContent>
      </Card>

      <section aria-labelledby="cash-flow-heading">
        <div className="mb-3">
          <h3 id="cash-flow-heading" className="text-lg font-bold text-ink">Uang yang bergerak</h3>
          <p className="text-sm text-muted-foreground">Bagian ini menjawab: uang masuk berapa, keluar berapa, dan sisanya berapa.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {[
            { label: 'Uang masuk dari penjualan', value: totalRevenue, note: 'Total penjualan pada periode ini', icon: DollarSign, tone: 'border-primary/20 bg-primary/5 text-primary' },
            { label: 'Bayar vendor', value: totalVendorPayments, note: 'Uang yang dibayarkan ke vendor', icon: WalletCards, tone: 'border-orange-200 bg-orange-50 text-orange-700' },
            { label: 'Kas bersih', value: netCash, note: 'Uang masuk dikurangi bayar vendor', icon: WalletCards, tone: netCash >= 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700' },
          ].map((item) => (
            <Card key={item.label} className={`border ${item.tone}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">{item.label}</p>
                    <p className="mt-2 text-2xl font-bold tabular-nums text-ink">{formatCurrency(item.value)}</p>
                  </div>
                  <item.icon className="h-5 w-5 shrink-0 opacity-70" />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{item.note}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="sales-result-heading">
        <div className="mb-3">
          <h3 id="sales-result-heading" className="text-lg font-bold text-ink">Hasil penjualan</h3>
          <p className="text-sm text-muted-foreground">Angka yang menjelaskan apakah penjualan menghasilkan keuntungan.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Modal barang (HPP)', value: totalCost, note: 'Modal yang melekat pada barang terjual', icon: TrendingDown },
            { label: 'Penjualan kredit', value: totalCredit, note: 'Belum seluruhnya diterima tunai', icon: WalletCards },
            { label: 'Jumlah transaksi', value: formatNumber(summary.transaction_count), note: 'Transaksi yang tercatat', icon: Calendar },
            { label: 'Perkiraan zakat 2,5%', value: zakatAmount, note: '2,5% dari laba bersih positif', icon: Coins },
          ].map((item) => (
            <Card key={item.label} className="border-border bg-surface">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                  <item.icon className="h-4 w-4 text-primary" /> {item.label}
                </div>
                <p className="mt-2 text-xl font-bold tabular-nums text-ink">
                  {typeof item.value === 'number' ? formatCurrency(item.value) : item.value}
                </p>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.note}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

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
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                  <XAxis
                    dataKey="date"
                    axisLine={{ stroke: chartColors.axis }}
                    tickLine={{ stroke: chartColors.axis }}
                    tick={{ fontSize: 11, fill: chartColors.axis }}
                  />
                  <YAxis
                    axisLine={{ stroke: chartColors.axis }}
                    tickLine={{ stroke: chartColors.axis }}
                    tick={{ fontSize: 11, fill: chartColors.axis }}
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    formatter={(v: number) => formatCurrency(v)}
                    contentStyle={{
                      borderRadius: 10,
                      border: `1px solid ${chartColors.grid}`,
                      backgroundColor: '#202a2e',
                      color: '#fffdf8',
                      boxShadow: '0 8px 24px rgba(32,42,46,0.18)',
                    }}
                    labelStyle={{ color: '#e4a853', fontWeight: 700 }}
                    itemStyle={{ color: '#fffdf8' }}
                  />
                  <Legend
                    wrapperStyle={{ color: chartColors.axis, fontSize: 13, paddingTop: 8 }}
                    formatter={(value) => <span className="font-semibold text-ink">{value}</span>}
                  />
                  <Bar
                    dataKey="revenue"
                    name="Uang Masuk"
                    fill={chartColors.revenue}
                    fillOpacity={1}
                    stroke={chartColors.revenue}
                    strokeWidth={1}
                    radius={[3, 3, 0, 0]}
                  />
                  <Bar
                    dataKey="credit"
                    name="Kredit"
                    fill={chartColors.credit}
                    fillOpacity={1}
                    stroke={chartColors.credit}
                    strokeWidth={1}
                    radius={[3, 3, 0, 0]}
                  />
                  <Bar
                    dataKey="profit"
                    name="Laba"
                    fill={chartColors.profit}
                    fillOpacity={1}
                    stroke={chartColors.profit}
                    strokeWidth={1}
                    radius={[3, 3, 0, 0]}
                  />
                  <Bar
                    dataKey="vendorPayments"
                    name="Bayar Vendor"
                    fill={chartColors.vendorPayments}
                    fillOpacity={1}
                    stroke={chartColors.vendorPayments}
                    strokeWidth={1}
                    radius={[3, 3, 0, 0]}
                  />
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
