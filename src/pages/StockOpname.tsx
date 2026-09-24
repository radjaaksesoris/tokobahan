import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Card, CardContent } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { UNIT_LABELS } from '@/types'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight } from 'lucide-react'

type ProductRow = { id: string; name: string; stock: number; stock_unit: string }
const PAGE_SIZE = 50

export default function StockOpname() {
  const [products, setProducts] = useState<ProductRow[]>([])
  const [physical, setPhysical] = useState<Record<string, string>>({})
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [hasNextPage, setHasNextPage] = useState(false)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('products')
      .select('id, name, stock, stock_unit')
      .eq('is_active', true)
      .order('name')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
    if (error) toast.error(error.message)
    else {
      setProducts((data || []).slice(0, PAGE_SIZE) as ProductRow[])
      setHasNextPage((data || []).length > PAGE_SIZE)
    }
    setLoading(false)
  }
  useEffect(() => { void load() }, [page])

  async function save(product: ProductRow) {
    if (!navigator.onLine) {
      toast.error('Stok opname membutuhkan koneksi internet dan tidak dapat disimpan offline')
      return
    }
    const value = Number(physical[product.id])
    const reason = reasons[product.id]?.trim() || ''
    if (!Number.isFinite(value) || value < 0 || !reason) {
      toast.error('Stok fisik dan alasan wajib diisi')
      return
    }
    setSaving(product.id)
    const { error } = await supabase.rpc('adjust_stock', { p_product_id: product.id, p_physical_stock: value, p_reason: reason })
    if (error) toast.error(error.message)
    else {
      toast.success(`Stok ${product.name} disesuaikan`)
      setPhysical((current) => ({ ...current, [product.id]: '' }))
      setReasons((current) => ({ ...current, [product.id]: '' }))
      await load()
    }
    setSaving(null)
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-6">
      <header className="border-b border-border pb-5">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Inventori</p>
        <h1 className="mt-1 text-3xl font-bold text-ink">Stok Opname</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sesuaikan stok sistem berdasarkan hasil penghitungan fisik.</p>
      </header>
      {loading ? <p className="text-sm text-muted-foreground">Memuat produk...</p> : (
        <div className="grid gap-3">
          {products.map((product) => (
            <Card key={product.id}>
              <CardContent className="grid gap-3 p-4 lg:grid-cols-[1.4fr_0.7fr_1.4fr_auto] lg:items-end">
                <div>
                  <p className="font-semibold text-ink">{product.name}</p>
                  <p className="text-xs text-muted-foreground">Stok sistem: {product.stock} {UNIT_LABELS[product.stock_unit] || product.stock_unit}</p>
                </div>
                <Input type="number" min="0" value={physical[product.id] || ''} onChange={(event) => setPhysical((current) => ({ ...current, [product.id]: event.target.value }))} placeholder="Stok fisik" />
                <Input value={reasons[product.id] || ''} onChange={(event) => setReasons((current) => ({ ...current, [product.id]: event.target.value }))} placeholder="Alasan penyesuaian" />
                <Button onClick={() => void save(product)} disabled={saving === product.id}>{saving === product.id ? 'Menyimpan...' : 'Simpan'}</Button>
              </CardContent>
            </Card>
          ))}
          {products.length === 0 && <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">Belum ada produk aktif.</CardContent></Card>}
          {products.length > 0 && (
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
        </div>
      )}
    </div>
  )
}
