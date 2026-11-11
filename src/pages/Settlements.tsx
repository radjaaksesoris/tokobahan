import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/utils'
import { UNIT_LABELS } from '@/types'
import { toast } from 'sonner'
import { invokeReceiptPrint } from '@/lib/receiptPrint'
import { WalletCards, ChevronLeft, ChevronRight, Printer, X } from 'lucide-react'
import { useAuthStore } from '@/store/useAuthStore'
import { readOperationalSnapshot, updateOperationalSnapshot } from '@/lib/offlineOperationalSnapshot'

type Tab = 'vendor' | 'customer' | 'vendor-history' | 'customer-history'
type VendorPaymentMode = 'nominal' | 'item'
type DebtPayment = { amount: number; paid_at: string }
type DebtItem = { batchId?: string; name: string; quantity: number; unit: string; unitPrice: number; subtotal: number; paid: number }
type Debt = {
  id: string
  batchIds: string[]
  name: string
  reference: string
  createdAt: string
  total: number
  paid: number
  due: string | null
  payments: DebtPayment[]
  items: DebtItem[]
}
type PendingSettlement = {
  debt: Debt
  amount: number
  selectedBatchIds: string[]
  isFullPayment: boolean
}
type CustomerDebtReceipt = {
  invoiceNo: string
  customerName: string
  createdAt: string
  total: number
  payment: number
  remainingDebt: number
  items: DebtItem[]
}
type VendorDebtRow = {
  id: string
  quantity_received: number
  unit_cost: number
  received_at: string
  due_date: string | null
  vendor_id: string | null
  vendor: { name: string } | null
  product: { name: string; stock_unit: string } | null
  vendor_debt_payments: DebtPayment[]
}
type VendorPaymentHistory = {
  id: string
  amount: number
  paid_at: string
  stock_batch: {
    received_at: string
    vendor: { name: string } | null
    product: { name: string } | null
  } | null
}
type CustomerPaymentHistory = {
  id: string
  amount: number
  paid_at: string
  sale: { invoice_no: string; customer: { name: string } | null } | null
}
const PAGE_SIZE = 50

export default function Settlements() {
  const administratorId = useAuthStore((state) => state.user?.id)
  const [tab, setTab] = useState<Tab>('customer')
  const [debts, setDebts] = useState<Debt[]>([])
  const [payment, setPayment] = useState<Record<string, string>>({})
  const [expandedDebtId, setExpandedDebtId] = useState<string | null>(null)
  const [selectedItems, setSelectedItems] = useState<Record<string, string[]>>({})
  const [vendorPaymentModes, setVendorPaymentModes] = useState<Record<string, VendorPaymentMode>>({})
  const [customerSearch, setCustomerSearch] = useState('')
  const [historySearch, setHistorySearch] = useState('')
  const [historyDate, setHistoryDate] = useState('')
  const [vendorPaymentHistory, setVendorPaymentHistory] = useState<VendorPaymentHistory[]>([])
  const [customerPaymentHistory, setCustomerPaymentHistory] = useState<CustomerPaymentHistory[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [pendingSettlement, setPendingSettlement] = useState<PendingSettlement | null>(null)
  const [settlementReceipt, setSettlementReceipt] = useState<CustomerDebtReceipt | null>(null)

  async function load() {
    setLoading(true)
    try {
      const snapshot = await readOperationalSnapshot()
      if (!snapshot) {
        throw new Error('Data lokal belum disiapkan. Buka Pengaturan untuk mengambil data awal.')
      }
      const { tables } = snapshot
      const vendorById = new Map<unknown, (typeof tables.vendors)[number]>()
      for (const vendor of tables.vendors) {
        if (!vendorById.has(vendor.id)) vendorById.set(vendor.id, vendor)
      }
      const productById = new Map<unknown, (typeof tables.products)[number]>()
      for (const product of tables.products) {
        if (!productById.has(product.id)) productById.set(product.id, product)
      }
      const customerById = new Map<unknown, (typeof tables.customers)[number]>()
      for (const customer of tables.customers) {
        if (!customerById.has(customer.id)) customerById.set(customer.id, customer)
      }
      const batchById = new Map<unknown, (typeof tables.product_stock_batches)[number]>()
      for (const batch of tables.product_stock_batches) {
        if (!batchById.has(batch.id)) batchById.set(batch.id, batch)
      }
      const saleById = new Map<unknown, (typeof tables.sales)[number]>()
      for (const sale of tables.sales) {
        if (!saleById.has(sale.id)) saleById.set(sale.id, sale)
      }
      const vendorPaymentsByBatch = new Map<unknown, (typeof tables.vendor_debt_payments)[number][]>()
      for (const payment of tables.vendor_debt_payments) {
        const payments = vendorPaymentsByBatch.get(payment.stock_batch_id) || []
        payments.push(payment)
        vendorPaymentsByBatch.set(payment.stock_batch_id, payments)
      }
      const customerPaymentsBySale = new Map<unknown, (typeof tables.customer_debt_payments)[number][]>()
      for (const payment of tables.customer_debt_payments) {
        const payments = customerPaymentsBySale.get(payment.sale_id) || []
        payments.push(payment)
        customerPaymentsBySale.set(payment.sale_id, payments)
      }
      const saleItemsBySale = new Map<unknown, (typeof tables.sale_items)[number][]>()
      for (const item of tables.sale_items) {
        const items = saleItemsBySale.get(item.sale_id) || []
        items.push(item)
        saleItemsBySale.set(item.sale_id, items)
      }
        if (tab === 'vendor-history') {
          const payments = tables.vendor_debt_payments
            .filter((payment) => !historyDate || String(payment.paid_at).slice(0, 10) === historyDate)
            .sort((a, b) => String(b.paid_at).localeCompare(String(a.paid_at)))
          const rows: VendorPaymentHistory[] = payments.map((payment) => {
            const batch = batchById.get(payment.stock_batch_id)
            const product = batch ? productById.get(batch.product_id) : undefined
            const vendor = batch ? vendorById.get(batch.vendor_id) : undefined
            return {
              id: String(payment.id),
              amount: Number(payment.amount),
              paid_at: String(payment.paid_at),
              stock_batch: batch ? {
                received_at: String(batch.received_at),
                vendor: vendor ? { name: String(vendor.name) } : null,
                product: product ? { name: String(product.name) } : null,
              } : null,
            }
          })
          const start = page * PAGE_SIZE
          setVendorPaymentHistory(rows.slice(start, start + PAGE_SIZE))
          setHasNextPage(rows.length > start + PAGE_SIZE)
          setDebts([])
        } else if (tab === 'customer-history') {
          const payments = tables.customer_debt_payments
            .filter((payment) => !historyDate || String(payment.paid_at).slice(0, 10) === historyDate)
            .sort((a, b) => String(b.paid_at).localeCompare(String(a.paid_at)))
          const rows: CustomerPaymentHistory[] = payments.map((payment) => {
            const sale = saleById.get(payment.sale_id)
            const customer = sale?.customer_id
              ? customerById.get(sale.customer_id)
              : null
            return {
              id: String(payment.id),
              amount: Number(payment.amount),
              paid_at: String(payment.paid_at),
              sale: sale ? {
                invoice_no: String(sale.invoice_no),
                customer: customer ? { name: String(customer.name) } : null,
              } : null,
            }
          })
          const start = page * PAGE_SIZE
          setCustomerPaymentHistory(rows.slice(start, start + PAGE_SIZE))
          setHasNextPage(rows.length > start + PAGE_SIZE)
          setDebts([])
        } else if (tab === 'vendor') {
          const rows: VendorDebtRow[] = tables.product_stock_batches
            .filter((batch) => batch.payment_status === 'kredit')
            .sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || '')))
            .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE + 1)
            .map((batch) => {
              const vendor = vendorById.get(batch.vendor_id)
              const product = productById.get(batch.product_id)
              return {
                id: String(batch.id),
                quantity_received: Number(batch.quantity_received),
                unit_cost: Number(batch.unit_cost),
                received_at: String(batch.received_at),
                due_date: batch.due_date ? String(batch.due_date) : null,
                vendor_id: batch.vendor_id ? String(batch.vendor_id) : null,
                vendor: vendor ? { name: String(vendor.name) } : null,
                product: product ? { name: String(product.name), stock_unit: String(product.stock_unit) } : null,
                vendor_debt_payments: (vendorPaymentsByBatch.get(batch.id) || [])
                  .map((payment) => ({ amount: Number(payment.amount), paid_at: String(payment.paid_at) })),
              }
            })
          setHasNextPage(rows.length > PAGE_SIZE)
          const grouped = new Map<string, Debt>()
          for (const row of rows.slice(0, PAGE_SIZE)) {
            const receivedDate = row.received_at.slice(0, 10)
            const key = `${row.vendor_id || 'unknown'}:${receivedDate}`
            const existing = grouped.get(key)
            const total = Number(row.quantity_received) * Number(row.unit_cost)
            const paid = row.vendor_debt_payments.reduce((sum, item) => sum + Number(item.amount), 0)
            const item = {
              batchId: row.id,
              name: row.product?.name || 'Produk tidak ditemukan',
              quantity: Number(row.quantity_received),
              unit: row.product?.stock_unit || 'satuan',
              unitPrice: Number(row.unit_cost),
              subtotal: total,
              paid,
            }
            if (existing) {
              existing.batchIds.push(row.id)
              existing.total += total
              existing.paid += paid
              existing.payments.push(...row.vendor_debt_payments)
              existing.items.push(item)
            } else {
              grouped.set(key, {
                id: key,
                batchIds: [row.id],
                name: row.vendor?.name || 'Vendor',
                reference: `Stok masuk · ${receivedDate}`,
                createdAt: row.received_at,
                total,
                paid,
                due: row.due_date,
                payments: [...row.vendor_debt_payments],
                items: [item],
              })
            }
          }
          const debts = Array.from(grouped.values())
          setDebts(debts)
          setSelectedItems(Object.fromEntries(debts.map((debt) => [debt.id, []])))
        } else {
          const creditSales = tables.sales
            .filter((sale) => sale.payment_method === 'credit')
            .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(b.id).localeCompare(String(a.id)))
          const pageSales = creditSales.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE + 1)
          setHasNextPage(pageSales.length > PAGE_SIZE)
          const debts = pageSales.slice(0, PAGE_SIZE).map((sale): Debt => {
            const customer = customerById.get(sale.customer_id)
            const customerPayments = (customerPaymentsBySale.get(sale.id) || [])
              .map((payment) => ({ amount: Number(payment.amount), paid_at: String(payment.paid_at) }))
            const saleItems = (saleItemsBySale.get(sale.id) || [])
              .map((item) => ({
                name: String(item.product_name),
                quantity: Number(item.quantity),
                unit: String(item.unit),
                unitPrice: Number(item.unit_price),
                subtotal: Number(item.line_total),
                paid: 0,
              }))
            return {
              id: String(sale.id),
              batchIds: [String(sale.id)],
              name: customer ? String(customer.name) : 'Pelanggan',
              reference: String(sale.invoice_no),
              createdAt: String(sale.created_at),
              total: Number(sale.total_amount),
              paid: Number(sale.amount_paid || 0) + customerPayments.reduce((sum, item) => sum + item.amount, 0),
              due: null,
              payments: customerPayments,
              items: saleItems,
            }
          })
          setDebts(debts)
        }
        setLoading(false)
        return
    } catch (error) {
      toast.error(`Gagal memuat data pelunasan lokal: ${error instanceof Error ? error.message : 'Kesalahan tidak diketahui'}`)
      setDebts([])
      setVendorPaymentHistory([])
      setCustomerPaymentHistory([])
      setHasNextPage(false)
      setLoading(false)
      return
    }
  }
  useEffect(() => {
    setCustomerSearch('')
    setHistorySearch('')
    setHistoryDate('')
    setExpandedDebtId(null)
    setVendorPaymentHistory([])
    setCustomerPaymentHistory([])
    setPage(0)
    setHasNextPage(false)
  }, [tab])
  useEffect(() => {
    void load()
  }, [tab, page])
  const openDebts = useMemo(() => {
    const search = customerSearch.trim().toLowerCase()
    return debts.filter((debt) => (
      debt.total - debt.paid > 0.009
      && (tab === 'vendor' || !search || debt.name.toLowerCase().includes(search))
    ))
  }, [debts, customerSearch, tab])
  const filteredVendorPaymentHistory = useMemo(() => {
    const search = historySearch.trim().toLowerCase()
    return vendorPaymentHistory.filter((item) => {
      const vendorName = item.stock_batch?.vendor?.name || 'Vendor'
      const productName = item.stock_batch?.product?.name || 'Produk tidak ditemukan'
      return (!search || `${vendorName} ${productName}`.toLowerCase().includes(search))
        && (!historyDate || item.paid_at.slice(0, 10) === historyDate)
    })
  }, [historyDate, historySearch, vendorPaymentHistory])
  const filteredCustomerPaymentHistory = useMemo(() => {
    const search = historySearch.trim().toLowerCase()
    return customerPaymentHistory.filter((item) => {
      const customerName = item.sale?.customer?.name || 'Pelanggan'
      const invoiceNo = item.sale?.invoice_no || ''
      return (!search || `${customerName} ${invoiceNo}`.toLowerCase().includes(search))
        && (!historyDate || item.paid_at.slice(0, 10) === historyDate)
    })
  }, [customerPaymentHistory, historyDate, historySearch])
  function settle(debt: Debt) {
    const enteredPayment = payment[debt.id]?.trim() || ''
    const paymentMode = tab === 'vendor' ? vendorPaymentModes[debt.id] : 'nominal'
    const selectedBatchIds = tab === 'vendor' && paymentMode === 'item' ? (selectedItems[debt.id] || []) : debt.batchIds
    const selectedOutstanding = debt.items.filter((item) => item.batchId && selectedBatchIds.includes(item.batchId)).reduce((sum, item) => sum + item.subtotal - item.paid, 0)
    const outstanding = tab === 'vendor' && paymentMode === 'item' ? selectedOutstanding : debt.total - debt.paid
    const amount = paymentMode === 'item' || (tab === 'customer' && !enteredPayment)
      ? outstanding
      : Number(enteredPayment)
    if (tab === 'vendor' && paymentMode === 'item' && selectedBatchIds.length === 0) { toast.error('Pilih minimal satu item untuk dibayar'); return }
    if (!amount || amount <= 0 || amount > outstanding) { toast.error('Nominal pembayaran tidak valid'); return }
    setPendingSettlement({
      debt,
      amount,
      selectedBatchIds,
      isFullPayment: Math.abs(amount - outstanding) < 0.01,
    })
  }

  async function confirmSettlement() {
    if (!pendingSettlement) return
    const { debt, amount, selectedBatchIds } = pendingSettlement
    const allocations: Array<{ stock_batch_id: string; amount: number }> = []
    let remaining = amount
    for (const item of debt.items) {
      if (!item.batchId || !selectedBatchIds.includes(item.batchId) || remaining <= 0) continue
      const allocation = Math.min(remaining, Math.max(0, item.subtotal - item.paid))
      if (allocation > 0) { allocations.push({ stock_batch_id: item.batchId, amount: allocation }); remaining -= allocation }
    }
    try {
      const kind = tab === 'vendor' ? 'vendor' : 'customer'
      if (!administratorId) throw new Error('Akun administrator tidak ditemukan')
      const localSnapshot = await readOperationalSnapshot()
      if (!localSnapshot) {
        throw new Error('Data lokal belum disiapkan. Buka Pengaturan untuk mengambil data awal.')
      }
      {
        const paidAt = new Date().toISOString()
        await updateOperationalSnapshot((snapshot) => {
          if (kind === 'vendor') {
            let remainingAmount = amount
            const newPayments = []
            const updatedBatchIds = new Set<string>()
            for (const allocation of allocations) {
              const batch = snapshot.tables.product_stock_batches.find((row) => row.id === allocation.stock_batch_id)
              if (!batch) throw new Error('Batch stok tidak ditemukan di penyimpanan lokal')
              const alreadyPaid = snapshot.tables.vendor_debt_payments
                .filter((row) => row.stock_batch_id === batch.id)
                .reduce((sum, row) => sum + Number(row.amount), 0)
              const outstanding = Math.max(Number(batch.quantity_received) * Number(batch.unit_cost) - alreadyPaid, 0)
              if (allocation.amount <= 0 || allocation.amount > outstanding + 0.01) {
                throw new Error('Nominal pelunasan vendor melebihi sisa hutang')
              }
              newPayments.push({
                id: crypto.randomUUID(),
                stock_batch_id: batch.id,
                amount: allocation.amount,
                paid_at: paidAt,
                paid_by: administratorId,
              })
              remainingAmount -= allocation.amount
              if (alreadyPaid + allocation.amount >= Number(batch.quantity_received) * Number(batch.unit_cost) - 0.01) {
                updatedBatchIds.add(String(batch.id))
              }
            }
            if (remainingAmount > 0.01) throw new Error('Alokasi pelunasan vendor tidak mencukupi')
            return {
              snapshot: {
                ...snapshot,
                tables: {
                  ...snapshot.tables,
                  product_stock_batches: snapshot.tables.product_stock_batches.map((batch) =>
                    updatedBatchIds.has(String(batch.id)) ? { ...batch, payment_status: 'lunas' } : batch,
                  ),
                  vendor_debt_payments: [...snapshot.tables.vendor_debt_payments, ...newPayments],
                },
              },
              result: undefined,
            }
          }

          const sale = snapshot.tables.sales.find((row) => row.id === debt.id)
          if (!sale || sale.payment_method !== 'credit') {
            throw new Error('Transaksi kredit tidak ditemukan di penyimpanan lokal')
          }
          const alreadyPaid = snapshot.tables.customer_debt_payments
            .filter((row) => row.sale_id === sale.id)
            .reduce((sum, row) => sum + Number(row.amount), 0)
          const outstanding = Math.max(Number(sale.total_amount) - Number(sale.amount_paid) - alreadyPaid, 0)
          if (amount > outstanding + 0.01) throw new Error('Nominal pelunasan melebihi sisa hutang pelanggan')
          return {
            snapshot: {
              ...snapshot,
              tables: {
                ...snapshot.tables,
                customer_debt_payments: [...snapshot.tables.customer_debt_payments, {
                  id: crypto.randomUUID(),
                  sale_id: sale.id,
                  amount,
                  paid_at: paidAt,
                  paid_by: administratorId,
                }],
              },
            },
            result: undefined,
          }
        })
        toast.success('Pembayaran berhasil dicatat di perangkat')
        if (kind === 'customer') {
          setSettlementReceipt({
            invoiceNo: debt.reference,
            customerName: debt.name,
            createdAt: paidAt,
            total: debt.total,
            payment: amount,
            remainingDebt: Math.max(0, debt.total - debt.paid - amount),
            items: debt.items,
          })
        } else {
          void load()
        }
        setPayment((current) => ({ ...current, [debt.id]: '' }))
        setPendingSettlement(null)
        return
      }
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Pelunasan gagal dicatat') }
  }

  function closeSettlementReceipt() {
    setSettlementReceipt(null)
    void load()
  }

  function reprintCustomerDebt(debt: Debt) {
    const latestPayment = debt.payments.reduce<DebtPayment | null>(
      (latest, current) => !latest || current.paid_at > latest.paid_at ? current : latest,
      null,
    )
    setSettlementReceipt({
      invoiceNo: debt.reference,
      customerName: debt.name,
      createdAt: latestPayment?.paid_at || debt.createdAt,
      total: debt.total,
      payment: latestPayment?.amount ?? debt.paid,
      remainingDebt: Math.max(0, debt.total - debt.paid),
      items: debt.items,
    })
  }

  return <div className="space-y-4">
    <header className="page-header sticky top-[-1rem] z-30 -mx-4 -mt-4 flex flex-col gap-4 bg-ink px-4 py-4 text-white shadow-[0_3px_0_rgba(32,42,46,0.2)] sm:top-[-1.25rem] sm:-mx-5 sm:-mt-5 sm:px-5 lg:top-[-2rem] lg:-mx-8 lg:-mt-8 lg:flex-row lg:items-end lg:justify-between lg:px-8 lg:py-5">
      <div>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-white">Pelunasan Hutang</h1>
        <p className="mt-1 text-sm text-accent">Catat pembayaran bertahap untuk vendor dan pelanggan.</p>
      </div>
      {(tab === 'vendor-history' || tab === 'customer-history') && (
        <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
          <div className="relative min-w-0 sm:w-64">
            <Input
              value={historySearch}
              onChange={(event) => setHistorySearch(event.target.value)}
              placeholder={tab === 'vendor-history' ? 'Cari vendor atau item...' : 'Cari pelanggan atau invoice...'}
              aria-label={tab === 'vendor-history' ? 'Cari nama vendor atau item' : 'Cari nama pelanggan atau invoice'}
              className="min-w-0 border-ink bg-ink pr-10 text-white placeholder:text-white/60 focus:border-accent focus:ring-accent/30"
            />
            {historySearch && (
              <button
                type="button"
                aria-label="Reset pencarian"
                onClick={() => setHistorySearch('')}
                className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <label className="relative flex h-10 items-center rounded-xl border border-border bg-surface px-3 text-sm text-muted-foreground sm:w-44">
            <span className="pointer-events-none mr-2 shrink-0">Tanggal</span>
            <input
              type="date"
              value={historyDate}
              onChange={(event) => setHistoryDate(event.target.value)}
              aria-label="Filter tanggal pembayaran"
              className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none"
            />
          </label>
        </div>
      )}
    </header>
    <div className="grid gap-3 lg:grid-cols-2">
      <section className="rounded-2xl border border-border bg-surface p-2.5 shadow-sm">
        <p className="px-2 pb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Hutang yang harus dibayar</p>
        <div className="grid grid-cols-2 gap-2">
          <button className={`min-w-0 rounded-xl px-2 py-3 text-xs font-semibold transition-colors sm:px-3 sm:text-sm ${tab === 'vendor' ? 'bg-ink text-white shadow-sm' : 'bg-muted/50 text-ink hover:bg-muted'}`} onClick={() => setTab('vendor')}>Hutang Vendor</button>
          <button className={`min-w-0 rounded-xl px-2 py-3 text-xs font-semibold transition-colors sm:px-3 sm:text-sm ${tab === 'customer' ? 'bg-ink text-white shadow-sm' : 'bg-muted/50 text-ink hover:bg-muted'}`} onClick={() => setTab('customer')}>Hutang Pelanggan</button>
        </div>
      </section>
      <section className="rounded-2xl border border-accent bg-accent p-2.5 shadow-sm">
        <p className="px-2 pb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-ink">Catatan pembayaran</p>
        <div className="grid grid-cols-2 gap-2">
          <button className={`min-w-0 rounded-xl px-2 py-3 text-xs font-semibold transition-colors sm:px-3 sm:text-sm ${tab === 'vendor-history' ? 'bg-ink text-white shadow-sm' : 'bg-ink/90 text-white hover:bg-ink'}`} onClick={() => setTab('vendor-history')}>Riwayat Vendor</button>
          <button className={`min-w-0 rounded-xl px-2 py-3 text-xs font-semibold transition-colors sm:px-3 sm:text-sm ${tab === 'customer-history' ? 'bg-ink text-white shadow-sm' : 'bg-ink/90 text-white hover:bg-ink'}`} onClick={() => setTab('customer-history')}>Riwayat Pelanggan</button>
        </div>
      </section>
    </div>
    {tab === 'customer' && (
      <div className="relative">
        <Input
          value={customerSearch}
          onChange={(event) => setCustomerSearch(event.target.value)}
          placeholder="Cari nama pelanggan..."
          aria-label="Cari nama pelanggan"
          className="border-ink bg-ink pr-10 text-white placeholder:text-white/60 focus:border-accent focus:ring-accent/30"
        />
        {customerSearch && (
          <button
            type="button"
            aria-label="Reset pencarian"
            onClick={() => setCustomerSearch('')}
            className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    )}
    {loading ? <p className="text-sm text-muted-foreground">Memuat data...</p> : tab === 'vendor-history' ? (
      filteredVendorPaymentHistory.length === 0 ? <Card className="border-border bg-surface"><CardContent className="p-6 text-center text-sm text-ink">Belum ada riwayat pembayaran vendor.</CardContent></Card> : (
        <Card className="border-border bg-surface"><CardContent className="p-3">
          <div className="max-h-[calc(100dvh-22rem)] overflow-auto border-t border-border">
            <table className="w-full min-w-[42rem] text-center text-sm">
              <thead className="sticky top-0 z-10 border-y border-white/10 bg-ink text-xs text-white shadow-[0_2px_0_rgba(32,42,46,0.2)]">
                <tr>
                  <th className="py-2 font-medium">Tanggal</th>
                  <th className="py-2 font-medium">Vendor</th>
                  <th className="py-2 font-medium">Item</th>
                  <th className="py-2 font-medium">Nominal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {filteredVendorPaymentHistory.map((item) => (
                  <tr key={item.id} className="odd:bg-surface even:bg-muted/50 hover:bg-primary/5">
                    <td className="py-2 text-muted-foreground">{new Date(item.paid_at).toLocaleDateString('id-ID')}</td>
                    <td className="py-2 font-medium text-ink">{item.stock_batch?.vendor?.name || 'Vendor'}</td>
                    <td className="py-2">{item.stock_batch?.product?.name || 'Produk tidak ditemukan'}</td>
                    <td className="py-2 font-semibold text-primary">{formatCurrency(Number(item.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent></Card>
      )
    ) : tab === 'customer-history' ? (
      filteredCustomerPaymentHistory.length === 0 ? <Card className="border-border bg-muted/50"><CardContent className="p-6 text-center text-sm text-ink">Belum ada riwayat pembayaran pelanggan.</CardContent></Card> : (
        <Card className="border-border bg-surface"><CardContent className="p-3">
          <div className="max-h-[calc(100dvh-22rem)] overflow-auto border-t border-border">
            <table className="w-full min-w-[38rem] text-center text-sm">
              <thead className="sticky top-0 z-10 border-y border-white/10 bg-ink text-xs text-white shadow-[0_2px_0_rgba(32,42,46,0.2)]">
                <tr>
                  <th className="py-2 font-medium">Tanggal</th>
                  <th className="py-2 font-medium">Pelanggan</th>
                  <th className="py-2 font-medium">Invoice</th>
                  <th className="py-2 font-medium">Nominal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {filteredCustomerPaymentHistory.map((item) => (
                  <tr key={item.id} className="odd:bg-surface even:bg-muted/50 hover:bg-primary/5">
                    <td className="py-2 text-muted-foreground">{new Date(item.paid_at).toLocaleDateString('id-ID')}</td>
                    <td className="py-2 font-medium text-ink">{item.sale?.customer?.name || 'Pelanggan'}</td>
                    <td className="py-2">{item.sale?.invoice_no || '-'}</td>
                    <td className="py-2 font-semibold text-primary">{formatCurrency(Number(item.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent></Card>
      )
    ) : openDebts.length === 0 ? <Card className="border-border bg-muted/50"><CardContent className="p-6 text-center text-sm text-ink">Tidak ada hutang terbuka.</CardContent></Card> : <div className={`grid ${tab === 'customer' ? 'gap-2' : 'gap-3'}`}>
      {openDebts.map((debt, index) => <Card key={debt.id} className={`border-border ${index % 2 === 0 ? 'bg-surface' : 'bg-muted/50'}`}><CardContent className={tab === 'customer' ? 'space-y-2 p-2 sm:p-3' : 'space-y-2 p-2.5 sm:p-3'}>
        <div className={`flex flex-col ${tab === 'customer' ? 'gap-1.5' : 'gap-2'} sm:flex-row sm:items-center sm:justify-between`}>
          <div className={`min-w-0 ${tab === 'customer' ? 'w-full sm:flex-1' : ''}`}>
            {tab === 'customer' ? (
              <div className="grid w-full min-w-0 grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 sm:pr-6">
                <p className="row-span-2 self-start pt-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">{page * PAGE_SIZE + index + 1}.</p>
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-ink">{debt.name}</p>
                  <p className="shrink-0 whitespace-nowrap rounded-full bg-accent px-2 py-0.5 text-center text-[11px] font-bold text-ink">
                    {new Date(debt.createdAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                <p className="truncate text-[11px] text-muted-foreground">{debt.reference}</p>
              </div>
            ) : (
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <p className="truncate text-sm font-semibold text-ink">{debt.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {debt.reference}{debt.due ? ` · jatuh tempo ${debt.due}` : ''}
                </p>
              </div>
            )}
            <p className={`${tab === 'customer' ? 'ml-[2.25rem]' : ''} text-xs text-muted-foreground`}>Sisa <strong className="text-primary">{formatCurrency(debt.total - debt.paid)}</strong></p>
          </div>
          <div className={`${tab === 'customer' ? 'grid grid-cols-[2rem_minmax(0,1fr)_auto_auto] items-center gap-1 sm:flex sm:gap-2' : 'flex gap-2'} w-full sm:w-auto`}>
            {tab === 'customer' && (
              <Button
                variant="outline"
                size="icon"
                className={tab === 'customer' ? 'h-8 w-8' : undefined}
                onClick={() => reprintCustomerDebt(debt)}
                aria-label={`Cetak ulang struk ${debt.name} ${debt.reference}`}
                title="Cetak ulang struk"
              >
                <Printer className="h-3.5 w-3.5" />
              </Button>
            )}
            <Input
              type="text"
              inputMode="numeric"
              value={payment[debt.id] ? formatCurrency(Number(payment[debt.id])) : ''}
              disabled={tab === 'vendor' && vendorPaymentModes[debt.id] === 'item'}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => {
              const value = event.target.value.replace(/\D/g, '')
              if (tab === 'vendor' && value.trim() && !vendorPaymentModes[debt.id]) {
                setVendorPaymentModes((current) => ({ ...current, [debt.id]: 'nominal' }))
              }
              setPayment((current) => ({ ...current, [debt.id]: value }))
            }}
              placeholder="Nominal"
              aria-label={`Nominal pembayaran ${debt.name}`}
              className={`${tab === 'customer' ? 'h-9 min-w-0 px-2 sm:h-8 sm:min-w-[7rem]' : 'h-10 min-w-[8.5rem]'} flex-1 sm:w-40 sm:flex-none`}
            />
            <Button className={`${tab === 'customer' ? 'h-8 px-2.5 text-xs' : 'h-10 px-3'} border-accent bg-accent text-ink shadow-sm hover:border-accent/90 hover:bg-accent/90`} onClick={() => setExpandedDebtId((current) => current === debt.id ? null : debt.id)}>
              Rincian
            </Button>
            <Button className={`${tab === 'customer' ? 'h-8 px-2.5 text-xs' : 'h-10 px-3'} bg-ink text-white shadow-[0_6px_16px_rgba(32,42,46,0.16)] hover:bg-ink/90`} onClick={() => settle(debt)}><WalletCards className={tab === 'customer' ? 'h-3.5 w-3.5' : 'h-4 w-4'} /> Bayar</Button>
          </div>
        </div>
        {expandedDebtId === debt.id && (
          <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm">
            <div className="grid gap-1 sm:grid-cols-3">
              <p>Total: <strong>{formatCurrency(debt.total)}</strong></p>
              <p>Sudah dibayar: <strong>{formatCurrency(debt.paid)}</strong></p>
              <p>Sisa: <strong className="text-primary">{formatCurrency(debt.total - debt.paid)}</strong></p>
            </div>
            <div className="mt-3 border-t border-border pt-2">
              <p className="mb-2 font-semibold text-ink">Rincian item</p>
              <div className="max-h-64 overflow-auto border-t border-amber-200/80">
                <table className="w-full min-w-[28rem] text-center text-xs">
                  <thead className="sticky top-0 z-10 border-y border-white/10 bg-ink text-xs text-white shadow-[0_2px_0_rgba(32,42,46,0.2)]">
                    <tr>
                      <th className="py-1 font-medium">Item</th>
                      <th className="py-1 font-medium">Jumlah</th>
                      <th className="py-1 font-medium">Harga</th>
                      <th className="py-1 font-medium">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {debt.items.map((item, index) => (
                      <tr key={`${debt.id}-item-${index}`} className="odd:bg-surface even:bg-muted/50 hover:bg-primary/5">
                        <td className="py-1.5 text-ink">
                          {tab === 'vendor' && item.batchId && (
                            <input
                              type="checkbox"
                              className="mr-2 accent-primary"
                              checked={(selectedItems[debt.id] || []).includes(item.batchId)}
                              disabled={vendorPaymentModes[debt.id] === 'nominal'}
                              onChange={(event) => setSelectedItems((current) => ({
                                ...current,
                                [debt.id]: event.target.checked
                                  ? [...(current[debt.id] || []), item.batchId as string]
                                  : (current[debt.id] || []).filter((id) => id !== item.batchId),
                              }))}
                              onClick={() => {
                                if (!vendorPaymentModes[debt.id]) {
                                  setVendorPaymentModes((current) => ({ ...current, [debt.id]: 'item' }))
                                }
                              }}
                              aria-label={`Pilih ${item.name} untuk dibayar`}
                            />
                          )}
                          {item.name}
                        </td>
                        <td className="py-1.5">{item.quantity} {UNIT_LABELS[item.unit] || item.unit}</td>
                        <td className="py-1.5">{formatCurrency(item.unitPrice)}</td>
                        <td className="py-1.5 font-medium text-ink">{formatCurrency(item.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {debt.payments.length > 0 && (
              <div className="mt-3 space-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
                {debt.payments.map((item, index) => (
                  <p key={`${debt.id}-payment-${index}`}>
                    Pembayaran {index + 1}: {formatCurrency(item.amount)} · {new Date(item.paid_at).toLocaleDateString('id-ID')}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent></Card>)}
    </div>}
    {(debts.length > 0 || vendorPaymentHistory.length > 0) && (
      <div className="flex items-center justify-between border-t border-border pt-3">
        <span className="text-xs text-muted-foreground">Halaman {page + 1}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0 || loading}>
            <ChevronLeft className="h-4 w-4" /> Sebelumnya
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPage((current) => current + 1)} disabled={!hasNextPage || loading}>
            Berikutnya <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    )}
    {pendingSettlement && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/55 p-4" role="presentation" onClick={() => setPendingSettlement(null)}>
        <div
          className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settlement-confirmation-title"
          onClick={(event) => event.stopPropagation()}
        >
          <h2 id="settlement-confirmation-title" className="text-lg font-semibold text-ink">Konfirmasi pembayaran</h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Apakah yakin akan membayar <strong className="text-ink">{formatCurrency(pendingSettlement.amount)}</strong> untuk <strong className="text-ink">{pendingSettlement.debt.name}</strong>?
          </p>
          {pendingSettlement.isFullPayment && (
            <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
              Ini akan melunasi seluruh hutang ({formatCurrency(pendingSettlement.debt.total - pendingSettlement.debt.paid)}).
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPendingSettlement(null)}>Batal</Button>
            <Button onClick={() => void confirmSettlement()}>Ya, Bayar</Button>
          </div>
        </div>
      </div>
    )}
    {settlementReceipt && (
      <SettlementReceiptPreview
        receipt={settlementReceipt}
        onClose={closeSettlementReceipt}
      />
    )}
  </div>
}

function SettlementReceiptPreview({
  receipt,
  onClose,
}: {
  receipt: CustomerDebtReceipt
  onClose: () => void
}) {
  const printButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const focusTimer = window.setTimeout(() => printButtonRef.current?.focus({ preventScroll: true }), 0)
    return () => window.clearTimeout(focusTimer)
  }, [])

  async function printReceipt() {
    try {
      invokeReceiptPrint(document.getElementById('receipt-print-root'))
      onClose()
    } catch (error) {
      toast.error(`Gagal mencetak struk: ${error instanceof Error ? error.message : 'Kesalahan tidak diketahui'}`)
    }
  }

  function ReceiptDocument() {
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
          <span className="receipt-title">Struk Pembayaran Hutang</span>
        </header>
        <div className="receipt-rule" />
        <div className="receipt-meta">
          <span>No. {receipt.invoiceNo}</span>
          <span>{new Date(receipt.createdAt).toLocaleString('id-ID')}</span>
        </div>
        <div className="receipt-customer">Pelanggan: <strong>{receipt.customerName}</strong></div>
        <div className="receipt-rule" />
        <div className="receipt-items">
          {receipt.items.filter((item) => item.quantity > 0).map((item, index) => (
            <div key={`${item.name}-${index}`} className="receipt-item">
              <div>{item.name}</div>
              <div className="receipt-item-detail">
                <span>{item.quantity} {UNIT_LABELS[item.unit] || item.unit} × {formatCurrency(item.unitPrice)}</span>
                <strong>{formatCurrency(item.subtotal)}</strong>
              </div>
            </div>
          ))}
        </div>
        <div className="receipt-rule" />
        <div className="receipt-total receipt-total-highlight">
          <span>TOTAL</span>
          <strong>{formatCurrency(receipt.total)}</strong>
        </div>
        <div className="receipt-summary">
          <span>Bayar hutang</span>
          <span>{formatCurrency(receipt.payment)}</span>
        </div>
        <div className="receipt-summary receipt-summary-debt">
          <span>Sisa hutang</span>
          <span>{formatCurrency(receipt.remainingDebt)}</span>
        </div>
        <footer className="receipt-center receipt-footer">Terima kasih</footer>
      </article>
    )
  }

  return (
    <>
      <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4 print:hidden">
        <Card className="w-full max-w-md rounded-t-2xl sm:rounded-2xl">
          <CardContent className="space-y-4 p-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Preview struk 58 mm</p>
              <h3 className="mt-1 text-xl font-bold text-ink">Siap dicetak</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {receipt.invoiceNo} · {formatCurrency(receipt.payment)}
              </p>
            </div>
            <div className="receipt-preview-frame">
              <ReceiptDocument />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={onClose}>Nanti</Button>
              <Button
                ref={printButtonRef}
                className="flex-1 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
                onClick={printReceipt}
              >
                Cetak struk
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
      {createPortal(
        <div id="receipt-print-root" aria-hidden="true">
          <ReceiptDocument />
        </div>,
        document.body,
      )}
    </>
  )
}
