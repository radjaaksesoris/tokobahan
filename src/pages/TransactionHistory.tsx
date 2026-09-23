import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { formatCurrency, formatNumber } from '@/lib/utils'
import { format, startOfDay, endOfDay } from 'date-fns'
import { id as localeId } from 'date-fns/locale'
import { Calendar, ChevronLeft, ChevronRight, Eye, History, Search, X } from 'lucide-react'
import { LoadingDots } from '@/components/ui/LoadingDots'
import { toast } from 'sonner'

interface SaleRow {
  id: string
  invoice_no: string
  total_amount: number
  total_cost: number
  total_profit: number
  payment_method: string
  cashier_id: string | null
  created_at: string
}

interface SaleItemRow {
  id: string
  product_name: string
  unit: string
  quantity: number
  unit_price: number
  line_total: number
}

const PAGE_SIZE = 20

export default function TransactionHistory() {
  const [sales, setSales] = useState<SaleRow[]>([])
  const [search, setSearch] = useState('')
  const [date, setDate] = useState('')
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [selectedSale, setSelectedSale] = useState<SaleRow | null>(null)
  const [items, setItems] = useState<SaleItemRow[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const initialLoadComplete = useRef(false)
  const loadRequestId = useRef(0)

  useEffect(() => {
    const timer = window.setTimeout(loadSales, 250)
    return () => window.clearTimeout(timer)
  }, [date, page, search])

  async function loadSales() {
    const requestId = ++loadRequestId.current
    if (!initialLoadComplete.current) setLoading(true)
    let query = supabase
      .from('sales')
      .select('id, invoice_no, total_amount, total_cost, total_profit, payment_method, cashier_id, created_at')
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

    const term = search.trim().replace(/[%_,]/g, ' ')
    if (term) {
      query = query.or(`invoice_no.ilike.%${term}%,payment_method.ilike.%${term}%`)
    }

    if (date) {
      const selectedDate = new Date(`${date}T00:00:00`)
      query = query
        .gte('created_at', startOfDay(selectedDate).toISOString())
        .lte('created_at', endOfDay(selectedDate).toISOString())
    }

    const { data, error } = await query
    if (requestId !== loadRequestId.current) return
    if (error) {
      toast.error(error.message)
      setSales([])
      setHasNextPage(false)
    } else {
      const rows = (data || []) as SaleRow[]
      setHasNextPage(rows.length > PAGE_SIZE)
      setSales(rows.slice(0, PAGE_SIZE))
    }
    initialLoadComplete.current = true
    setLoading(false)
  }

  async function openDetails(sale: SaleRow) {
    setSelectedSale(sale)
    setItemsLoading(true)
    const { data, error } = await supabase
      .from('sale_items')
      .select('id, product_name, unit, quantity, unit_price, line_total')
      .eq('sale_id', sale.id)
      .order('id')

    if (error) {
      toast.error(error.message)
      setItems([])
    } else {
      setItems((data || []) as SaleItemRow[])
    }
    setItemsLoading(false)
  }

  const filteredSales = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return sales
    return sales.filter(
      (sale) =>
        sale.invoice_no.toLowerCase().includes(query) ||
        sale.payment_method.toLowerCase().includes(query)
    )
  }, [sales, search])

  return (
    <div className="mx-auto max-w-[1200px] space-y-6">
      <div className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-primary">Catatan penjualan</p>
          <h2 className="text-3xl font-bold tracking-tight text-ink">Riwayat Transaksi</h2>
          <p className="mt-1 text-sm text-muted-foreground">Lihat transaksi yang sudah tersimpan dan rincian barangnya.</p>
        </div>
        <div className="flex w-full items-center gap-2 sm:gap-3 lg:w-auto">
          <div className="relative min-w-0 flex-1 lg:w-80">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9 pr-10"
              placeholder="Cari nomor invoice atau metode pembayaran..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <button
                type="button"
                aria-label="Reset pencarian"
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="relative h-10 w-[38%] min-w-[7.5rem] shrink-0 rounded-xl border border-border bg-surface sm:w-48">
            <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <span className="pointer-events-none flex h-full items-center pl-9 pr-3 text-sm text-muted-foreground">
              {date ? format(new Date(`${date}T00:00:00`), 'dd MMM yyyy', { locale: localeId }) : 'Tanggal'}
            </span>
            <Input
              className="absolute inset-0 h-full w-full cursor-pointer border-0 bg-transparent p-0 opacity-0"
              type="date"
              value={date}
              onChange={(event) => {
                setDate(event.target.value)
                setPage(0)
              }}
              aria-label="Filter tanggal transaksi"
            />
          </div>
          {date && (
            <button
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              onClick={() => {
                setDate('')
                setPage(0)
              }}
              title="Hapus filter tanggal"
              aria-label="Hapus filter tanggal"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" />
            Daftar Transaksi
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-12">
              <LoadingDots className="text-primary" dotClassName="h-1.5 w-1.5" />
            </div>
          ) : filteredSales.length === 0 ? (
            <p className="py-12 text-center text-muted-foreground">Belum ada transaksi yang cocok.</p>
          ) : (
            <div className="overflow-x-hidden">
              <table className="w-full table-fixed text-sm">
                <thead className="border-b border-primary/80 bg-primary text-center text-xs uppercase tracking-wide text-white">
                  <tr>
                    <th className="w-9 px-1 py-2.5 font-semibold lg:w-12 lg:px-4">No.</th>
                    <th className="px-1 py-2.5 font-semibold lg:px-4">Invoice</th>
                    <th className="px-1 py-2.5 font-semibold lg:px-4">
                      <span className="lg:hidden">Tanggal</span>
                      <span className="hidden lg:inline">Tanggal & waktu</span>
                    </th>
                    <th className="hidden px-4 py-2.5 font-semibold lg:table-cell">Pembayaran</th>
                    <th className="px-1 py-2.5 font-semibold lg:px-4">Total</th>
                    <th className="px-1 py-2.5 font-semibold lg:px-4">Laba</th>
                    <th className="w-9 px-1 py-2.5 lg:w-12 lg:px-3"><span className="sr-only">Aksi</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSales.map((sale, index) => (
                    <tr
                      key={sale.id}
                      className={`border-b border-stone-100 transition-colors hover:bg-teal-50/60 ${
                        index % 2 === 0 ? 'bg-surface' : 'bg-muted/50'
                      }`}
                    >
                      <td className="px-1 py-2.5 text-center text-xs text-muted-foreground lg:px-4">{page * PAGE_SIZE + index + 1}</td>
                      <td className="truncate px-1 py-2.5 text-center text-xs font-medium text-ink lg:px-4 lg:text-sm">{sale.invoice_no}</td>
                      <td className="whitespace-nowrap px-1 py-2.5 text-center text-[11px] text-muted-foreground lg:px-4 lg:text-xs">
                        <span className="lg:hidden">{format(new Date(sale.created_at), 'dd MMM yy', { locale: localeId })}</span>
                        <span className="hidden lg:inline">{format(new Date(sale.created_at), 'dd MMM yyyy HH:mm', { locale: localeId })}</span>
                      </td>
                      <td className="hidden whitespace-nowrap px-4 py-2.5 text-center text-xs capitalize lg:table-cell">
                        <span className={`inline-flex rounded-full px-2.5 py-1 font-semibold ${
                          sale.payment_method.toLowerCase() === 'credit'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}>
                          {sale.payment_method}
                        </span>
                      </td>
                      <td className="truncate px-1 py-2.5 text-center text-xs font-semibold text-ink lg:px-4 lg:text-sm">
                        {formatCurrency(Number(sale.total_amount))}
                      </td>
                      <td className="truncate px-1 py-2.5 text-center text-[11px] font-medium text-emerald-600 lg:px-4 lg:text-xs">
                        {formatCurrency(Number(sale.total_profit))}
                      </td>
                      <td className="px-1 py-2 text-center lg:px-3">
                        <button
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-teal-100 hover:text-primary"
                          onClick={() => openDetails(sale)}
                          title={`Lihat ${sale.invoice_no}`}
                          aria-label={`Lihat detail ${sale.invoice_no}`}
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loading && (page > 0 || hasNextPage) && (
            <div className="flex items-center justify-between border-t border-stone-100 p-4">
              <button
                className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40"
                disabled={page === 0}
                onClick={() => setPage((current) => current - 1)}
              >
                <ChevronLeft className="h-4 w-4" /> Sebelumnya
              </button>
              <span className="text-xs text-muted-foreground">Halaman {formatNumber(page + 1)}</span>
              <button
                className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40"
                disabled={!hasNextPage}
                onClick={() => setPage((current) => current + 1)}
              >
                Berikutnya <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSelectedSale(null)}>
          <Card className="max-h-[85vh] w-full max-w-lg overflow-auto" onClick={(event) => event.stopPropagation()}>
            <CardHeader className="flex-row items-start justify-between border-b border-stone-100">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Detail transaksi</p>
                <CardTitle className="mt-1">{selectedSale.invoice_no}</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  {format(new Date(selectedSale.created_at), 'dd MMMM yyyy HH:mm', { locale: localeId })}
                </p>
              </div>
              <button onClick={() => setSelectedSale(null)} aria-label="Tutup detail">
                <X className="h-5 w-5 text-muted-foreground" />
              </button>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              {itemsLoading ? (
                <div className="flex justify-center py-6"><LoadingDots className="text-primary" dotClassName="h-1.5 w-1.5" /></div>
              ) : (
                <div className="divide-y divide-stone-100">
                  {items.map((item) => (
                    <div key={item.id} className="flex justify-between gap-3 py-3 text-sm">
                      <div>
                        <p className="font-medium">{item.product_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.quantity} {item.unit} × {formatCurrency(Number(item.unit_price))}
                        </p>
                      </div>
                      <p className="font-semibold">{formatCurrency(Number(item.line_total))}</p>
                    </div>
                  ))}
                </div>
              )}
              <div className="border-t border-stone-200 pt-3 text-sm">
                <div className="flex justify-between"><span>Total</span><strong>{formatCurrency(Number(selectedSale.total_amount))}</strong></div>
                <div className="mt-1 flex justify-between text-emerald-600"><span>Laba</span><strong>{formatCurrency(Number(selectedSale.total_profit))}</strong></div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
