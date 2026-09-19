import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Product, UnitType, ProductPrice } from '@/types'
import { UNIT_LABELS, UNIT_FACTORS } from '@/types'
import { formatCurrency } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Plus, Pencil, Trash2, Loader2, X, Package } from 'lucide-react'
import { toast } from 'sonner'
import type { Json } from '@/types/database'
import { Select } from '@/components/ui/Select'

const ALL_UNITS: UnitType[] = ['satuan', 'lusin', 'kodi', 'gross', 'meter', 'pack']
const UNIT_OPTIONS = ALL_UNITS.map((unit) => ({ value: unit, label: UNIT_LABELS[unit] }))

export default function Products() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null)
  const [deleteName, setDeleteName] = useState('')
  const [saving, setSaving] = useState(false)

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
    load()
  }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('products')
      .select('*')
      .eq('is_active', true)
      .order('name')
      .limit(500)
    setProducts(
      (data || []).map((p) => ({ ...p, prices: (p.prices as any) || [] })) as Product[]
    )
    setLoading(false)
  }

  function openCreate() {
    setEditing(null)
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

  function openEdit(p: Product) {
    setEditing(p)
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
    if (deleteName.trim() !== deleteTarget.name) {
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
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Tambah
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
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
        <div className="space-y-2">
          {products.map((p) => (
            <Card key={p.id}>
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-lg font-bold text-primary">
                  {p.name.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{p.name}</p>
                  <p className="text-xs text-slate-500">
                    Stok: {Math.floor(p.stock / (p.stock_conversion || 1))} {UNIT_LABELS[(p.stock_unit || 'satuan') as UnitType]} · Modal: {formatCurrency(p.cost_price)} / {UNIT_LABELS[(p.cost_unit || 'satuan') as UnitType]}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {p.prices?.map((pr) => (
                      <span
                        key={pr.unit}
                        className="rounded-md bg-stone-100 px-1.5 py-0.5 text-[10px] text-slate-600"
                      >
                        {UNIT_LABELS[pr.unit] || pr.unit}: {formatCurrency(pr.price)}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(p)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => requestDelete(p)}>
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center p-0 sm:p-4">
          <Card className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-2xl sm:rounded-2xl">
            <CardHeader className="flex-row items-center justify-between border-b">
              <CardTitle>{editing ? 'Edit Produk' : 'Tambah Produk'}</CardTitle>
              <button onClick={() => setModal(false)}>
                <X className="h-5 w-5" />
              </button>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto space-y-4 pt-4">
              <div>
                <label className="mb-1 block text-sm font-medium">Nama Produk *</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jarum Jahit No.14" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium">SKU</label>
                  <div className="flex gap-2">
                    <Input
                      value={sku}
                      onChange={(e) => setSku(e.target.value)}
                      readOnly={Boolean(editing?.sku) && !skuEditing}
                      className={Boolean(editing?.sku) && !skuEditing ? 'bg-stone-100 text-slate-500' : undefined}
                    />
                    {editing?.sku && (
                      <Button
                        type="button"
                        variant={skuEditing ? 'secondary' : 'outline'}
                        size="icon"
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
                      type="number"
                      value={stock}
                      onChange={(e) => setStock(Number(e.target.value))}
                    />
                    <Select
                      className="w-32"
                      value={stockUnit}
                      options={UNIT_OPTIONS}
                      onChange={(value) => setStockUnit(value as UnitType)}
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
                      type="number"
                      value={costPrice}
                      onChange={(e) => setCostPrice(Number(e.target.value))}
                    />
                    <Select
                      className="w-32"
                      value={costUnit}
                      options={UNIT_OPTIONS}
                      onChange={(value) => setCostUnit(value as UnitType)}
                      aria-label="Satuan harga modal"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Min. Stok</label>
                  <Input
                    type="number"
                    value={minStock}
                    onChange={(e) => setMinStock(Number(e.target.value))}
                  />
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-sm font-medium">Harga Jual per Unit</label>
                  <Button variant="outline" size="sm" onClick={addPriceRow}>
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
                        aria-label={`Satuan harga jual ${idx + 1}`}
                      />
                      <Input
                        type="number"
                        className="flex-1"
                        placeholder="Harga"
                        value={pr.price || ''}
                        onChange={(e) => updatePrice(idx, 'price', Number(e.target.value))}
                      />
                      {prices.length > 1 && (
                        <button onClick={() => removePrice(idx)} className="text-red-400">
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
                                onChange={(e) => setDeleteName(e.target.value)}
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
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Simpan'}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
