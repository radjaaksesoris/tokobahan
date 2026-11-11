import { useEffect, useMemo, useState } from 'react'
import { readOperationalSnapshot, updateOperationalSnapshot } from '@/lib/offlineOperationalSnapshot'
import { readOperationalTable } from '@/lib/offlineOperationalRepository'
import { reconcileStockBatches, type StockBatch } from '@/lib/stockOpname'
import { Card, CardContent } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import type { Product } from '@/types'
import { UNIT_LABELS } from '@/types'
import { toTitleCase } from '@/lib/utils'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { useAuthStore } from '@/store/useAuthStore'
import {
  formatMixedStockQuantity,
  getCostConversion,
  getStockUnitCostForSale,
  roundStockQuantity,
} from '@/lib/productUnits'

type ProductRow = Pick<
  Product,
  'id' | 'name' | 'stock' | 'stock_unit' | 'stock_conversion' | 'prices' | 'stock_unit_mode'
> & { is_active?: boolean }
const PAGE_SIZE = 50

export default function StockOpname({ embedded = false }: { embedded?: boolean }) {
  const [allProducts, setAllProducts] = useState<ProductRow[]>([])
  const [physical, setPhysical] = useState<Record<string, string>>({})
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const userId = useAuthStore((state) => state.user?.id ?? null)
  const filteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase('id')
    return query
      ? allProducts.filter((product) => product.name.toLocaleLowerCase('id').includes(query))
      : allProducts
  }, [allProducts, searchQuery])
  const pageProducts = useMemo(
    () => filteredProducts.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [filteredProducts, page],
  )
  const hasNextPage = (page + 1) * PAGE_SIZE < filteredProducts.length

  async function load() {
    setLoading(true)
    let snapshot
    try {
      snapshot = await readOperationalSnapshot()
    } catch (error) {
      toast.error(`Gagal membaca snapshot produk lokal: ${error instanceof Error ? error.message : 'Kesalahan tidak diketahui'}`)
      setAllProducts([])
      setLoading(false)
      return
    }
    if (snapshot) {
      try {
        const localProducts = await readOperationalTable<ProductRow>('products', snapshot)
        const activeProducts = localProducts
          .filter((product) => product.is_active)
          .sort((a, b) => a.name.localeCompare(b.name, 'id') || a.id.localeCompare(b.id))
        setAllProducts(activeProducts)
      } catch (error) {
        toast.error(`Gagal memuat produk lokal: ${error instanceof Error ? error.message : 'Kesalahan tidak diketahui'}`)
        setAllProducts([])
      }
      setLoading(false)
      return
    }
    toast.error('Data lokal belum disiapkan. Buka Pengaturan untuk mengambil data awal.')
    setAllProducts([])
    setLoading(false)
  }
  useEffect(() => { void load() }, [])

  async function save(product: ProductRow) {
    const rawValue = physical[product.id]?.trim()
    const enteredValue = rawValue ? Number(rawValue) : Number.NaN
    if (
      product.stock_unit_mode === 'integer-base' &&
      Number.isFinite(enteredValue) &&
      !Number.isInteger(enteredValue)
    ) {
      toast.error(`Stok fisik ${product.name} harus berupa bilangan bulat ${UNIT_LABELS[product.stock_unit] || product.stock_unit}`)
      return
    }
    const value = product.stock_unit_mode === 'integer-base'
      ? enteredValue
      : roundStockQuantity(enteredValue)
    const reason = reasons[product.id]?.trim() || ''
    if (!Number.isFinite(value) || value < 0 || !reason) {
      toast.error('Stok fisik dan alasan wajib diisi')
      return
    }
    setSaving(product.id)
    let localSnapshot
    try {
      localSnapshot = await readOperationalSnapshot()
    } catch (error) {
      toast.error(`Gagal memeriksa snapshot lokal: ${error instanceof Error ? error.message : 'Kesalahan tidak diketahui'}`)
      setSaving(null)
      return
    }
    if (!localSnapshot) {
      toast.error('Data lokal belum disiapkan. Buka Pengaturan untuk mengambil data awal.')
      setSaving(null)
      return
    }
    if (localSnapshot) {
      try {
        const now = new Date().toISOString()
        await updateOperationalSnapshot((snapshot) => {
          const products = snapshot.tables.products
          const currentProduct = products.find((row) => row.id === product.id)
          if (!currentProduct || !currentProduct.is_active) {
            throw new Error('Produk tidak ditemukan atau sudah tidak aktif di snapshot lokal')
          }
          const systemStock = Number(currentProduct.stock)
          const cost = Number(currentProduct.cost_price)
          if (!Number.isFinite(systemStock) || !Number.isFinite(cost)) {
            throw new Error('Data stok atau HPP produk lokal tidak valid')
          }
          const batches = snapshot.tables.product_stock_batches as StockBatch[]
          const nextBatches = reconcileStockBatches(
            batches,
            product.id,
            value,
            getStockUnitCostForSale(
              currentProduct,
              getCostConversion(currentProduct),
              cost,
            ),
            now,
          )
          const adjustment = {
            id: crypto.randomUUID(),
            product_id: product.id,
            system_stock: systemStock,
            physical_stock: value,
            difference: value - systemStock,
            reason,
            adjusted_by: userId,
            created_at: now,
          }
          return {
            snapshot: {
              ...snapshot,
              tables: {
                ...snapshot.tables,
                products: products.map((row) =>
                  row.id === product.id ? { ...row, stock: value, updated_at: now } : row,
                ),
                product_stock_batches: nextBatches,
                stock_adjustments: [...snapshot.tables.stock_adjustments, adjustment],
              },
            },
            result: undefined,
          }
        })
        toast.success(`Stok ${product.name} disesuaikan`)
        setPhysical((current) => ({ ...current, [product.id]: '' }))
        setReasons((current) => ({ ...current, [product.id]: '' }))
        await load()
      } catch (error) {
        toast.error(`Gagal menyimpan opname lokal: ${error instanceof Error ? error.message : 'Kesalahan tidak diketahui'}`)
      }
      setSaving(null)
      return
    }
  }

  return (
    <div className={embedded ? 'w-full space-y-4' : 'mx-auto max-w-[1440px] space-y-6'}>
      {!embedded && (
        <header className="page-header sticky top-[-1rem] z-30 -mx-4 -mt-4 border-b border-ink/10 bg-ink px-4 py-4 text-white shadow-[0_3px_0_rgba(32,42,46,0.2)] sm:top-[-1.25rem] sm:-mx-5 sm:-mt-5 sm:px-5 lg:top-[-2rem] lg:-mx-8 lg:px-8 lg:py-5">
          <h1 className="text-3xl font-bold tracking-tight text-white">Stok Opname</h1>
          <p className="mt-1 text-sm text-accent">Sesuaikan stok sistem berdasarkan hasil penghitungan fisik.</p>
        </header>
      )}
      <div className="relative">
        <Search className={`pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${embedded ? 'text-muted-foreground' : 'text-white/85'}`} aria-hidden="true" />
        <Input
          type="search"
          value={searchQuery}
          onChange={(event) => {
            setSearchQuery(event.target.value)
            setPage(0)
          }}
          placeholder="Cari nama produk..."
          aria-label="Cari produk untuk stok opname"
          className={embedded
            ? 'border-border bg-surface pl-9 text-ink placeholder:text-muted-foreground'
            : 'border-ink bg-ink pl-9 text-white placeholder:text-white/70 focus:border-accent focus:ring-accent/30'}
        />
      </div>
      {loading ? <p className="text-sm text-muted-foreground">Memuat produk...</p> : (
        <div className="grid gap-3">
          {pageProducts.map((product) => (
            <Card key={product.id}>
              <CardContent className="grid gap-3 p-3 sm:p-4 lg:grid-cols-[minmax(12rem,1.2fr)_minmax(10rem,0.8fr)_minmax(12rem,1fr)_auto] lg:items-end">
                <div className="min-w-0 lg:pb-2">
                  <p className="font-semibold text-ink">{product.name}</p>
                  <p className="text-xs text-muted-foreground">Stok sistem: {formatMixedStockQuantity(product)}</p>
                </div>
                <Input type="number" min="0" step={product.stock_unit_mode === 'integer-base' ? 1 : 'any'} value={physical[product.id] || ''} onChange={(event) => setPhysical((current) => ({ ...current, [product.id]: event.target.value }))} placeholder={`Stok fisik (${UNIT_LABELS[product.stock_unit] || product.stock_unit})`} aria-label={`Stok fisik ${product.name}`} />
                <Input value={reasons[product.id] || ''} onChange={(event) => setReasons((current) => ({ ...current, [product.id]: toTitleCase(event.target.value) }))} placeholder="Alasan penyesuaian" aria-label={`Alasan penyesuaian ${product.name}`} />
                <Button onClick={() => void save(product)} disabled={saving === product.id}>{saving === product.id ? 'Menyimpan...' : 'Simpan'}</Button>
              </CardContent>
            </Card>
          ))}
          {pageProducts.length === 0 && <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">{searchQuery.trim() ? 'Produk tidak ditemukan.' : 'Belum ada produk aktif.'}</CardContent></Card>}
          {pageProducts.length > 0 && (
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
