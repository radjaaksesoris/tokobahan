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
type DebtPayment = { amount: number; paid_at: string }
type DebtItem = { name: string; quantity: number; unit: string; unitPrice: number; subtotal: number }
type Debt = {
  id: string
  name: string
  reference: string
  total: number
  paid: number
  due: string | null
  payments: DebtPayment[]
  items: DebtItem[]
}

export default function Settlements() {
  const [tab, setTab] = useState<Tab>('vendor')
  const [debts, setDebts] = useState<Debt[]>([])
  const [payment, setPayment] = useState<Record<string, string>>({})
  const [expandedDebtId, setExpandedDebtId] = useState<string | null>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    if (tab === 'vendor') {
      const { data, error } = await supabase.from('product_stock_batches')
        .select('id, quantity_received, unit_cost, due_date, vendor:vendors(name), product:products(name, stock_unit), vendor_debt_payments(amount, paid_at)')
        .eq('payment_status', 'kredit').order('due_date')
      if (error) toast.error(error.message)
      setDebts((data || []).map((row: any) => ({
        id: row.id, name: row.vendor?.name || 'Vendor', reference: 'Stok masuk',
        total: Number(row.quantity_received) * Number(row.unit_cost),
        paid: (row.vendor_debt_payments || []).reduce((sum: number, p: any) => sum + Number(p.amount), 0),
        due: row.due_date,
        payments: (row.vendor_debt_payments || []).map((p: any) => ({ amount: Number(p.amount), paid_at: p.paid_at })),
        items: [{
          name: row.product?.name || 'Produk tidak ditemukan',
          quantity: Number(row.quantity_received),
          unit: row.product?.stock_unit || 'satuan',
          unitPrice: Number(row.unit_cost),
          subtotal: Number(row.quantity_received) * Number(row.unit_cost),
        }],
      })))
    } else {
      const { data, error } = await supabase.from('sales')
        .select('id, invoice_no, total_amount, amount_paid, created_at, customer:customers(name), sale_items(product_name, quantity, unit, unit_price, line_total), customer_debt_payments(amount, paid_at)')
        .eq('payment_method', 'credit').order('created_at', { ascending: true })
      if (error) toast.error(error.message)
      setDebts((data || []).map((row: any) => ({
        id: row.id, name: row.customer?.name || 'Pelanggan', reference: row.invoice_no,
        total: Number(row.total_amount), paid: Number(row.amount_paid || 0) + (row.customer_debt_payments || []).reduce((sum: number, p: any) => sum + Number(p.amount), 0),
        due: null,
        payments: (row.customer_debt_payments || []).map((p: any) => ({ amount: Number(p.amount), paid_at: p.paid_at })),
        items: (row.sale_items || []).map((item: any) => ({
          name: item.product_name,
          quantity: Number(item.quantity),
          unit: item.unit,
          unitPrice: Number(item.unit_price),
          subtotal: Number(item.line_total),
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
    const amount = Number(payment[debt.id])
    const outstanding = debt.total - debt.paid
    if (!amount || amount <= 0 || amount > outstanding) { toast.error('Nominal pembayaran tidak valid'); return }
    const result = tab === 'vendor'
      ? await supabase.from('vendor_debt_payments').insert({ stock_batch_id: debt.id, amount })
      : await supabase.from('customer_debt_payments').insert({ sale_id: debt.id, amount })
    const { error } = result
    if (error) toast.error(error.message)
    else {
      if (tab === 'vendor' && amount >= outstanding - 0.009) {
        await supabase.from('product_stock_batches').update({ payment_status: 'lunas' }).eq('id', debt.id)
      }
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
      {openDebts.map((debt) => <Card key={debt.id}><CardContent className="space-y-3 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="font-semibold text-ink">{debt.name}</p><p className="text-xs text-muted-foreground">{debt.reference}{debt.due ? ` · jatuh tempo ${debt.due}` : ''}</p><p className="mt-1 text-sm">Sisa <strong className="text-primary">{formatCurrency(debt.total - debt.paid)}</strong></p></div>
          <div className="flex flex-wrap gap-2">
            <Input type="number" min="1" max={debt.total - debt.paid} value={payment[debt.id] || ''} onChange={(event) => setPayment((current) => ({ ...current, [debt.id]: event.target.value }))} placeholder="Nominal" className="w-32" />
            <Button variant="outline" onClick={() => setExpandedDebtId((current) => current === debt.id ? null : debt.id)}>
              Rincian
            </Button>
            <Button onClick={() => void settle(debt)}><WalletCards className="h-4 w-4" /> Bayar</Button>
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
                        <td className="py-1.5 pr-3 text-ink">{item.name}</td>
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
