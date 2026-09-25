import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { formatCurrency, formatNumber, toTitleCase } from '@/lib/utils'
import { format, startOfDay, endOfDay } from 'date-fns'
import { id as localeId } from 'date-fns/locale'
import { Calendar, ChevronLeft, ChevronRight, CreditCard, Eye, History, Printer, Search, X } from 'lucide-react'
import { LoadingDots } from '@/components/ui/LoadingDots'
import { readOfflineCacheEntry, writeOfflineCache } from '@/lib/offlineCache'
import { toast } from 'sonner'

interface SaleRow {
  id: string
  invoice_no: string
  total_amount: number
  total_cost: number
  total_profit: number
  payment_method: string
  cashier_id: string | null
  customer_id: string | null
  amount_paid: number
  created_at: string
}

interface SaleItemRow {
  id: string
  product_name: string
  unit: string
  quantity: number
  returned_quantity: number
  returned_amount: number
  unit_price: number
  line_total: number
}

interface SaleItemWithReturns extends Omit<SaleItemRow, 'returned_quantity'> {
  sale_returns: Array<{ quantity: number; refund_amount: number }> | null
}

interface ReprintData {
  invoiceNo: string
  createdAt: string
  paymentMethod: 'cash' | 'qris' | 'credit'
  customerName: string | null
  total: number
  amountPaid: number
  items: Array<{ name: string; unit: string; quantity: number; unitPrice: number; lineTotal: number }>
}

const PAGE_SIZE = 20
type PageCursor = { created_at: string; id: string } | null

export default function TransactionHistory() {
  const [sales, setSales] = useState<SaleRow[]>([])
  const [search, setSearch] = useState('')
  const [date, setDate] = useState('')
  const [page, setPage] = useState(0)
  const [cursorHistory, setCursorHistory] = useState<PageCursor[]>([null])
  const [loading, setLoading] = useState(true)
  const [dateTotal, setDateTotal] = useState(0)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [selectedSale, setSelectedSale] = useState<SaleRow | null>(null)
  const [items, setItems] = useState<SaleItemRow[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [returningItem, setReturningItem] = useState<SaleItemRow | null>(null)
  const [returnQuantity, setReturnQuantity] = useState('')
  const [returnReason, setReturnReason] = useState('')
  const [returnSaving, setReturnSaving] = useState(false)
  const [cachedAt, setCachedAt] = useState<number | null>(null)
  const [reprint, setReprint] = useState<ReprintData | null>(null)
  const [paymentMethodSaving, setPaymentMethodSaving] = useState(false)
  const [creditCustomerName, setCreditCustomerName] = useState('')
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
      .select('id, invoice_no, total_amount, total_cost, total_profit, payment_method, cashier_id, customer_id, amount_paid, created_at')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(PAGE_SIZE + 1)

    const cursor = cursorHistory[page]
    if (cursor) {
      query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`)
    }

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

    const totalStart = date ? startOfDay(new Date(`${date}T00:00:00`)) : new Date(0)
    const totalEnd = date ? endOfDay(new Date(`${date}T00:00:00`)) : new Date('9999-12-31T23:59:59.999Z')
    const [{ data, error }, { data: totalData, error: totalError }] = await Promise.all([
      query,
      supabase.rpc('sales_total_amount', {
        p_start: totalStart.toISOString(),
        p_end: totalEnd.toISOString(),
        p_search: term || null,
      }),
    ])
    if (requestId !== loadRequestId.current) return
    const cacheKey = `transaction-history:${date || 'all'}:${page}:${search.trim().toLowerCase()}`
    if (error || totalError) {
      const cached = readOfflineCacheEntry<{ rows: SaleRow[]; total: number; hasNextPage: boolean }>(cacheKey)
      if (cached) { setSales(cached.value.rows); setDateTotal(cached.value.total); setHasNextPage(cached.value.hasNextPage); setCachedAt(cached.cachedAt) }
      else { toast.error(navigator.onLine ? (error?.message || totalError?.message || 'Gagal memuat riwayat') : 'Riwayat belum tersedia secara offline'); setSales([]); setHasNextPage(false); setDateTotal(0) }
    } else {
      const rows = (data || []) as SaleRow[]
      const total = Number(totalData?.[0]?.total_amount || 0)
      const visibleRows = rows.slice(0, PAGE_SIZE)
      setHasNextPage(rows.length > PAGE_SIZE); setSales(visibleRows); setDateTotal(total); setCachedAt(Date.now())
      writeOfflineCache(cacheKey, { rows: visibleRows, total, hasNextPage: rows.length > PAGE_SIZE })
    }
    initialLoadComplete.current = true
    setLoading(false)
  }

  async function openDetails(sale: SaleRow) {
    setSelectedSale(sale)
    setItemsLoading(true)
    const { data, error } = await supabase
      .from('sale_items')
      .select('id, product_name, unit, quantity, unit_price, line_total, sale_returns(quantity, refund_amount)')
      .eq('sale_id', sale.id)
      .order('id')

    if (error) {
      toast.error(error.message)
      setItems([])
    } else {
      setItems((data || []).map((row) => {
        const item = row as unknown as SaleItemWithReturns
        return {
          id: item.id,
          product_name: item.product_name,
          unit: item.unit,
          quantity: Number(item.quantity),
          returned_quantity: (item.sale_returns || []).reduce((sum, returned) => sum + Number(returned.quantity), 0),
          returned_amount: (item.sale_returns || []).reduce((sum, returned) => sum + Number(returned.refund_amount), 0),
          unit_price: Number(item.unit_price),
          line_total: Number(item.line_total),
        }
      }))
    }
    setItemsLoading(false)
  }

  async function submitReturn() {
    if (!returningItem) return
    if (!navigator.onLine) {
      toast.error('Retur membutuhkan koneksi internet dan tidak dapat diproses offline')
      return
    }
    const quantity = Number(returnQuantity)
    if (!Number.isFinite(quantity) || quantity <= 0 || !returnReason.trim()) {
      toast.error('Jumlah dan alasan retur wajib diisi')
      return
    }
    setReturnSaving(true)
    const { error } = await supabase.rpc('return_sale_item', { p_sale_item_id: returningItem.id, p_quantity: quantity, p_reason: returnReason.trim() })
    if (error) toast.error(error.message)
    else {
      toast.success('Retur berhasil diproses')
      setReturningItem(null)
      setSelectedSale(null)
      void loadSales()
    }
    setReturnSaving(false)
  }

  async function reprintSale() {
    if (!selectedSale || itemsLoading || items.length === 0) return
    let customerName: string | null = null
    if (selectedSale.customer_id) {
      const { data } = await supabase.from('customers').select('name').eq('id', selectedSale.customer_id).maybeSingle()
      customerName = data?.name || null
    }

    const receipt = {
      invoiceNo: selectedSale.invoice_no,
      createdAt: selectedSale.created_at,
      paymentMethod: selectedSale.payment_method.toLowerCase() as ReprintData['paymentMethod'],
      customerName,
      total: Number(selectedSale.total_amount),
      amountPaid: Number(selectedSale.amount_paid) || 0,
      items: items.map((item) => ({
        name: item.product_name,
        unit: item.unit,
        quantity: Math.max(0, Number(item.quantity) - item.returned_quantity),
        unitPrice: Number(item.unit_price),
        lineTotal: Math.max(0, Number(item.line_total) - item.returned_amount),
      })),
    }
    setReprint(receipt)
    window.setTimeout(() => window.print(), 0)
  }

  async function changePaymentMethod(method: 'cash' | 'credit') {
    if (!selectedSale || selectedSale.payment_method.toLowerCase() === method) return
    const customerName = creditCustomerName.trim()
    if (method === 'credit' && !customerName) {
      toast.error('Nama pelanggan wajib diisi untuk mengubah menjadi kredit')
      return
    }
    setPaymentMethodSaving(true)
    const { error } = await supabase.rpc('change_sale_payment_method', {
      p_sale_id: selectedSale.id,
      p_payment_method: method,
      p_customer_name: method === 'credit' ? customerName : null,
    })
    if (error) {
      toast.error(error.message)
    } else {
      let customerId = selectedSale.customer_id
      if (method === 'credit') {
        const { data: customer } = await supabase
          .from('customers')
          .select('id')
          .eq('name', customerName)
          .maybeSingle()
        customerId = customer?.id || customerId
      }
      const updatedSale = {
        ...selectedSale,
        payment_method: method,
        customer_id: method === 'credit' ? customerId : null,
        amount_paid: method === 'credit' ? 0 : Number(selectedSale.total_amount),
      }
      setSelectedSale(updatedSale)
      setSales((current) => current.map((sale) => sale.id === updatedSale.id ? updatedSale : sale))
      setCreditCustomerName('')
      toast.success(`Metode pembayaran diubah menjadi ${method === 'credit' ? 'kredit' : 'tunai'}`)
    }
    setPaymentMethodSaving(false)
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
      <div className="-mx-4 flex flex-col gap-4 border-b border-border bg-canvas px-4 pb-5 pt-3 shadow-[0_3px_0_rgba(231,228,220,0.75)] sm:-mx-5 sm:px-5 lg:-mx-8 lg:flex-row lg:items-end lg:justify-between lg:px-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-ink">Riwayat Transaksi</h2>
          {cachedAt && (
            <p className="mt-1 text-xs text-muted-foreground">
              {navigator.onLine ? 'Cache terbaru · ' : 'Offline · '}
              Diperbarui {format(new Date(cachedAt), 'dd MMM yyyy HH:mm', { locale: localeId })}
            </p>
          )}
          <p className="mt-1 text-sm text-muted-foreground">Lihat transaksi yang sudah tersimpan dan rincian barangnya.</p>
        </div>
        <div className="flex w-full items-center gap-2 sm:gap-3 lg:w-auto">
          <div className="relative min-w-0 flex-1 lg:w-80">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9 pr-10"
              placeholder="Cari invoice atau metode pembayaran..."
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setPage(0)
                setCursorHistory([null])
              }}
            />
            {search && (
              <button
                type="button"
                aria-label="Reset pencarian"
                onClick={() => {
                  setSearch('')
                  setPage(0)
                  setCursorHistory([null])
                }}
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
                setCursorHistory([null])
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
                setCursorHistory([null])
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
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" />
            Daftar Transaksi
          </CardTitle>
          {date && (
            <p className="text-right text-sm font-semibold text-primary">
              Total: {formatCurrency(dateTotal)}
            </p>
          )}
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
                <thead className="sticky top-0 z-10 border-b border-primary/80 bg-primary text-center text-xs uppercase tracking-wide text-white shadow-[0_2px_0_rgba(33,108,104,0.18)]">
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
                onClick={() => {
                  setCursorHistory((current) => current.slice(0, -1))
                  setPage((current) => current - 1)
                }}
              >
                <ChevronLeft className="h-4 w-4" /> Sebelumnya
              </button>
              <span className="text-xs text-muted-foreground">Halaman {formatNumber(page + 1)}</span>
              <button
                className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40"
                disabled={!hasNextPage}
                onClick={() => {
                  const lastSale = sales[sales.length - 1]
                  if (!lastSale) return
                  setCursorHistory((current) => [...current.slice(0, page + 1), { created_at: lastSale.created_at, id: lastSale.id }])
                  setPage((current) => current + 1)
                }}
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
                          {item.quantity - item.returned_quantity} {item.unit} tersisa
                          {' · '}
                          {formatCurrency(Number(item.unit_price))}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">{formatCurrency(Math.max(0, Number(item.line_total) - item.returned_amount))}</p>
                        {item.returned_quantity >= item.quantity ? (
                          <span className="mt-1 inline-block text-xs font-semibold text-muted-foreground">Sudah diretur</span>
                        ) : (
                          <button type="button" className="mt-1 text-xs font-semibold text-primary hover:underline" onClick={() => { setReturningItem(item); setReturnQuantity(String(item.quantity - item.returned_quantity)); setReturnReason('') }}>
                            Retur
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={itemsLoading || items.length === 0}
                onClick={reprintSale}
              >
                <Printer className="mr-2 h-4 w-4" /> Cetak ulang
              </Button>
              <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-sky-900">
                  <CreditCard className="h-4 w-4" /> Koreksi metode pembayaran
                </div>
                <p className="mt-1 text-xs text-sky-800/80">Gunakan jika transaksi salah memilih Tunai atau Kredit.</p>
                {selectedSale.payment_method.toLowerCase() === 'cash' && (
                  <Input
                    value={creditCustomerName}
                    onChange={(event) => setCreditCustomerName(toTitleCase(event.target.value))}
                    placeholder="Nama pelanggan untuk kredit"
                    className="mt-3 bg-white"
                    disabled={paymentMethodSaving}
                  />
                )}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant={selectedSale.payment_method.toLowerCase() === 'cash' ? 'primary' : 'outline'}
                    disabled={paymentMethodSaving || selectedSale.payment_method.toLowerCase() === 'cash'}
                    onClick={() => void changePaymentMethod('cash')}
                  >
                    Tunai
                  </Button>
                  <Button
                    type="button"
                    variant={selectedSale.payment_method.toLowerCase() === 'credit' ? 'primary' : 'outline'}
                    disabled={paymentMethodSaving || selectedSale.payment_method.toLowerCase() === 'credit'}
                    onClick={() => void changePaymentMethod('credit')}
                  >
                    Kredit
                  </Button>
                </div>
              </div>
              {returningItem && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setReturningItem(null)}>
                  <Card className="w-full max-w-md" onClick={(event) => event.stopPropagation()}>
                    <CardHeader className="flex-row items-start justify-between border-b border-stone-100">
                      <div><CardTitle>Retur item</CardTitle><p className="mt-1 text-xs text-muted-foreground">{returningItem.product_name}</p></div>
                      <button type="button" onClick={() => setReturningItem(null)} aria-label="Tutup"><X className="h-5 w-5 text-muted-foreground" /></button>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-4">
                      <Input type="number" min="0.001" max={returningItem.quantity} step="any" value={returnQuantity} onChange={(event) => setReturnQuantity(event.target.value)} placeholder="Jumlah retur" />
                      <Input value={returnReason} onChange={(event) => setReturnReason(toTitleCase(event.target.value))} placeholder="Alasan retur" />
                      <button type="button" className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={returnSaving} onClick={() => void submitReturn()}>
                        {returnSaving ? 'Memproses...' : 'Proses retur'}
                      </button>
                    </CardContent>
                  </Card>
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
      {reprint && (
        createPortal(
          <div id="receipt-print-root" aria-hidden="true">
            <HistoryReceiptDocument receipt={reprint} />
          </div>,
          document.body
        )
      )}
    </div>
  )
}

function HistoryReceiptDocument({ receipt }: { receipt: ReprintData }) {
  const paymentLabels = { cash: 'Tunai', qris: 'QRIS', credit: 'Hutang' }
  return (
    <article className="receipt-document">
      <header className="receipt-header">
        <div className="receipt-brand">
          <img src={`${import.meta.env.BASE_URL}logo-radja.png`} alt="Logo Radja Aksesoris" />
          <div className="receipt-brand-copy">
            <strong>RADJA AKSESORIS</strong>
            <span>Konveksi</span>
          </div>
        </div>
        <span className="receipt-title">Struk Penjualan</span>
      </header>
      <div className="receipt-rule" />
      <div className="receipt-meta">
        <span>No. {receipt.invoiceNo}</span>
        <span>{new Date(receipt.createdAt).toLocaleString('id-ID')}</span>
      </div>
      {receipt.customerName && <div>Pelanggan: {receipt.customerName}</div>}
      <div className="receipt-rule" />
      <div className="receipt-items">
        {receipt.items.map((item, index) => (
          <div key={`${item.name}-${index}`} className="receipt-item">
            <div>{item.name}</div>
            <div className="receipt-item-detail">
              <span>{item.quantity} {item.unit} × {formatCurrency(item.unitPrice)}</span>
              <strong>{formatCurrency(item.lineTotal)}</strong>
            </div>
          </div>
        ))}
      </div>
      <div className="receipt-rule" />
      <div className="receipt-total"><span>TOTAL</span><strong>{formatCurrency(receipt.total)}</strong></div>
      <div className="receipt-summary"><span>Pembayaran</span><span>{paymentLabels[receipt.paymentMethod]}</span></div>
      {receipt.paymentMethod === 'credit' && receipt.amountPaid > 0 && (
        <>
          <div className="receipt-summary"><span>Dibayar sebagian</span><span>{formatCurrency(receipt.amountPaid)}</span></div>
          <div className="receipt-summary"><span>Sisa hutang</span><span>{formatCurrency(Math.max(0, receipt.total - receipt.amountPaid))}</span></div>
        </>
      )}
      <footer className="receipt-center receipt-footer">Terima kasih</footer>
    </article>
  )
}
