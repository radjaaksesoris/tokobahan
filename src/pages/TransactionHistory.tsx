import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { formatCurrency, formatNumber, toTitleCase } from '@/lib/utils'
import { format, startOfDay, endOfDay } from 'date-fns'
import { id as localeId } from 'date-fns/locale'
import { Calendar, ChevronLeft, ChevronRight, CreditCard, Eye, Printer, Search, X } from 'lucide-react'
import { LoadingDots } from '@/components/ui/LoadingDots'
import { readOperationalSnapshot, updateOperationalSnapshot } from '@/lib/offlineOperationalSnapshot'
import { readOperationalTable } from '@/lib/offlineOperationalRepository'
import { toast } from 'sonner'
import { useAuthStore } from '@/store/useAuthStore'
import { getPaymentMethodLabel } from '@/lib/paymentMethods'
import { ReceiptPaymentMethod } from '@/components/ReceiptPaymentMethod'

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
  paymentMethod: string
  customerName: string | null
  total: number
  amountPaid: number
  items: Array<{ name: string; unit: string; quantity: number; unitPrice: number; lineTotal: number }>
}

const PAGE_SIZE = 20
type PageCursor = { created_at: string; id: string } | null

function TransactionTableSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-surface" role="status" aria-label="Memuat riwayat transaksi">
      <span className="sr-only">Memuat riwayat transaksi...</span>
      <div className="h-9 bg-primary/80" />
      <div className="divide-y divide-stone-100">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="grid grid-cols-[2.25rem_1.1fr_1fr_1fr_1fr_2.25rem] items-center gap-2 px-2 py-3 lg:grid-cols-[3rem_1.2fr_1.4fr_1fr_1fr_3rem] lg:px-4">
            {Array.from({ length: 6 }, (_, cell) => (
              <div
                key={cell}
                className={`h-3 animate-[pulse_3.5s_ease-in-out_infinite] rounded-full bg-muted/80 ${cell === 0 || cell === 5 ? 'mx-auto w-5' : 'w-full'}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex justify-between border-t border-stone-100 p-4">
        <div className="h-8 w-24 animate-pulse rounded-lg bg-muted" />
        <div className="h-4 w-20 animate-pulse rounded-full bg-muted" />
        <div className="h-8 w-24 animate-pulse rounded-lg bg-muted" />
      </div>
    </div>
  )
}

export default function TransactionHistory() {
  const profile = useAuthStore((state) => state.profile)
  const [sales, setSales] = useState<SaleRow[]>([])
  const [search, setSearch] = useState('')
  const [date, setDate] = useState('')
  const [page, setPage] = useState(0)
  const [cursorHistory, setCursorHistory] = useState<PageCursor[]>([null])
  const [loading, setLoading] = useState(true)
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
  const loadRequestId = useRef(0)

  useEffect(() => {
    const timer = window.setTimeout(loadSales, 250)
    return () => window.clearTimeout(timer)
  }, [date, page, search])

  async function loadSales() {
    const requestId = ++loadRequestId.current
    const term = search.trim().toLocaleLowerCase()
    const cursor = cursorHistory[page]
    setLoading(true)
    try {
      const snapshot = await readOperationalSnapshot()
      if (!snapshot) throw new Error('Data lokal belum disiapkan. Buka Pengaturan untuk mengambil data awal.')
      const localSales = await readOperationalTable<SaleRow>('sales')
      if (requestId !== loadRequestId.current) return
      const filtered = localSales
        .filter((sale) => !date || sale.created_at >= startOfDay(new Date(`${date}T00:00:00`)).toISOString() &&
          sale.created_at <= endOfDay(new Date(`${date}T00:00:00`)).toISOString())
        .filter((sale) => !term ||
          sale.invoice_no.toLocaleLowerCase().includes(term) ||
          sale.payment_method.toLocaleLowerCase().includes(term))
        .sort((a, b) =>
          b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
        )
      const afterCursor = cursor
        ? filtered.filter((sale) =>
          sale.created_at < cursor.created_at ||
          sale.created_at === cursor.created_at && sale.id < cursor.id,
        )
        : filtered
      const visibleRows = afterCursor.slice(0, PAGE_SIZE)
      setSales(visibleRows)
      setHasNextPage(afterCursor.length > PAGE_SIZE)
      setCachedAt(Date.now())
      setLoading(false)
      return
    } catch (error) {
      if (requestId !== loadRequestId.current) return
      toast.error(`Gagal membaca riwayat lokal: ${error instanceof Error ? error.message : 'Kesalahan tidak diketahui'}`)
      setSales([])
      setHasNextPage(false)
      setLoading(false)
      return
    }
  }

  async function openDetails(sale: SaleRow) {
    setSelectedSale(sale)
    setItemsLoading(true)
    try {
      const snapshot = await readOperationalSnapshot()
      if (!snapshot) throw new Error('Data lokal belum disiapkan. Buka Pengaturan untuk mengambil data awal.')
      const [saleItems, saleReturns] = await Promise.all([
        readOperationalTable<SaleItemWithReturns & { sale_id: string }>('sale_items'),
        readOperationalTable<{
          sale_item_id: string
          quantity: number
          refund_amount: number
        }>('sale_returns'),
      ])
      const rows = saleItems.filter((item) => item.sale_id === sale.id)
      setItems(rows.map((item) => {
        const returns = saleReturns.filter((returned) => returned.sale_item_id === item.id)
        return {
          id: item.id,
          product_name: item.product_name,
          unit: item.unit,
          quantity: Number(item.quantity),
          returned_quantity: returns.reduce((sum, returned) => sum + Number(returned.quantity), 0),
          returned_amount: returns.reduce((sum, returned) => sum + Number(returned.refund_amount), 0),
          unit_price: Number(item.unit_price),
          line_total: Number(item.line_total),
        }
      }))
      setItemsLoading(false)
      return
    } catch (error) {
      toast.error(`Gagal membaca rincian transaksi lokal: ${error instanceof Error ? error.message : 'Kesalahan tidak diketahui'}`)
      setItems([])
      setItemsLoading(false)
      return
    }
  }

  async function submitReturn() {
    if (!returningItem) return
    let localSnapshot
    try {
      localSnapshot = await readOperationalSnapshot()
    } catch (error) {
      toast.error(`Gagal memeriksa penyimpanan lokal: ${error instanceof Error ? error.message : 'Kesalahan tidak diketahui'}`)
      return
    }
    if (!localSnapshot) {
      toast.error('Data lokal belum disiapkan. Buka Pengaturan untuk mengambil data awal.')
      return
    }
    const quantity = Number(returnQuantity)
    if (!Number.isFinite(quantity) || quantity <= 0 || !returnReason.trim()) {
      toast.error('Jumlah dan alasan retur wajib diisi')
      return
    }
    setReturnSaving(true)
    {
      try {
        await updateOperationalSnapshot((snapshot) => {
          const item = snapshot.tables.sale_items.find((row) => row.id === returningItem.id)
          if (!item) throw new Error('Barang transaksi tidak ditemukan di penyimpanan lokal')
          const sale = snapshot.tables.sales.find((row) => row.id === item.sale_id)
          const product = snapshot.tables.products.find((row) => row.id === item.product_id)
          if (!sale || !product) throw new Error('Transaksi atau produk tidak ditemukan di penyimpanan lokal')
          const priorReturns = snapshot.tables.sale_returns.filter((row) => row.sale_item_id === item.id)
          const alreadyReturned = priorReturns.reduce((sum, row) => sum + Number(row.quantity), 0)
          const itemQuantity = Number(item.quantity)
          if (alreadyReturned + quantity > itemQuantity) {
            throw new Error('Jumlah retur melebihi jumlah terjual')
          }

          const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
          const refund = roundMoney((quantity / itemQuantity) * Number(item.line_total))
          const priorPayments = snapshot.tables.customer_debt_payments
            .filter((payment) => payment.sale_id === sale.id)
            .reduce((sum, payment) => sum + Number(payment.amount), 0)
          const outstanding = Math.max(
            Number(sale.total_amount) - Number(sale.amount_paid) - priorPayments,
            0,
          )
          const cashRefund = sale.payment_method === 'credit'
            ? Math.max(refund - outstanding, 0)
            : refund
          const now = new Date().toISOString()
          const returnId = crypto.randomUUID()
          const restoredUnitCost = Number(item.line_cost) / itemQuantity

          return {
            snapshot: {
              ...snapshot,
              tables: {
                ...snapshot.tables,
                sale_returns: [...snapshot.tables.sale_returns, {
                  id: returnId,
                  sale_id: sale.id,
                  sale_item_id: item.id,
                  quantity,
                  refund_amount: refund,
                  cash_refund_amount: cashRefund,
                  reason: returnReason.trim(),
                  returned_by: profile?.id || null,
                  created_at: now,
                }],
                product_stock_batches: [...snapshot.tables.product_stock_batches, {
                  id: crypto.randomUUID(),
                  product_id: product.id,
                  quantity_received: quantity,
                  quantity_remaining: quantity,
                  unit_cost: restoredUnitCost,
                  vendor_id: null,
                  payment_status: 'lunas',
                  due_date: null,
                  received_at: now,
                  created_at: now,
                }],
                products: snapshot.tables.products.map((row) => row.id === product.id
                  ? { ...row, stock: Number(row.stock) + quantity, updated_at: now }
                  : row),
                sales: snapshot.tables.sales.map((row) => row.id === sale.id
                  ? {
                      ...row,
                      total_amount: Number(row.total_amount) - refund,
                      total_cost: Number(row.total_cost) - roundMoney((quantity / itemQuantity) * Number(item.line_cost)),
                      total_profit: Number(row.total_profit) - roundMoney((quantity / itemQuantity) * Number(item.line_profit)),
                    }
                  : row),
              },
            },
            result: undefined,
          }
        })
        toast.success('Retur berhasil diproses')
        setReturningItem(null)
        setSelectedSale(null)
        await loadSales()
      } catch (error) {
        toast.error(`Retur lokal gagal diproses: ${error instanceof Error ? error.message : 'Kesalahan tidak diketahui'}`)
      }
      setReturnSaving(false)
      return
    }
  }

  async function reprintSale() {
    if (!selectedSale || itemsLoading || items.length === 0) return
    let customerName: string | null = null
    if (selectedSale.customer_id) {
      try {
        const customers = await readOperationalTable<{ id: string; name: string }>('customers')
        customerName = customers.find((customer) => customer.id === selectedSale.customer_id)?.name || null
      } catch (error) {
        toast.error(`Gagal membaca pelanggan transaksi: ${error instanceof Error ? error.message : 'Kesalahan tidak diketahui'}`)
        return
      }
    }

    const receipt = {
      invoiceNo: selectedSale.invoice_no,
      createdAt: selectedSale.created_at,
      paymentMethod: selectedSale.payment_method,
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
    try {
      if (!await readOperationalSnapshot()) {
        throw new Error('Data lokal belum disiapkan. Buka Pengaturan untuk mengambil data awal.')
      }
      {
        let localCustomerId: string | null = null
        await updateOperationalSnapshot((snapshot) => {
          const sale = snapshot.tables.sales.find((row) => row.id === selectedSale.id)
          if (!sale) throw new Error('Transaksi tidak ditemukan di penyimpanan lokal')
          let customerId: string | null = null
          let customers = snapshot.tables.customers

          if (method === 'credit') {
            const normalizedName = customerName.toLocaleLowerCase()
            let customer = customers.find((row) =>
              String(row.normalized_name || String(row.name).trim().toLocaleLowerCase()) === normalizedName,
            )
            if (!customer) {
              customer = {
                id: crypto.randomUUID(),
                name: customerName,
                normalized_name: normalizedName,
                created_at: new Date().toISOString(),
              }
              customers = [...customers, customer]
            } else {
              customers = customers.map((row) => row.id === customer?.id
                ? { ...row, name: customerName }
                : row)
            }
            customerId = String(customer.id)
            localCustomerId = customerId
          } else if (snapshot.tables.customer_debt_payments.some((payment) => payment.sale_id === sale.id)) {
            throw new Error('Transaksi kredit yang sudah memiliki cicilan tidak dapat diubah menjadi tunai')
          }

          return {
            snapshot: {
              ...snapshot,
              tables: {
                ...snapshot.tables,
                customers,
                sales: snapshot.tables.sales.map((row) => row.id === sale.id
                  ? {
                      ...row,
                      payment_method: method,
                      customer_id: method === 'credit' ? customerId : null,
                      amount_paid: method === 'credit' ? 0 : Number(row.total_amount),
                    }
                  : row),
              },
            },
            result: undefined,
          }
        })
        const updatedSale = {
          ...selectedSale,
          payment_method: method,
          customer_id: method === 'credit' ? localCustomerId : null,
          amount_paid: method === 'credit' ? 0 : Number(selectedSale.total_amount),
        }
        setSelectedSale(updatedSale)
        setSales((current) => current.map((sale) => sale.id === updatedSale.id ? updatedSale : sale))
        setCreditCustomerName('')
        toast.success(`Metode pembayaran diubah menjadi ${method === 'credit' ? 'kredit' : 'tunai'}`)
        setPaymentMethodSaving(false)
        return
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal mengubah metode pembayaran lokal')
      setPaymentMethodSaving(false)
      return
    }
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
    <div className="mx-auto max-w-[1440px] space-y-6">
      <div className="page-header sticky top-[-1rem] z-30 -mx-4 -mt-4 flex flex-col gap-4 bg-ink px-4 py-4 text-white shadow-[0_3px_0_rgba(32,42,46,0.2)] sm:top-[-1.25rem] sm:-mx-5 sm:-mt-5 sm:px-5 lg:top-[-2rem] lg:-mx-8 lg:-mt-8 lg:flex-row lg:items-end lg:justify-between lg:px-8 lg:py-5">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white">Riwayat Transaksi</h2>
          <p className="mt-1 text-sm text-accent">
            {cachedAt
              ? `Data lokal · Diperbarui ${format(new Date(cachedAt), 'dd MMM yyyy HH:mm', { locale: localeId })}`
              : 'Data lokal · Memuat...'}
          </p>
        </div>
        <div className="flex w-full items-center gap-2 sm:gap-3 lg:w-auto">
          <div className="relative min-w-0 flex-1 lg:w-80">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Cari invoice atau metode pembayaran"
              className="pl-9 pr-10"
              placeholder="Cari"
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
                className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-ink"
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

      <div className="overflow-hidden rounded-xl border border-stone-200 bg-surface shadow-sm">
          {loading ? (
            <TransactionTableSkeleton />
          ) : filteredSales.length === 0 ? (
            <p className="py-12 text-center text-muted-foreground">Belum ada transaksi yang cocok.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full table-fixed text-xs lg:min-w-[720px] lg:table-auto lg:text-sm">
                <thead className="border-b border-primary/80 bg-primary text-center text-[11px] uppercase tracking-wide text-white">
                  <tr>
                    <th className="w-9 px-0.5 py-2 font-semibold lg:w-12 lg:px-3">No.</th>
                    <th className="px-0.5 py-2 font-semibold lg:px-3">Invoice</th>
                    <th className="px-0.5 py-2 font-semibold lg:px-3">
                      <span className="lg:hidden">Tanggal</span>
                      <span className="hidden lg:inline">Tanggal & waktu</span>
                    </th>
                    <th className="hidden px-3 py-2 font-semibold lg:table-cell">Pembayaran</th>
                    <th className="px-0.5 py-2 font-semibold lg:px-3">Total</th>
                    <th className="px-0.5 py-2 font-semibold lg:px-3">Laba</th>
                    <th className="w-9 px-0.5 py-2 lg:w-12 lg:px-3"><span className="sr-only">Aksi</span></th>
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
                          {getPaymentMethodLabel(sale.payment_method)}
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
      </div>

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
              <button type="button" onClick={() => setSelectedSale(null)} aria-label="Tutup detail" className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">
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
      {reprint && createPortal(
        <div id="receipt-print-root" aria-hidden="true">
          <HistoryReceiptDocument receipt={reprint} />
        </div>,
        document.body
      )}
    </div>
  )
}

function HistoryReceiptDocument({ receipt }: { receipt: ReprintData }) {
  return (
    <article className="receipt-document">
      <header className="receipt-header">
        <div className="receipt-brand">
          <img src={`${import.meta.env.BASE_URL}logo-radja.png`} alt="Logo RAJA Aksesoris" />
          <div className="receipt-brand-copy">
            <strong>RAJA AKSESORIS</strong>
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
      {receipt.customerName && <div className="receipt-customer">Pelanggan: {receipt.customerName}</div>}
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
      <div className="receipt-total receipt-total-highlight">
        <span>TOTAL</span>
        <strong>{formatCurrency(receipt.total)}</strong>
      </div>
      <ReceiptPaymentMethod method={receipt.paymentMethod} />
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
