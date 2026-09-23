import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/utils'
import { UNIT_LABELS } from '@/types'
import { toast } from 'sonner'
import { WalletCards } from 'lucide-react'

type Tab = 'vendor' | 'customer'
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
type VendorBatchRow = {
  id: string
  quantity_received: number
  unit_cost: number
  vendor_debt_payments: DebtPayment[]
}

export default function Settlements() {
  const [tab, setTab] = useState<Tab>('vendor')
  const [debts, setDebts] = useState<Debt[]>([])
  const [payment, setPayment] = useState<Record<string, string>>({})
  const [expandedDebtId, setExpandedDebtId] = useState<string | null>(null)
  const [selectedItems, setSelectedItems] = useState<Record<string, string[]>>({})
  const [vendorPaymentModes, setVendorPaymentModes] = useState<Record<string, VendorPaymentMode>>({})
  const [customerSearch, setCustomerSearch] = useState('')
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    if (tab === 'vendor') {
      const { data: rawData, error } = await supabase.from('product_stock_batches')
        .select('id, quantity_received, unit_cost, received_at, due_date, vendor_id, vendor:vendors(name), product:products(name, stock_unit), vendor_debt_payments(amount, paid_at)')
        .eq('payment_status', 'kredit').order('due_date')
      if (error) toast.error(error.message)
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
        .eq('payment_method', 'credit').order('created_at', { ascending: true })
      if (error) toast.error(error.message)
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
    setExpandedDebtId(null)
    void load()
  }, [tab])
  const openDebts = useMemo(() => {
    const search = customerSearch.trim().toLowerCase()
    return debts.filter((debt) => (
      debt.total - debt.paid > 0.009
      && (tab === 'vendor' || !search || debt.name.toLowerCase().includes(search))
    ))
  }, [debts, customerSearch, tab])
  async function settle(debt: Debt) {
    const enteredPayment = payment[debt.id]?.trim() || ''
    const hasNominal = enteredPayment !== ''
    const paymentMode = tab === 'vendor' ? vendorPaymentModes[debt.id] : 'nominal'
    const selectedBatchIds = tab === 'vendor' && paymentMode === 'item' ? (selectedItems[debt.id] || []) : debt.batchIds
    const selectedOutstanding = debt.items
      .filter((item) => item.batchId && selectedBatchIds.includes(item.batchId))
      .reduce((sum, item) => sum + item.subtotal - item.paid, 0)
    const outstanding = tab === 'vendor' && paymentMode === 'item' ? selectedOutstanding : debt.total - debt.paid
    const amount = paymentMode === 'item' ? outstanding : Number(enteredPayment)
    if (tab === 'customer' && !hasNominal) { toast.error('Masukkan nominal pembayaran'); return }
    if (tab === 'vendor' && paymentMode === 'item' && selectedBatchIds.length === 0) { toast.error('Pilih minimal satu item untuk dibayar'); return }
    if (!amount || amount <= 0 || amount > outstanding) { toast.error('Nominal pembayaran tidak valid'); return }
    let error: { message: string } | null = null
    if (tab === 'vendor') {
      let remaining = amount
      for (const batchId of selectedBatchIds) {
        if (remaining <= 0.009) break
        const { data: rawBatch, error: batchError } = await supabase
          .from('product_stock_batches')
          .select('id, quantity_received, unit_cost, vendor_debt_payments(amount)')
          .eq('id', batchId)
          .single()
        if (batchError) {
          error = batchError
          break
        }
        const batch = rawBatch as unknown as VendorBatchRow
        const batchTotal = Number(batch.quantity_received) * Number(batch.unit_cost)
        const batchPaid = (batch.vendor_debt_payments || []).reduce((sum: number, p: any) => sum + Number(p.amount), 0)
        const batchOutstanding = Math.max(0, batchTotal - batchPaid)
        const batchAmount = Math.min(remaining, batchOutstanding)
        if (batchAmount > 0.009) {
          const { error: paymentError } = await supabase.from('vendor_debt_payments').insert({ stock_batch_id: batchId, amount: batchAmount })
          if (paymentError) {
            error = paymentError
            break
          }
          if (batchAmount >= batchOutstanding - 0.009) {
            const { error: statusError } = await supabase.from('product_stock_batches').update({ payment_status: 'lunas' }).eq('id', batchId)
            if (statusError) {
              error = statusError
              break
            }
          }
          remaining -= batchAmount
        }
      }
    } else {
      const result = await supabase.from('customer_debt_payments').insert({ sale_id: debt.id, amount })
      error = result.error
    }
    if (error) toast.error(error.message)
    else {
      toast.success('Pembayaran berhasil dicatat'); setPayment((current) => ({ ...current, [debt.id]: '' })); void load()
    }
  }
  return <div className="space-y-6">
    <header><p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Keuangan</p><h1 className="mt-1 text-2xl font-bold text-ink">Pelunasan Hutang</h1><p className="mt-1 text-sm text-muted-foreground">Catat pembayaran bertahap untuk vendor dan pelanggan.</p></header>
    <div className="flex gap-2 rounded-xl bg-muted p-1">
      <button className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold ${tab === 'vendor' ? 'bg-surface shadow-sm' : 'text-muted-foreground'}`} onClick={() => setTab('vendor')}>Hutang Vendor</button>
      <button className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold ${tab === 'customer' ? 'bg-surface shadow-sm' : 'text-muted-foreground'}`} onClick={() => setTab('customer')}>Hutang Pelanggan</button>
    </div>
    {tab === 'customer' && (
      <Input
        value={customerSearch}
        onChange={(event) => setCustomerSearch(event.target.value)}
        placeholder="Cari nama pelanggan..."
        aria-label="Cari nama pelanggan"
      />
    )}
    {loading ? <p className="text-sm text-muted-foreground">Memuat data...</p> : openDebts.length === 0 ? <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">Tidak ada hutang terbuka.</CardContent></Card> : <div className="grid gap-3">
      {openDebts.map((debt) => <Card key={debt.id}><CardContent className="space-y-2 p-2.5 sm:p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <p className="truncate text-sm font-semibold text-ink">{debt.name}</p>
              <p className="text-[11px] text-muted-foreground">{debt.reference}{debt.due ? ` · jatuh tempo ${debt.due}` : ''}</p>
            </div>
            <p className="text-xs text-muted-foreground">Sisa <strong className="text-primary">{formatCurrency(debt.total - debt.paid)}</strong></p>
          </div>
          <div className="flex w-full gap-1.5 sm:w-auto">
            <Input type="number" min="1" max={debt.total - debt.paid} value={payment[debt.id] || ''} disabled={tab === 'vendor' && vendorPaymentModes[debt.id] === 'item'} onChange={(event) => {
              const value = event.target.value
              if (tab === 'vendor' && value.trim() && !vendorPaymentModes[debt.id]) {
                setVendorPaymentModes((current) => ({ ...current, [debt.id]: 'nominal' }))
              }
              setPayment((current) => ({ ...current, [debt.id]: value }))
            }} placeholder="Nominal" className="h-9 min-w-0 flex-1 sm:w-28 sm:flex-none" />
            <Button className="h-9 px-3" variant="outline" onClick={() => setExpandedDebtId((current) => current === debt.id ? null : debt.id)}>
              Rincian
            </Button>
            <Button className="h-9 px-3" onClick={() => void settle(debt)}><WalletCards className="h-4 w-4" /> Bayar</Button>
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
              <div className="overflow-x-auto">
                <table className="w-full min-w-[28rem] text-xs">
                  <thead className="border-b border-border text-left text-muted-foreground">
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
  </div>
}
