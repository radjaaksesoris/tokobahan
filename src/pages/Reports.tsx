import { useEffect, useRef, useState } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
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
import { readOperationalSnapshot } from '@/lib/offlineOperationalSnapshot'
import {
  getLocalReportAnalytics,
  type PaymentMethodSummaries,
} from '@/lib/offlineOperationalAnalytics'

type Period = 'today' | 'week' | 'month' | 'year' | 'custom'

interface VendorPaymentRow {
  total_amount: number
  paid_date: string
}

export default function Reports() {
  const [period, setPeriod] = useState<Period>('today')
  const [selectedDate, setSelectedDate] = useState('')
  const [vendorPayments, setVendorPayments] = useState<VendorPaymentRow[]>([])
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodSummaries>({
    cash: { amount: 0, transaction_count: 0 },
    credit: { amount: 0, transaction_count: 0 },
    transfer: { amount: 0, transaction_count: 0 },
    qris: { amount: 0, transaction_count: 0 },
  })
  const [summary, setSummary] = useState({
    total_revenue: 0,
    total_credit: 0,
    total_cost: 0,
    total_profit: 0,
    transaction_count: 0,
  })
  const [error, setError] = useState<string | null>(null)
  const [cachedAt, setCachedAt] = useState<number | null>(null)
  const [dataSource, setDataSource] = useState<'local' | null>(null)
  const requestId = useRef(0)

  useEffect(() => {
    void load()
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
    setCachedAt(null)
    setDataSource(null)
    const { start, end } = getRange()
    let snapshot
    try {
      snapshot = await readOperationalSnapshot()
    } catch (snapshotError) {
      if (currentRequest !== requestId.current) return
      setError(`Gagal membaca snapshot lokal: ${snapshotError instanceof Error ? snapshotError.message : 'Kesalahan tidak diketahui'}`)
      return
    }
    if (currentRequest !== requestId.current) return
    if (!snapshot) {
      setError('Data lokal belum disiapkan. Buka Pengaturan untuk mengambil data awal.')
      return
    }
    try {
      if (!Number.isFinite(Date.parse(snapshot.generated_at))) {
        throw new Error('Waktu pembuatan snapshot lokal tidak valid')
      }
      const analytics = getLocalReportAnalytics(snapshot, start, end)
      setSummary(analytics.summary)
      setPaymentMethods(analytics.paymentMethods)
      setVendorPayments(analytics.vendorPayments)
      setCachedAt(Date.parse(snapshot.generated_at))
      setDataSource('local')
    } catch (snapshotError) {
      setError(`Gagal membaca data snapshot lokal: ${snapshotError instanceof Error ? snapshotError.message : 'Kesalahan tidak diketahui'}`)
    }
  }

  const totalRevenue = Number(summary.total_revenue)
  const totalCost = Number(summary.total_cost)
  const totalProfit = Number(summary.total_profit)
  const zakatAmount = Math.max(0, totalProfit) * 0.025
  const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0
  const totalVendorPayments = vendorPayments.reduce((sum, payment) => sum + Number(payment.total_amount), 0)
  const netCash = totalRevenue - totalVendorPayments

  const periods: { key: Period; label: string }[] = [
    { key: 'today', label: 'Hari Ini' },
    { key: 'week', label: '7 Hari' },
    { key: 'month', label: 'Bulan Ini' },
    { key: 'year', label: 'Tahun Ini' },
  ]

  return (
    <div className="mx-auto max-w-[1440px] space-y-7">
      <div className="page-header sticky top-[-1rem] z-30 -mx-4 -mt-4 flex flex-col gap-4 bg-ink px-4 py-4 text-white shadow-[0_3px_0_rgba(32,42,46,0.2)] sm:top-[-1.25rem] sm:-mx-5 sm:-mt-5 sm:flex-row sm:items-end sm:justify-between sm:px-5 lg:top-[-2rem] lg:-mx-8 lg:-mt-8 lg:px-8 lg:py-5">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white">Laporan laba rugi</h2>
          <p className="mt-1 text-sm text-accent">
            {cachedAt && dataSource === 'local'
              ? `Snapshot lokal · dibuat ${format(new Date(cachedAt), 'dd MMM yyyy HH:mm', { locale: localeId })}`
              : 'Laporan · Memuat...'}
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
        <CardContent className="flex flex-row items-center justify-between gap-3 p-3 sm:p-5">
          <div className="max-w-xl">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/70 sm:text-xs sm:tracking-[0.16em]">Kesimpulan periode ini</p>
            <h3 className="mt-1 text-lg font-bold tracking-tight sm:mt-2 sm:text-2xl">Laba bersih {formatCurrency(totalProfit)}</h3>
          </div>
          <div className="shrink-0 rounded-xl bg-white/10 px-2.5 py-2 sm:min-w-44 sm:rounded-2xl sm:px-4 sm:py-3">
            <div className="flex items-center gap-1.5 text-xs text-white/75 sm:gap-2 sm:text-sm">
              <TrendingUp className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> Margin laba
            </div>
            <p className="mt-0.5 text-xl font-bold tabular-nums sm:mt-1 sm:text-3xl">{margin.toFixed(1)}%</p>
            <p className="mt-0.5 text-[10px] text-white/65 sm:mt-1 sm:text-xs">{formatNumber(summary.transaction_count)} transaksi</p>
          </div>
        </CardContent>
      </Card>

      <section aria-labelledby="cash-flow-heading">
        <div className="mb-3">
          <h3 id="cash-flow-heading" className="text-lg font-bold text-ink">Uang yang bergerak</h3>
          <p className="text-sm text-muted-foreground">Bagian ini menjawab: uang masuk berapa, keluar berapa, dan sisanya berapa.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {[
            { label: 'Uang masuk dari penjualan', value: totalRevenue, note: 'Total penjualan pada periode ini', icon: DollarSign, tone: 'border-primary/20 bg-primary/5 text-primary' },
            { label: 'Bayar vendor', value: totalVendorPayments, note: 'Uang yang dibayarkan ke vendor', icon: WalletCards, tone: 'border-orange-200 bg-orange-50 text-orange-700' },
            { label: 'Kas bersih', value: netCash, note: 'Uang masuk dikurangi bayar vendor', icon: WalletCards, tone: netCash >= 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700' },
          ].map((item) => (
            <Card key={item.label} className={`border ${item.tone} ${item.label === 'Uang masuk dari penjualan' ? 'col-span-2 md:col-span-1' : ''}`}>
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
          <p className="text-sm text-muted-foreground">Rincian nilai dan jumlah transaksi berdasarkan metode pembayaran.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {([
            { key: 'cash', label: 'Tunai', tone: 'border-emerald-200 bg-emerald-50' },
            { key: 'credit', label: 'Kredit', tone: 'border-amber-200 bg-amber-50' },
            { key: 'transfer', label: 'Transfer', tone: 'border-sky-200 bg-sky-50' },
            { key: 'qris', label: 'QR', tone: 'border-violet-200 bg-violet-50' },
          ] as const).map((method) => (
            <Card key={method.key} className={`border ${method.tone}`}>
              <CardContent className="p-3 sm:p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground sm:text-sm">{method.label}</p>
                <p className="mt-2 break-words text-base font-bold tabular-nums text-ink sm:text-xl">
                  {formatCurrency(paymentMethods[method.key].amount)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatNumber(paymentMethods[method.key].transaction_count)} transaksi
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { label: 'Modal barang (HPP)', value: totalCost, note: 'Modal yang melekat pada barang terjual', icon: TrendingDown },
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

      {/* Transaction list */}
    </div>
  )
}
