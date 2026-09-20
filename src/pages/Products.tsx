import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Product, UnitType, ProductPrice } from '@/types'
import { UNIT_LABELS, UNIT_FACTORS } from '@/types'
import { formatCurrency, formatCurrencyInput, parseCurrencyInput, toTitleCase } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Plus, Pencil, Trash2, X, Package, Search, ChevronLeft, ChevronRight, Boxes } from 'lucide-react'
import { LoadingDots } from '@/components/ui/LoadingDots'
import { toast } from 'sonner'
import type { Json } from '@/types/database'
import { Select } from '@/components/ui/Select'

const ALL_UNITS: UnitType[] = ['satuan', 'lusin', 'kodi', 'gross', 'meter', 'pack']
const UNIT_OPTIONS = ALL_UNITS.map((unit) => ({ value: unit, label: UNIT_LABELS[unit] }))

function getBatchMargin(product: Product, price: ProductPrice, batchCost: number) {
  const costPerBaseUnit = batchCost / (product.cost_conversion || 1)
  const priceConversion = price.conversion || UNIT_FACTORS[price.unit] || 1
  const unitCost = costPerBaseUnit * priceConversion
  const margin = price.price - unitCost
  return {
    unitCost,
    margin,
    marginPercent: price.price > 0 ? (margin / price.price) * 100 : 0,
  }
}

export default function Products() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [editingPricesOnly, setEditingPricesOnly] = useState(false)
  const [returnToStockProduct, setReturnToStockProduct] = useState<Product | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null)
  const [deleteName, setDeleteName] = useState('')
  const [stockProduct, setStockProduct] = useState<Product | null>(null)
  const [stockQuantity, setStockQuantity] = useState('0')
  const [stockCost, setStockCost] = useState(0)
  const [stockSaving, setStockSaving] = useState(false)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [pageSize, setPageSize] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches ? 15 : 20
  ))
  const initialLoadComplete = useRef(false)

  // form
  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [skuEditing, setSkuEditing] = useState(false)
  const [costPrice, setCostPrice] = useState(0)
  const [costUnit, setCostUnit] = useState<UnitType>('satuan')
  const [stock, setStock] = useState(0)
  const [stockUnit, setStockUnit] = useState<UnitType>('satuan')
  const [minStock, setMinStock] = useState(10)
  const [unitBase, setUnitBase] = useState<'pcs' | 'meter'>('pcs')
  const [prices, setPrices] = useState<ProductPrice[]>([
    { unit: 'satuan', price: 0, conversion: 1 },
  ])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 639px)')
    const updatePageSize = (event: MediaQueryListEvent) => {
      setPageSize(event.matches ? 15 : 20)
      setPage(0)
    }
    mediaQuery.addEventListener('change', updatePageSize)
    return () => mediaQuery.removeEventListener('change', updatePageSize)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(load, 250)
    return () => window.clearTimeout(timer)
  }, [search, page, pageSize])

  async function load() {
    if (!initialLoadComplete.current) setLoading(true)
    let query = supabase
      .from('products')
      .select('id, name, sku, barcode, category_id, cost_price, cost_unit, cost_conversion, stock_unit, stock_conversion, stock, min_stock, unit_base, prices, image_url, is_active, created_at, updated_at')
      .eq('is_active', true)
      .order('name')
      .range(page * pageSize, (page + 1) * pageSize)
    const term = search.trim().replace(/[%_,]/g, ' ')
    if (term) query = query.or(`name.ilike.%${term}%,sku.ilike.%${term}%,barcode.ilike.%${term}%`)
    const { data, error } = await query
    if (error) {
      toast.error(error.message)
      setProducts([])
      setHasNextPage(false)
      initialLoadComplete.current = true
      setLoading(false)
      return
    }
    const rows = data || []
    setHasNextPage(rows.length > pageSize)
    setProducts(
      rows.slice(0, pageSize).map((p) => ({ ...p, prices: (p.prices as any) || [] })) as Product[]
    )
    initialLoadComplete.current = true
    setLoading(false)
  }

  function openCreate() {
    setEditing(null)
    setEditingPricesOnly(false)
    setReturnToStockProduct(null)
    setName('')
    setSku('')
    setSkuEditing(true)
    setCostPrice(0)
    setCostUnit('satuan')
    setStock(0)
    setStockUnit('satuan')
    setMinStock(10)
    setUnitBase('pcs')
    setPrices([{ unit: 'satuan', price: 0, conversion: 1 }])
    setModal(true)
  }

  function openEdit(p: Product, pricesOnly = false) {
    if (!pricesOnly) setReturnToStockProduct(null)
    setEditing(p)
    setEditingPricesOnly(pricesOnly)
    setName(p.name)
    setSku(p.sku || '')
    setSkuEditing(!p.sku)
    setCostPrice(p.cost_price)
    setCostUnit((p.cost_unit || 'satuan') as UnitType)
    const productPrices: ProductPrice[] = p.prices?.length
      ? p.prices
      : [{ unit: 'satuan', price: 0, conversion: 1 }]
    const savedStockUnit = (p.stock_unit || 'satuan') as UnitType
    setStock(p.stock)
    setStockUnit(savedStockUnit)
    setMinStock(p.min_stock)
    setUnitBase(p.unit_base as 'pcs' | 'meter')
    setPrices(productPrices)
    setModal(true)
  }

  function openStock(p: Product) {
    setStockProduct(p)
    setStockQuantity('0')
    setStockCost(p.cost_price)
  }

  async function handleStockReceipt() {
    if (!stockProduct) return
    const quantity = Number(stockQuantity)
    if (quantity <= 0 || stockCost < 0) {
      toast.error('Jumlah stok harus lebih besar dari 0 dan HPP tidak boleh negatif')
      return
    }
    setStockSaving(true)
    const { error } = await supabase.rpc('receive_stock_batch', {
      p_product_id: stockProduct.id,
      p_quantity: quantity,
      p_unit_cost: stockCost,
    })
    if (error) {
      toast.error(error.message)
    } else {
      toast.success(`Stok ${stockProduct.name} berhasil ditambahkan`)
      setStockProduct(null)
      load()
    }
    setStockSaving(false)
  }

  function addPriceRow() {
    const used = prices.map((p) => p.unit)
    const next = ALL_UNITS.find((u) => !used.includes(u))
    if (next) {
      setPrices([...prices, { unit: next, price: 0, conversion: UNIT_FACTORS[next] }])
    }
  }

  function updatePrice(idx: number, field: keyof ProductPrice, value: any) {
    setPrices((prev) =>
      prev.map((p, i) => {
        if (i !== idx) return p
        if (field === 'unit') {
          return { ...p, unit: value, conversion: UNIT_FACTORS[value as UnitType] || 1 }
        }
        return { ...p, [field]: value }
      })
    )
  }

  function removePrice(idx: number) {
    if (prices.length <= 1) return
    setPrices(prices.filter((_, i) => i !== idx))
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error('Nama produk wajib diisi')
      return
    }
    if (stock < 0 || minStock < 0 || costPrice < 0 || prices.some((price) => price.price < 0)) {
      toast.error('Stok, harga modal, harga jual, dan stok minimum tidak boleh negatif')
      return
    }
    setSaving(true)
    const payload = {
      name: name.trim(),
      sku: sku || null,
      cost_price: costPrice,
      cost_unit: costUnit,
      cost_conversion: UNIT_FACTORS[costUnit] || 1,
      stock,
      stock_unit: stockUnit,
      stock_conversion: 1,
      min_stock: minStock,
      unit_base: unitBase,
      prices: prices.map((price) => ({ ...price })) as Json,
      is_active: true,
    }

    if (editing) {
      const { error } = await supabase.from('products').update(payload).eq('id', editing.id)
      if (error) toast.error(error.message)
      else {
        toast.success('Produk diperbarui')
        setModal(false)
        if (editingPricesOnly && returnToStockProduct) {
          setStockProduct({
            ...returnToStockProduct,
            name: name.trim(),
            sku: sku || null,
            prices: prices.map((price) => ({ ...price })),
          })
          setStockQuantity('0')
          setReturnToStockProduct(null)
        }
        setEditing(null)
        setEditingPricesOnly(false)
        load()
      }
    } else {
      const { error } = await supabase.from('products').insert(payload)
      if (error) toast.error(error.message)
      else {
        toast.success('Produk ditambahkan')
        setModal(false)
        load()
      }
    }
    setSaving(false)
  }

  function requestDelete(product: Product) {
    setDeleteTarget(product)
    setDeleteName('')
  }

  async function handleDelete() {
    if (!deleteTarget) return
    if (deleteName.trim().toLowerCase() !== deleteTarget.name.trim().toLowerCase()) {
      toast.error('Nama produk tidak cocok')
      return
    }
    const { error } = await supabase
      .from('products')
      .update({ is_active: false })
      .eq('id', deleteTarget.id)
    if (error) toast.error(error.message)
    else {
      toast.success('Produk dinonaktifkan')
      setDeleteTarget(null)
      setDeleteName('')
      load()
    }
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-6">
      <div className="flex flex-col gap-4 border-b border-stone-300/80 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-primary">Katalog inventori</p>
          <h2 className="text-3xl font-bold tracking-tight text-ink">Produk</h2>
          <p className="mt-1 text-sm text-slate-500">Kelola katalog dan harga multi-satuan.</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <div className="relative sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9 pr-10"
              placeholder="Cari nama, SKU, atau barcode..."
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setPage(0)
              }}
            />
            {search && (
              <button
                type="button"
                aria-label="Reset pencarian"
                onClick={() => {
                  setSearch('')
                  setPage(0)
                }}
                className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-stone-200 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Button className="hidden sm:inline-flex" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Tambah
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <LoadingDots dotClassName="h-2 w-2" />
        </div>
      ) : products.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-slate-400">
            <Package className="mb-3 h-12 w-12" />
            <p>Belum ada produk</p>
            <Button className="mt-4" onClick={openCreate}>
              Tambah Produk Pertama
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl border border-stone-200 bg-surface shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-primary/80 bg-primary text-center text-[11px] uppercase tracking-wide text-white">
                <tr>
                  <th className="w-12 px-3 py-2 font-semibold">No.</th>
                  <th className="px-3 py-2 font-semibold">Produk</th>
                  <th className="px-3 py-2 font-semibold">Stok</th>
                  <th className="px-3 py-2 font-semibold">Modal</th>
                  <th className="px-3 py-2 font-semibold">Harga jual</th>
                  <th className="w-24 px-3 py-2 font-semibold">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {products.map((p, index) => (
                  <tr key={p.id} className="odd:bg-white even:bg-stone-50/70 hover:bg-teal-50/50">
                    <td className="px-3 py-2 text-center text-xs text-slate-500">{page * pageSize + index + 1}</td>
                    <td className="px-3 py-2 text-center">
                      <div className="flex items-center justify-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">
                          {p.name.charAt(0)}
                        </div>
                        <div className="min-w-0 text-center">
                          <p className="truncate font-medium text-slate-800">{p.name}</p>
                          {p.sku && <p className="truncate text-[11px] text-slate-400">SKU: {p.sku}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-center text-xs text-slate-600">
                      <span className={p.stock <= p.min_stock ? 'font-semibold text-amber-600' : ''}>
                        {Math.floor(p.stock / (p.stock_conversion || 1))}
                      </span>{' '}
                      {UNIT_LABELS[(p.stock_unit || 'satuan') as UnitType]}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-center text-xs text-slate-600">
                      {formatCurrency(p.cost_price)} <span className="text-slate-400">/ {UNIT_LABELS[(p.cost_unit || 'satuan') as UnitType]}</span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="flex flex-wrap justify-center gap-1">
                        {p.prices?.map((pr) => (
                          <span key={pr.unit} className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                            {UNIT_LABELS[pr.unit] || pr.unit}: {formatCurrency(pr.price)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="flex justify-center gap-0.5">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(p)} aria-label={`Edit ${p.name}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-primary" onClick={() => openStock(p)} aria-label={`Tambah stok ${p.name}`}>
                          <Boxes className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => requestDelete(p)} aria-label={`Nonaktifkan ${p.name}`}>
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(page > 0 || hasNextPage) && (
            <div className="flex items-center justify-between border-t border-stone-200 px-3 py-2.5">
              <Button variant="outline" disabled={page === 0} onClick={() => setPage((current) => current - 1)}>
                <ChevronLeft className="h-4 w-4" /> Sebelumnya
              </Button>
              <span className="text-xs text-slate-500">Halaman {page + 1}</span>
              <Button variant="outline" disabled={!hasNextPage} onClick={() => setPage((current) => current + 1)}>
                Berikutnya <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}

          {stockProduct && (
            <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
              <Card className="w-full max-w-md rounded-t-2xl sm:rounded-2xl">
                <CardHeader className="flex-row items-center justify-between border-b">
                  <div>
                    <CardTitle>Tambah Stok</CardTitle>
                    <p className="mt-1 text-sm text-slate-500">{stockProduct.name}</p>
                  </div>
                  <button onClick={() => setStockProduct(null)} aria-label="Tutup tambah stok">
                    <X className="h-5 w-5" />
                  </button>
                </CardHeader>
                <CardContent className="space-y-4 pt-4">
                  <div className="rounded-lg bg-stone-50 p-3 text-sm text-slate-600">
                    Stok saat ini: <strong>{stockProduct.stock} {UNIT_LABELS[(stockProduct.stock_unit || 'satuan') as UnitType]}</strong>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Jumlah stok masuk</label>
                    <Input
                      type="number"
                      min="0"
                      value={stockQuantity}
                      onFocus={() => {
                        if (stockQuantity === '0') setStockQuantity('')
                      }}
                      onChange={(event) => setStockQuantity(event.target.value)}
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">HPP batch baru</label>
                    <Input
                      inputMode="numeric"
                      value={formatCurrencyInput(stockCost)}
                      onChange={(event) => setStockCost(parseCurrencyInput(event.target.value))}
                    />
                    <p className="mt-1 text-xs text-slate-400">
                      HPP ini hanya berlaku untuk stok baru. Stok lama tetap dihitung dengan HPP batch sebelumnya.
                    </p>
                  </div>
                  <div className="rounded-lg border border-stone-200">
                    <div className="border-b border-stone-200 bg-stone-50 px-3 py-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                            Simulasi margin stok baru
                          </p>
                          <p className="mt-0.5 text-[11px] text-slate-400">
                            Harga jual aktif dibandingkan dengan HPP yang dimasukkan.
                          </p>
                        </div>
                        <button
                          type="button"
                          className="shrink-0 text-xs font-semibold text-primary hover:underline"
                          onClick={() => {
                            const product = stockProduct
                            setStockProduct(null)
                            setReturnToStockProduct(product)
                            openEdit(product, true)
                          }}
                        >
                          Ubah harga jual
                        </button>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[430px] text-xs">
                        <thead className="bg-primary text-center text-[10px] uppercase tracking-wide text-white">
                          <tr>
                            <th className="w-10 px-2 py-1.5 font-semibold">No.</th>
                            <th className="px-2 py-1.5 font-semibold">Satuan</th>
                            <th className="px-2 py-1.5 font-semibold">Harga jual</th>
                            <th className="px-2 py-1.5 font-semibold">HPP</th>
                            <th className="px-2 py-1.5 font-semibold">Margin</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-100">
                          {stockProduct.prices?.map((price, index) => {
                            const margin = getBatchMargin(stockProduct, price, stockCost)
                            const profitable = margin.margin > 0
                            return (
                              <tr key={price.unit} className="text-center">
                                <td className="px-2 py-1.5 text-slate-500">{index + 1}</td>
                                <td className="px-2 py-1.5 font-medium text-slate-700">{UNIT_LABELS[price.unit]}</td>
                                <td className="whitespace-nowrap px-2 py-1.5 text-slate-600">{formatCurrency(price.price)}</td>
                                <td className="whitespace-nowrap px-2 py-1.5 text-slate-500">{formatCurrency(margin.unitCost)}</td>
                                <td className={`whitespace-nowrap px-2 py-1.5 font-semibold ${profitable ? 'text-emerald-600' : 'text-red-600'}`}>
                                  {formatCurrency(margin.margin)} ({margin.marginPercent.toFixed(1)}%)
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    {stockProduct.prices?.some((price) => getBatchMargin(stockProduct, price, stockCost).margin <= 0) && (
                      <p className="border-t border-red-100 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                        Peringatan: ada harga jual yang tidak menghasilkan keuntungan pada HPP baru ini.
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button variant="outline" className="flex-1" onClick={() => setStockProduct(null)}>
                      Batal
                    </Button>
                    <Button className="flex-1" onClick={handleStockReceipt} disabled={stockSaving}>
                      {stockSaving ? <LoadingDots className="text-current" dotClassName="h-1.5 w-1.5" /> : 'Simpan Stok'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center p-0 sm:p-4">
          <Card className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-2xl sm:rounded-2xl">
            <CardHeader className="flex-row items-center justify-between border-b">
              <CardTitle>{editingPricesOnly ? 'Ubah Harga Jual' : editing ? 'Edit Produk' : 'Tambah Produk'}</CardTitle>
              <button onClick={() => setModal(false)}>
                <X className="h-5 w-5" />
              </button>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto space-y-4 pt-4">
              <div>
                <label className="mb-1 block text-sm font-medium">Nama Produk *</label>
                <Input
                  value={name}
                  onChange={(e) => setName(toTitleCase(e.target.value))}
                  placeholder="Jarum Jahit No.14"
                  readOnly={editingPricesOnly}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium">SKU</label>
                  <div className="flex gap-2">
                    <Input
                      value={sku}
                      onChange={(e) => setSku(e.target.value)}
                      readOnly={editingPricesOnly || (Boolean(editing?.sku) && !skuEditing)}
                      className={editingPricesOnly || (Boolean(editing?.sku) && !skuEditing) ? 'bg-stone-100 text-slate-500' : undefined}
                    />
                    {editing?.sku && (
                      <Button
                        type="button"
                        variant={skuEditing ? 'secondary' : 'outline'}
                        size="icon"
                        disabled={editingPricesOnly}
                        onClick={() => setSkuEditing((current) => !current)}
                        aria-label={skuEditing ? 'Kunci SKU' : 'Edit SKU'}
                        title={skuEditing ? 'Kunci SKU' : 'Edit SKU'}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}

                  </div>
                  {editing?.sku && !skuEditing && (
                    <p className="mt-1 text-[11px] text-slate-400">SKU dikunci saat mengubah stok atau harga.</p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Stok</label>
                  <div className="flex gap-2">
                    <Input
                      className="min-w-0"
                      type="number"
                      value={stock}
                      onChange={(e) => setStock(Number(e.target.value))}
                      readOnly={Boolean(editing)}
                      title={editing ? 'Gunakan Tambah Stok untuk menerima stok baru' : undefined}
                    />
                    <Select
                      className="w-32"
                      value={stockUnit}
                      options={UNIT_OPTIONS}
                      onChange={(value) => setStockUnit(value as UnitType)}
                      native
                      disabled={Boolean(editing)}
                      aria-label="Satuan stok"
                    />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium">Harga Modal</label>
                  <div className="flex gap-2">
                    <Input
                      className="min-w-0"
                      inputMode="numeric"
                      value={formatCurrencyInput(costPrice)}
                      onChange={(e) => setCostPrice(parseCurrencyInput(e.target.value))}
                      readOnly={Boolean(editing)}
                      title={editing ? 'Gunakan Tambah Stok untuk mengubah HPP batch baru' : undefined}
                    />
                    <Select
                      className="w-32"
                      value={costUnit}
                      options={UNIT_OPTIONS}
                      onChange={(value) => setCostUnit(value as UnitType)}
                      native
                      disabled={Boolean(editing)}
                      aria-label="Satuan harga modal"
                    />
                  </div>
                  {editing && (
                    <p className="mt-1 text-[11px] text-slate-400">
                      Stok dan HPP produk lama dikunci. Gunakan tombol Tambah Stok untuk membuat batch FIFO baru.
                    </p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Min. Stok</label>
                  <Input
                    type="number"
                    value={minStock}
                    onChange={(e) => setMinStock(Number(e.target.value))}
                    readOnly={editingPricesOnly}
                  />
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-sm font-medium">Harga Jual per Unit</label>
                  <Button variant="outline" size="sm" onClick={addPriceRow} disabled={editingPricesOnly}>
                    <Plus className="h-3 w-3" /> Tambah
                  </Button>
                </div>
                <div className="space-y-2">
                  {prices.map((pr, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Select
                        className="w-32 shrink-0"
                        value={pr.unit}
                        options={UNIT_OPTIONS}
                        onChange={(value) => updatePrice(idx, 'unit', value)}
                        native
                        disabled={editingPricesOnly}
                        aria-label={`Satuan harga jual ${idx + 1}`}
                      />
                      <Input
                        className="flex-1"
                        placeholder="Harga"
                        inputMode="numeric"
                        value={formatCurrencyInput(pr.price)}
                        onChange={(e) => updatePrice(idx, 'price', parseCurrencyInput(e.target.value))}
                      />
                      {prices.length > 1 && (
                        <button
                          onClick={() => removePrice(idx)}
                          className="text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={editingPricesOnly}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}

                      {deleteTarget && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                          <Card className="w-full max-w-md">
                            <CardHeader className="flex-row items-center justify-between border-b">
                              <CardTitle>Konfirmasi nonaktifkan produk</CardTitle>
                              <button onClick={() => setDeleteTarget(null)}>
                                <X className="h-5 w-5" />
                              </button>
                            </CardHeader>
                            <CardContent className="space-y-4 pt-4">
                              <p className="text-sm text-slate-600">
                                Produk akan disembunyikan dari kasir. Riwayat transaksi tetap tersimpan.
                              </p>
                              <p className="text-sm text-slate-600">
                                Ketik <strong>{deleteTarget.name}</strong> untuk melanjutkan.
                              </p>
                              <Input
                                value={deleteName}
                                onChange={(e) => setDeleteName(toTitleCase(e.target.value))}
                                placeholder="Nama produk"
                                autoFocus
                              />
                              <div className="flex gap-2">
                                <Button
                                  variant="outline"
                                  className="flex-1"
                                  onClick={() => setDeleteTarget(null)}
                                >
                                  Batal
                                </Button>
                                <Button
                                  variant="destructive"
                                  className="flex-1"
                                  disabled={deleteName.trim() !== deleteTarget.name}
                                  onClick={handleDelete}
                                >
                                  Nonaktifkan
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Kolom ketiga = jumlah unit dasar (pcs/meter) per satuan jual
                </p>
              </div>
            </CardContent>
            <div className="flex gap-2 border-t p-4">
              <Button variant="outline" className="flex-1" onClick={() => setModal(false)}>
                Batal
              </Button>
              <Button className="flex-1" onClick={handleSave} disabled={saving}>
                {saving ? <LoadingDots className="text-current" dotClassName="h-1.5 w-1.5" /> : 'Simpan'}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
