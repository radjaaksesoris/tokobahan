import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/utils'
import { UNIT_LABELS } from '@/types'
import { toast } from 'sonner'
import { WalletCards, RefreshCw, CloudOff, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  enqueueSettlement,
  getQueuedSettlements,
  removeQueuedSettlement,
  retryFailedSettlements,
  subscribeOfflineSettlements,
  syncQueuedSettlements,
} from '@/lib/offlineSettlements'
import { isOfflineError } from '@/lib/offlineTransactions'
import { useAuthStore } from '@/store/useAuthStore'

type Tab = 'vendor' | 'customer' | 'vendor-history' | 'customer-history'
type VendorPaymentMode = 'nominal' | 'item'
type DebtPayment = { amount: number; paid_at: string }
type DebtItem = { batchId?: string; name: string; quantity: number; unit: string; unitPrice: number; subtotal: number; paid: number }
type Debt = {
  id: string
  batchIds: string[]
  name: string
  reference: string
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
  const [tab, setTab] = useState<Tab>('vendor')
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
  const [pendingSettlements, setPendingSettlements] = useState(0)
  const [unmatchedSettlements, setUnmatchedSettlements] = useState(0)
  const [page, setPage] = useState(0)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [pendingSettlement, setPendingSettlement] = useState<PendingSettlement | null>(null)

  async function refreshQueue() {
    const records = await getQueuedSettlements()
    setPendingSettlements(records.filter((item) => item.userId === administratorId && item.status !== 'syncing').length)
    setUnmatchedSettlements(records.filter((item) => item.userId !== administratorId).length)
  }

  useEffect(() => {
    void refreshQueue()
    const unsubscribe = subscribeOfflineSettlements(() => { void refreshQueue() })
    return () => { unsubscribe() }
  }, [administratorId])

  async function load() {
    setLoading(true)
    if (tab === 'vendor-history') {
      const { data: rawData, error } = await supabase.from('vendor_debt_payments')
        .select('id, amount, paid_at, stock_batch:product_stock_batches(received_at, vendor:vendors(name), product:products(name))')
        .order('paid_at', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
      if (error) toast.error(error.message)
      setVendorPaymentHistory((rawData || []).slice(0, PAGE_SIZE) as unknown as VendorPaymentHistory[])
      setHasNextPage((rawData || []).length > PAGE_SIZE)
      setDebts([])
    } else if (tab === 'customer-history') {
      const { data: rawData, error } = await supabase.from('customer_debt_payments')
        .select('id, amount, paid_at, sale:sales(invoice_no, customer:customers(name))')
        .order('paid_at', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
      if (error) toast.error(error.message)
      setCustomerPaymentHistory((rawData || []).slice(0, PAGE_SIZE) as unknown as CustomerPaymentHistory[])
      setHasNextPage((rawData || []).length > PAGE_SIZE)
      setDebts([])
    } else if (tab === 'vendor') {
      const { data: rawData, error } = await supabase.from('product_stock_batches')
        .select('id, quantity_received, unit_cost, received_at, due_date, vendor_id, vendor:vendors(name), product:products(name, stock_unit), vendor_debt_payments(amount, paid_at)')
        .eq('payment_status', 'kredit').order('due_date').range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
      if (error) toast.error(error.message)
      setHasNextPage((rawData || []).length > PAGE_SIZE)
      const data = rawData as unknown as VendorDebtRow[] | null
      const grouped = new Map<string, Debt>()
      for (const row of data || []) {
        const receivedDate = row.received_at.slice(0, 10)
        const key = `${row.vendor_id || 'unknown'}:${receivedDate}`
        const existing = grouped.get(key)
        const total = Number(row.quantity_received) * Number(row.unit_cost)
        const payments = (row.vendor_debt_payments || []).map((p: any) => ({ amount: Number(p.amount), paid_at: p.paid_at }))
        const paid = payments.reduce((sum: number, p: DebtPayment) => sum + p.amount, 0)
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
          existing.payments.push(...payments)
          existing.items.push(item)
          continue
        }
        grouped.set(key, {
          id: key,
          batchIds: [row.id],
          name: row.vendor?.name || 'Vendor',
          reference: `Stok masuk · ${receivedDate}`,
          total,
          paid,
          due: row.due_date,
          payments,
          items: [item],
        })
      }
      setDebts(Array.from(grouped.values()))
      setSelectedItems(Object.fromEntries(Array.from(grouped.values()).map((debt) => [debt.id, []])))
    } else {
      const { data, error } = await supabase.from('sales')
        .select('id, invoice_no, total_amount, amount_paid, created_at, customer:customers(name), sale_items(product_name, quantity, unit, unit_price, line_total), customer_debt_payments(amount, paid_at)')
        .eq('payment_method', 'credit')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
      if (error) toast.error(error.message)
      setHasNextPage((data || []).length > PAGE_SIZE)
      setDebts((data || []).map((row: any) => ({
        id: row.id, batchIds: [row.id], name: row.customer?.name || 'Pelanggan', reference: row.invoice_no,
        total: Number(row.total_amount), paid: Number(row.amount_paid || 0) + (row.customer_debt_payments || []).reduce((sum: number, p: any) => sum + Number(p.amount), 0),
        due: null,
        payments: (row.customer_debt_payments || []).map((p: any) => ({ amount: Number(p.amount), paid_at: p.paid_at })),
        items: (row.sale_items || []).map((item: any) => ({
          name: item.product_name,
          quantity: Number(item.quantity),
          unit: item.unit,
          unitPrice: Number(item.unit_price),
          subtotal: Number(item.line_total),
          paid: 0,
        })),
      })))
    }
    setLoading(false)
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
      const payload = kind === 'vendor' ? { allocations } : { sale_id: debt.id, amount }
      if (!administratorId) throw new Error('Akun administrator tidak ditemukan')
      const queued = await enqueueSettlement(kind, payload, administratorId)
      let accepted = true

      if (navigator.onLine) {
        try {
          await syncQueuedSettlements(administratorId)
        } catch (error) {
          console.error('Immediate settlement sync failed:', error)
        }
        const stillQueued = (await getQueuedSettlements()).find((record) => record.id === queued.id)
        if (!stillQueued) {
          toast.success('Pembayaran berhasil dicatat')
        } else if (stillQueued.status === 'failed' && !isOfflineError({ message: stillQueued.lastError || '' })) {
          await removeQueuedSettlement(stillQueued.id)
          accepted = false
          toast.error(stillQueued.lastError || 'Pelunasan ditolak')
        } else {
          toast.info('Pelunasan tersimpan dan akan disinkronkan otomatis')
        }
      } else {
        toast.info('Pelunasan disimpan dan akan disinkronkan saat online')
      }

      if (accepted) {
        setPayment((current) => ({ ...current, [debt.id]: '' }))
        setPendingSettlement(null)
      }
      await refreshQueue()
      if (accepted && !navigator.onLine) void load()
      else if (accepted) void load()
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Pelunasan gagal dicatat') }
  }

  async function retrySettlements() {
    if (!administratorId) {
      toast.error('Akun administrator tidak ditemukan')
      return
    }
    const result = await retryFailedSettlements(administratorId)
    await refreshQueue(); if (result.failed === 0 && result.synced > 0) { toast.success(`${result.synced} pelunasan berhasil disinkronkan`); void load() }
  }

  return <div className="space-y-6">
    <header className="page-header sticky top-[-1rem] z-30 -mx-4 -mt-4 flex flex-col gap-4 bg-ink px-4 py-4 text-white shadow-[0_3px_0_rgba(32,42,46,0.2)] sm:top-[-1.25rem] sm:-mx-5 sm:-mt-5 sm:px-5 lg:top-[-2rem] lg:-mx-8 lg:-mt-8 lg:flex-row lg:items-end lg:justify-between lg:px-8 lg:py-5">
      <div>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-white">Pelunasan Hutang</h1>
        <p className="mt-1 text-sm text-accent">Catat pembayaran bertahap untuk vendor dan pelanggan.</p>
        {pendingSettlements > 0 && <div className="mt-3 flex items-center gap-2 text-xs text-amber-700"><CloudOff className="h-4 w-4" />{pendingSettlements} pelunasan menunggu sinkronisasi <button className="inline-flex items-center gap-1 underline" onClick={() => void retrySettlements()}><RefreshCw className="h-3 w-3" />Coba lagi</button></div>}
        {unmatchedSettlements > 0 && <p className="mt-3 text-xs text-amber-700">{unmatchedSettlements} antrean pelunasan lama tidak dikirim otomatis karena akun pembuatnya tidak cocok atau tidak tercatat. Periksa transaksi tersebut secara manual.</p>}
      </div>
      {(tab === 'vendor-history' || tab === 'customer-history') && (
        <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
          <Input
            value={historySearch}
            onChange={(event) => setHistorySearch(event.target.value)}
            placeholder={tab === 'vendor-history' ? 'Cari vendor atau item...' : 'Cari pelanggan atau invoice...'}
            aria-label={tab === 'vendor-history' ? 'Cari nama vendor atau item' : 'Cari nama pelanggan atau invoice'}
            className="min-w-0 sm:w-64"
          />
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
      <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-2.5 shadow-sm">
        <p className="px-2 pb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-amber-800">Hutang yang harus dibayar</p>
        <div className="grid grid-cols-2 gap-2">
          <button className={`min-w-0 rounded-xl px-2 py-3 text-xs font-semibold transition-colors sm:px-3 sm:text-sm ${tab === 'vendor' ? 'bg-amber-600 text-white shadow-sm' : 'bg-amber-100/70 text-amber-900 hover:bg-amber-200/80'}`} onClick={() => setTab('vendor')}>Hutang Vendor</button>
          <button className={`min-w-0 rounded-xl px-2 py-3 text-xs font-semibold transition-colors sm:px-3 sm:text-sm ${tab === 'customer' ? 'bg-amber-600 text-white shadow-sm' : 'bg-amber-100/70 text-amber-900 hover:bg-amber-200/80'}`} onClick={() => setTab('customer')}>Hutang Pelanggan</button>
        </div>
      </section>
      <section className="rounded-2xl border border-teal-200 bg-teal-50/70 p-2.5 shadow-sm">
        <p className="px-2 pb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-teal-800">Catatan pembayaran</p>
        <div className="grid grid-cols-2 gap-2">
          <button className={`min-w-0 rounded-xl px-2 py-3 text-xs font-semibold transition-colors sm:px-3 sm:text-sm ${tab === 'vendor-history' ? 'bg-teal-700 text-white shadow-sm' : 'bg-teal-100/70 text-teal-900 hover:bg-teal-200/80'}`} onClick={() => setTab('vendor-history')}>Riwayat Vendor</button>
          <button className={`min-w-0 rounded-xl px-2 py-3 text-xs font-semibold transition-colors sm:px-3 sm:text-sm ${tab === 'customer-history' ? 'bg-teal-700 text-white shadow-sm' : 'bg-teal-100/70 text-teal-900 hover:bg-teal-200/80'}`} onClick={() => setTab('customer-history')}>Riwayat Pelanggan</button>
        </div>
      </section>
    </div>
    {tab === 'customer' && (
      <Input
        value={customerSearch}
        onChange={(event) => setCustomerSearch(event.target.value)}
        placeholder="Cari nama pelanggan..."
        aria-label="Cari nama pelanggan"
      />
    )}
    {loading ? <p className="text-sm text-muted-foreground">Memuat data...</p> : tab === 'vendor-history' ? (
      filteredVendorPaymentHistory.length === 0 ? <Card className="border-teal-200 bg-teal-50/40"><CardContent className="p-6 text-center text-sm text-muted-foreground">Belum ada riwayat pembayaran vendor.</CardContent></Card> : (
        <Card className="border-teal-200 bg-teal-50/40"><CardContent className="p-3">
          <div className="max-h-[calc(100dvh-22rem)] overflow-auto border-t border-teal-200/80">
            <table className="w-full min-w-[42rem] text-sm">
              <thead className="sticky top-0 z-10 border-y border-teal-200 bg-teal-50 text-left text-xs text-muted-foreground shadow-[0_2px_0_rgba(15,118,110,0.12)]">
                <tr>
                  <th className="py-2 pr-3 font-medium">Tanggal</th>
                  <th className="py-2 pr-3 font-medium">Vendor</th>
                  <th className="py-2 pr-3 font-medium">Item</th>
                  <th className="py-2 text-right font-medium">Nominal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {filteredVendorPaymentHistory.map((item) => (
                  <tr key={item.id}>
                    <td className="py-2 pr-3 text-muted-foreground">{new Date(item.paid_at).toLocaleDateString('id-ID')}</td>
                    <td className="py-2 pr-3 font-medium text-ink">{item.stock_batch?.vendor?.name || 'Vendor'}</td>
                    <td className="py-2 pr-3">{item.stock_batch?.product?.name || 'Produk tidak ditemukan'}</td>
                    <td className="py-2 text-right font-semibold text-primary">{formatCurrency(Number(item.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent></Card>
      )
    ) : tab === 'customer-history' ? (
      filteredCustomerPaymentHistory.length === 0 ? <Card className="border-teal-200 bg-teal-50/40"><CardContent className="p-6 text-center text-sm text-muted-foreground">Belum ada riwayat pembayaran pelanggan.</CardContent></Card> : (
        <Card className="border-teal-200 bg-teal-50/40"><CardContent className="p-3">
          <div className="max-h-[calc(100dvh-22rem)] overflow-auto border-t border-teal-200/80">
            <table className="w-full min-w-[38rem] text-sm">
              <thead className="sticky top-0 z-10 border-y border-teal-200 bg-teal-50 text-left text-xs text-muted-foreground shadow-[0_2px_0_rgba(15,118,110,0.12)]">
                <tr>
                  <th className="py-2 pr-3 font-medium">Tanggal</th>
                  <th className="py-2 pr-3 font-medium">Pelanggan</th>
                  <th className="py-2 pr-3 font-medium">Invoice</th>
                  <th className="py-2 text-right font-medium">Nominal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {filteredCustomerPaymentHistory.map((item) => (
                  <tr key={item.id}>
                    <td className="py-2 pr-3 text-muted-foreground">{new Date(item.paid_at).toLocaleDateString('id-ID')}</td>
                    <td className="py-2 pr-3 font-medium text-ink">{item.sale?.customer?.name || 'Pelanggan'}</td>
                    <td className="py-2 pr-3">{item.sale?.invoice_no || '-'}</td>
                    <td className="py-2 text-right font-semibold text-primary">{formatCurrency(Number(item.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent></Card>
      )
    ) : openDebts.length === 0 ? <Card className="border-amber-200 bg-amber-50/40"><CardContent className="p-6 text-center text-sm text-muted-foreground">Tidak ada hutang terbuka.</CardContent></Card> : <div className="grid gap-3">
      {openDebts.map((debt) => <Card key={debt.id} className="border-amber-200 bg-amber-50/40"><CardContent className="space-y-2 p-2.5 sm:p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <p className="truncate text-sm font-semibold text-ink">{debt.name}</p>
              <p className="text-[11px] text-muted-foreground">{debt.reference}{debt.due ? ` · jatuh tempo ${debt.due}` : ''}</p>
            </div>
            <p className="text-xs text-muted-foreground">Sisa <strong className="text-primary">{formatCurrency(debt.total - debt.paid)}</strong></p>
          </div>
          <div className="flex w-full gap-1.5 sm:w-auto">
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
              className="h-10 min-w-0 flex-1 sm:w-28 sm:flex-none"
            />
            <Button className="h-10 px-3" variant="outline" onClick={() => setExpandedDebtId((current) => current === debt.id ? null : debt.id)}>
              Rincian
            </Button>
            <Button className="h-10 px-3" onClick={() => settle(debt)}><WalletCards className="h-4 w-4" /> Bayar</Button>
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
                <table className="w-full min-w-[28rem] text-xs">
                  <thead className="sticky top-0 z-10 border-y border-amber-200 bg-amber-50 text-left text-muted-foreground shadow-[0_2px_0_rgba(180,83,9,0.12)]">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Item</th>
                      <th className="py-1 pr-3 font-medium">Jumlah</th>
                      <th className="py-1 pr-3 font-medium">Harga</th>
                      <th className="py-1 text-right font-medium">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {debt.items.map((item, index) => (
                      <tr key={`${debt.id}-item-${index}`}>
                        <td className="py-1.5 pr-3 text-ink">
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
                        <td className="py-1.5 pr-3">{item.quantity} {UNIT_LABELS[item.unit] || item.unit}</td>
                        <td className="py-1.5 pr-3">{formatCurrency(item.unitPrice)}</td>
                        <td className="py-1.5 text-right font-medium text-ink">{formatCurrency(item.subtotal)}</td>
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
  </div>
}
