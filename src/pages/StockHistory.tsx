import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { endOfDay, format, startOfDay } from 'date-fns'
import { id as localeId } from 'date-fns/locale'
import { Calendar, ChevronLeft, ChevronRight, History, X } from 'lucide-react'
import { readOperationalSnapshot } from '@/lib/offlineOperationalSnapshot'
import { readOperationalTable } from '@/lib/offlineOperationalRepository'
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
    let cancelled = false
    async function loadVendors() {
      try {
        const snapshot = await readOperationalSnapshot()
        if (!snapshot) {
          if (!cancelled) {
            setVendors([])
            toast.error('Data lokal belum disiapkan. Buka Pengaturan untuk mengambil data awal.')
          }
          return
        }
        const localVendors = await readOperationalTable<{ id: string; name: string }>('vendors')
        if (cancelled) return
        setVendors(localVendors.sort((a, b) => a.name.localeCompare(b.name, 'id')))
      } catch (error) {
        if (!cancelled) toast.error(`Gagal memuat vendor: ${error instanceof Error ? error.message : 'Kesalahan tidak diketahui'}`)
      }
    }
    void loadVendors()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      const currentRequest = ++requestId.current
      setLoading(true)
      let snapshot
      try {
        snapshot = await readOperationalSnapshot()
      } catch (error) {
        if (currentRequest !== requestId.current) return
        toast.error(`Gagal membaca snapshot stok lokal: ${error instanceof Error ? error.message : 'Kesalahan tidak diketahui'}`)
        setHistory([])
        setHasNextPage(false)
        setLoading(false)
        return
      }

      if (!snapshot) {
        if (currentRequest !== requestId.current) return
        toast.error('Data lokal belum disiapkan. Buka Pengaturan untuk mengambil data awal.')
        setHistory([])
        setHasNextPage(false)
        setLoading(false)
        return
      }
      {
        try {
          const [batches, vendors, products] = await Promise.all([
            readOperationalTable<Record<string, unknown>>('product_stock_batches'),
            readOperationalTable<{ id: string; name: string }>('vendors'),
            readOperationalTable<{ id: string; name: string; stock_unit: UnitType }>('products'),
          ])
          if (currentRequest !== requestId.current) return
          const vendorMap = new Map(vendors.map((vendor) => [vendor.id, vendor]))
          const productMap = new Map(products.map((product) => [product.id, product]))
          const selectedDate = date ? new Date(`${date}T00:00:00`) : null
          const cursor = cursorHistory[page]
          const rows = batches
            .map((batch) => {
              const product = productMap.get(String(batch.product_id))
              const vendor = vendorMap.get(String(batch.vendor_id))
              return {
                ...batch,
                id: String(batch.id),
                quantity_received: Number(batch.quantity_received),
                unit_cost: Number(batch.unit_cost),
                received_at: String(batch.received_at),
                payment_status: batch.payment_status as 'kredit' | 'lunas',
                due_date: batch.due_date ? String(batch.due_date) : null,
                vendor: vendor ? { name: vendor.name } : null,
                product: product ? { name: product.name, stock_unit: product.stock_unit } : null,
              } as StockReceipt & { vendor_id?: string | null }
            })
            .filter((receipt) => !selectedDate || (
              new Date(receipt.received_at) >= startOfDay(selectedDate) &&
              new Date(receipt.received_at) <= endOfDay(selectedDate)
            ))
            .filter((receipt) => !vendorId || (receipt as StockReceipt & { vendor_id?: string }).vendor_id === vendorId)
            .sort((a, b) =>
              b.received_at.localeCompare(a.received_at) || b.id.localeCompare(a.id),
            )
            .filter((receipt) => !cursor ||
              receipt.received_at < cursor.received_at ||
              (receipt.received_at === cursor.received_at && receipt.id < cursor.id),
            )
            .slice(0, PAGE_SIZE + 1)
          setHistory(rows.slice(0, PAGE_SIZE))
          setHasNextPage(rows.length > PAGE_SIZE)
        } catch (error) {
          if (currentRequest !== requestId.current) return
          toast.error(`Gagal memuat riwayat stok lokal: ${error instanceof Error ? error.message : 'Kesalahan tidak diketahui'}`)
          setHistory([])
          setHasNextPage(false)
        }
        setLoading(false)
        return
      }

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
    <div className="mx-auto max-w-[1440px] space-y-6">
      <div className="page-header sticky top-[-1rem] z-30 -mx-4 -mt-4 flex flex-col gap-4 bg-ink px-4 py-4 text-white shadow-[0_3px_0_rgba(32,42,46,0.2)] sm:top-[-1.25rem] sm:-mx-5 sm:-mt-5 sm:flex-row sm:items-end sm:justify-between sm:px-5 lg:top-[-2rem] lg:-mx-8 lg:-mt-8 lg:px-8 lg:py-5">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Riwayat input stok</h1>
          <p className="mt-1 text-sm text-accent">Rekap barang yang ditambahkan ke stok berdasarkan tanggal penerimaan.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="border-white/25 bg-white text-ink hover:border-accent hover:bg-accent hover:text-ink focus-visible:bg-accent focus-visible:text-ink focus-visible:ring-accent focus-visible:ring-offset-ink"
            onClick={() => navigate('/products')}
          >
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
          <div className="overflow-x-auto">
            <table className="min-w-[720px] w-full table-auto text-[11px] sm:text-sm">
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
