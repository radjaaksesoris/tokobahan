import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { formatCurrency, formatNumber } from '@/lib/utils'
import { format, startOfDay, endOfDay } from 'date-fns'
import { id as localeId } from 'date-fns/locale'
import { Calendar, ChevronLeft, ChevronRight, Eye, History, Loader2, Search, X } from 'lucide-react'
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

  useEffect(() => {
    loadSales()
  }, [date, page])

  async function loadSales() {
    setLoading(true)
    let query = supabase
      .from('sales')
      .select('id, invoice_no, total_amount, total_cost, total_profit, payment_method, cashier_id, created_at')
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

    if (date) {
      const selectedDate = new Date(`${date}T00:00:00`)
      query = query
        .gte('created_at', startOfDay(selectedDate).toISOString())
        .lte('created_at', endOfDay(selectedDate).toISOString())
    }

    const { data, error } = await query
    if (error) {
      toast.error(error.message)
      setSales([])
      setHasNextPage(false)
    } else {
      const rows = (data || []) as SaleRow[]
      setHasNextPage(rows.length > PAGE_SIZE)
      setSales(rows.slice(0, PAGE_SIZE))
    }
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
      <div className="border-b border-stone-300/80 pb-5">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-primary">Catatan penjualan</p>
        <h2 className="text-3xl font-bold tracking-tight text-ink">Riwayat Transaksi</h2>
        <p className="mt-1 text-sm text-slate-500">Lihat transaksi yang sudah tersimpan dan rincian barangnya.</p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9"
              placeholder="Cari nomor invoice atau metode pembayaran..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="relative sm:w-48">
            <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9"
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
              className="rounded-xl border border-stone-300 px-3 text-sm text-slate-600 hover:bg-stone-100"
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
        </CardContent>
      </Card>

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
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : filteredSales.length === 0 ? (
            <p className="py-12 text-center text-slate-400">Belum ada transaksi yang cocok.</p>
          ) : (
            <div className="divide-y divide-stone-100">
              {filteredSales.map((sale) => (
                <div key={sale.id} className="flex items-center gap-3 px-4 py-4 hover:bg-stone-50">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900">{sale.invoice_no}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {format(new Date(sale.created_at), 'dd MMM yyyy HH:mm', { locale: localeId })} ·{' '}
                      <span className="capitalize">{sale.payment_method}</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-slate-900">{formatCurrency(Number(sale.total_amount))}</p>
                    <p className="text-xs text-emerald-600">Laba {formatCurrency(Number(sale.total_profit))}</p>
                  </div>
                  <button
                    className="rounded-lg p-2 text-slate-400 hover:bg-teal-50 hover:text-primary"
                    onClick={() => openDetails(sale)}
                    title={`Lihat ${sale.invoice_no}`}
                    aria-label={`Lihat detail ${sale.invoice_no}`}
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                </div>
              ))}
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
              <span className="text-xs text-slate-500">Halaman {formatNumber(page + 1)}</span>
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
                <p className="text-xs uppercase tracking-wider text-slate-400">Detail transaksi</p>
                <CardTitle className="mt-1">{selectedSale.invoice_no}</CardTitle>
                <p className="mt-1 text-xs text-slate-400">
                  {format(new Date(selectedSale.created_at), 'dd MMMM yyyy HH:mm', { locale: localeId })}
                </p>
              </div>
              <button onClick={() => setSelectedSale(null)} aria-label="Tutup detail">
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              {itemsLoading ? (
                <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
              ) : (
                <div className="divide-y divide-stone-100">
                  {items.map((item) => (
                    <div key={item.id} className="flex justify-between gap-3 py-3 text-sm">
                      <div>
                        <p className="font-medium">{item.product_name}</p>
                        <p className="text-xs text-slate-400">
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
