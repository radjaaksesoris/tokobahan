import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { endOfDay, format, startOfDay } from 'date-fns'
import { id as localeId } from 'date-fns/locale'
import { Calendar, ChevronLeft, ChevronRight, History, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { UNIT_LABELS, type UnitType } from '@/types'
import { formatCurrency, formatNumber } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { LoadingDots } from '@/components/ui/LoadingDots'
import { toast } from 'sonner'

const PAGE_SIZE = 20
type PageCursor = { received_at: string; id: string } | null

interface StockReceipt {
  id: string
  quantity_received: number
  unit_cost: number
  received_at: string
  vendor: { name: string } | null
  payment_status: 'kredit' | 'lunas'
  due_date: string | null
  product: { name: string; stock_unit: UnitType } | null
}

export default function StockHistory() {
  const navigate = useNavigate()
  const [history, setHistory] = useState<StockReceipt[]>([])
  const [date, setDate] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([])
  const [page, setPage] = useState(0)
  const [cursorHistory, setCursorHistory] = useState<PageCursor[]>([null])
  const [hasNextPage, setHasNextPage] = useState(false)
  const [loading, setLoading] = useState(true)
  const requestId = useRef(0)

  useEffect(() => {
    supabase.from('vendors').select('id, name').order('name').then(({ data, error }) => {
      if (error) toast.error(`Gagal memuat vendor: ${error.message}`)
      else setVendors(data || [])
    })
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      const currentRequest = ++requestId.current
      setLoading(true)
      let query = supabase
        .from('product_stock_batches')
        .select('id, quantity_received, unit_cost, received_at, payment_status, due_date, vendor:vendors(name), product:products(name, stock_unit)')
        .order('received_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(PAGE_SIZE + 1)

      const cursor = cursorHistory[page]
      if (cursor) {
        query = query.or(`received_at.lt.${cursor.received_at},and(received_at.eq.${cursor.received_at},id.lt.${cursor.id})`)
      }

      if (date) {
        const selectedDate = new Date(`${date}T00:00:00`)
        query = query
          .gte('received_at', startOfDay(selectedDate).toISOString())
          .lte('received_at', endOfDay(selectedDate).toISOString())
      }
      if (vendorId) query = query.eq('vendor_id', vendorId)

      const { data, error } = await query
      if (currentRequest !== requestId.current) return
      if (error) {
        toast.error(`Gagal memuat riwayat stok: ${error.message}`)
        setHistory([])
        setHasNextPage(false)
      } else {
        const rows = (data || []) as unknown as StockReceipt[]
        setHistory(rows.slice(0, PAGE_SIZE))
        setHasNextPage(rows.length > PAGE_SIZE)
      }
      setLoading(false)
    }, 200)

    return () => window.clearTimeout(timer)
  }, [date, page, vendorId])

  const summary = useMemo(
    () => history.reduce(
      (result, receipt) => ({
        quantity: result.quantity + Number(receipt.quantity_received),
        value: result.value + Number(receipt.quantity_received) * Number(receipt.unit_cost),
      }),
      { quantity: 0, value: 0 },
    ),
    [history],
  )

  return (
    <div className="mx-auto max-w-[1200px] space-y-6">
      <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-primary">Produk / Sub-menu</p>
          <h2 className="text-3xl font-bold tracking-tight text-ink">Riwayat input stok</h2>
          <p className="mt-1 text-sm text-muted-foreground">Rekap barang yang ditambahkan ke stok berdasarkan tanggal penerimaan.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate('/products')}>
            Produk
          </Button>
          <div className="relative h-10 w-36 shrink-0 rounded-xl border border-border bg-surface sm:w-44">
            <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <span className="pointer-events-none flex h-full items-center pl-9 pr-3 text-sm text-muted-foreground">
              {date ? format(new Date(`${date}T00:00:00`), 'dd MMM yyyy', { locale: localeId }) : 'Tanggal'}
            </span>
            <Input
              type="date"
              value={date}
              onChange={(event) => { setDate(event.target.value); setPage(0); setCursorHistory([null]) }}
              aria-label="Filter tanggal input stok"
              className="absolute inset-0 h-full w-full cursor-pointer border-0 bg-transparent p-0 opacity-0"
            />
          </div>
          <Select
            value={vendorId}
            onChange={(value) => { setVendorId(value); setPage(0); setCursorHistory([null]) }}
            options={[
              { value: '', label: 'Semua vendor' },
              ...vendors.map((vendor) => ({ value: vendor.id, label: vendor.name })),
            ]}
            className="w-36 sm:w-44"
            aria-label="Filter vendor"
          />
          {date && (
            <button type="button" onClick={() => { setDate(''); setPage(0); setCursorHistory([null]) }} className="flex h-10 w-10 items-center justify-center rounded-xl border border-border text-muted-foreground hover:bg-muted" aria-label="Hapus filter tanggal">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 text-primary" /> Riwayat Input Stok
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-hidden">
            <table className="w-full table-fixed text-[11px] sm:table-auto sm:text-sm">
                  <thead className="border-b border-primary/80 bg-primary text-center text-[11px] uppercase tracking-wide text-white">
                    <tr>
                      <th className="w-[7%] px-1 py-2 sm:w-12 sm:px-3">No.</th>
                      <th className="w-[19%] px-1 py-2 sm:w-auto sm:px-3">Tanggal</th>
                      <th className="w-[20%] px-1 py-2 sm:w-auto sm:px-3">Produk</th>
                      <th className="w-[17%] px-1 py-2 sm:w-auto sm:px-3">Vendor</th>
                      <th className="w-[16%] px-1 py-2 sm:w-auto sm:px-3">Jumlah</th>
                      <th className="w-[17%] px-1 py-2 sm:w-auto sm:px-3">HPP</th>
                      <th className="w-[15%] px-1 py-2 sm:w-auto sm:px-3">Status</th>
                      <th className="w-[15%] px-1 py-2 sm:w-auto sm:px-3">Nilai stok</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {loading ? (
                      <tr>
                        <td colSpan={8} className="h-24 text-center">
                          <LoadingDots className="text-primary" />
                        </td>
                      </tr>
                    ) : history.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="h-24 text-center text-sm text-muted-foreground">
                          Belum ada riwayat input stok pada tanggal tersebut.
                        </td>
                      </tr>
                    ) : history.map((receipt, index) => (
                      <tr key={receipt.id} className="odd:bg-surface even:bg-muted/50 hover:bg-primary/5">
                        <td className="px-1 py-2 text-center text-[11px] text-muted-foreground sm:px-3 sm:text-xs">{page * PAGE_SIZE + index + 1}</td>
                        <td className="whitespace-nowrap px-1 py-2 text-center text-[11px] text-muted-foreground sm:px-3 sm:text-xs">
                          <span className="sm:hidden">{format(new Date(receipt.received_at), 'dd MMM yy', { locale: localeId })}</span>
                          <span className="hidden sm:inline">{format(new Date(receipt.received_at), 'dd MMM yy', { locale: localeId })}</span>
                        </td>
                        <td className="truncate px-1 py-2 text-center font-medium text-ink/90 sm:px-3">{receipt.product?.name || 'Produk tidak ditemukan'}</td>
                        <td className="truncate px-1 py-2 text-center text-muted-foreground sm:px-3">{receipt.vendor?.name || '-'}</td>
                        <td className="whitespace-nowrap px-1 py-2 text-center text-muted-foreground sm:px-3">{formatNumber(Number(receipt.quantity_received))} {UNIT_LABELS[receipt.product?.stock_unit || 'satuan']}</td>
                        <td className="whitespace-nowrap px-1 py-2 text-center text-muted-foreground sm:px-3">{formatCurrency(Number(receipt.unit_cost))}</td>
                        <td className="px-1 py-2 text-center sm:px-3">
                          <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${receipt.payment_status === 'kredit' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                            {receipt.payment_status === 'kredit' ? `Kredit${receipt.due_date ? ` · ${format(new Date(`${receipt.due_date}T00:00:00`), 'dd/MM/yy')}` : ''}` : 'Lunas'}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-1 py-2 text-center font-semibold text-ink sm:px-3">{formatCurrency(Number(receipt.quantity_received) * Number(receipt.unit_cost))}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-border bg-muted/50"><tr><td colSpan={4} className="px-3 py-2 text-center text-xs font-semibold text-muted-foreground">Total halaman</td><td className="px-3 py-2 text-center text-xs font-semibold text-ink">{formatNumber(summary.quantity)}</td><td /><td /><td className="px-3 py-2 text-center text-xs font-semibold text-primary">{formatCurrency(summary.value)}</td></tr></tfoot>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <span className="text-xs text-muted-foreground">Halaman {page + 1}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { setCursorHistory((current) => current.slice(0, -1)); setPage((current) => Math.max(0, current - 1)) }} disabled={page === 0 || loading}><ChevronLeft className="h-4 w-4" /> Sebelumnya</Button>
              <Button variant="outline" size="sm" onClick={() => { const last = history[history.length - 1]; if (!last) return; setCursorHistory((current) => [...current.slice(0, page + 1), { received_at: last.received_at, id: last.id }]); setPage((current) => current + 1) }} disabled={!hasNextPage || loading}>Berikutnya <ChevronRight className="h-4 w-4" /></Button>
              </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
