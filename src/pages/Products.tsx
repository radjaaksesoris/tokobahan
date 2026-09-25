import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Product, UnitType, ProductPrice } from '@/types'
import { parseProductPrices, isUnitType, UNIT_LABELS, UNIT_FACTORS } from '@/types'
import { formatCurrency, formatCurrencyInput, parseCurrencyInput, toTitleCase } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Plus, Pencil, Trash2, X, Package, Search, ChevronLeft, ChevronRight, Boxes, History } from 'lucide-react'
import { LoadingDots } from '@/components/ui/LoadingDots'
import { toast } from 'sonner'
import type { Json } from '@/types/database'
import { Select } from '@/components/ui/Select'

const ALL_UNITS: UnitType[] = ['satuan', 'lusin', 'kodi', 'gross', 'meter', 'pack']
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
  const navigate = useNavigate()
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
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([])
  const [customUnits, setCustomUnits] = useState<UnitType[]>([])
  const [stockVendorId, setStockVendorId] = useState('')
  const [stockPaymentStatus, setStockPaymentStatus] = useState<'lunas' | 'kredit'>('lunas')
  const [stockDueDate, setStockDueDate] = useState('')
  const [stockSaving, setStockSaving] = useState(false)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [pageSize, setPageSize] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches ? 15 : 20
  ))
  const initialLoadComplete = useRef(false)
  const loadRequestId = useRef(0)
  const stockUnitSelectRef = useRef<HTMLButtonElement>(null)
  const saveButtonRef = useRef<HTMLButtonElement>(null)

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

  const allUnits = [...ALL_UNITS, ...customUnits.filter((unit) => !ALL_UNITS.includes(unit))]
  const unitOptions = allUnits.map((unit) => ({
    value: unit,
    label: UNIT_LABELS[unit] || unit,
  }))
  const unitFactors = UNIT_FACTORS

  useEffect(() => {
    supabase.from('vendors').select('id, name').order('name').then(({ data, error }) => {
      if (error) toast.error(`Gagal memuat vendor: ${error.message}`)
      else setVendors(data || [])
    })
    supabase.from('custom_units').select('name').order('name').then(({ data, error }) => {
      if (error) toast.error(`Gagal memuat satuan: ${error.message}`)
      else setCustomUnits((data || []).map((unit) => unit.name))
    })
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(load, 250)
    return () => window.clearTimeout(timer)
  }, [search, page, pageSize])

  async function load() {
    const requestId = ++loadRequestId.current
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
    if (requestId !== loadRequestId.current) return
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
      rows.slice(0, pageSize).map((p) => ({
        ...p,
        prices: parseProductPrices(p.prices),
      })) as Product[]
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
    setStockVendorId('')
    setStockPaymentStatus('lunas')
    setStockDueDate('')
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
    const savedStockUnit = (p.stock_unit || 'satuan') as UnitType
    setCostUnit((p.cost_unit || savedStockUnit) as UnitType)
    const productPrices: ProductPrice[] = p.prices?.length
      ? p.prices.map((price, index) => (
        index === 0
          ? { ...price, unit: savedStockUnit, conversion: unitFactors[savedStockUnit] || 1 }
          : price
      ))
      : [{ unit: savedStockUnit, price: 0, conversion: unitFactors[savedStockUnit] || 1 }]
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
    setStockVendorId('')
    setStockPaymentStatus('lunas')
    setStockDueDate('')
  }

  async function handleStockReceipt() {
    if (!stockProduct) return
    const quantity = Number(stockQuantity)
    if (quantity <= 0 || stockCost < 0) {
      toast.error('Jumlah stok harus lebih besar dari 0 dan HPP tidak boleh negatif')
      return
    }
    setStockSaving(true)
    if (!stockVendorId) {
      toast.error('Pilih vendor terlebih dahulu')
      return
    }
    if (stockPaymentStatus === 'kredit' && !stockDueDate) {
      toast.error('Tanggal jatuh tempo wajib diisi untuk status kredit')
      return
    }
    const { error } = await supabase.rpc('receive_stock_batch', {
      p_product_id: stockProduct.id,
      p_quantity: quantity,
      p_unit_cost: stockCost,
      p_vendor_id: stockVendorId,
      p_payment_status: stockPaymentStatus,
      p_due_date: stockPaymentStatus === 'kredit' ? stockDueDate : null,
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
    const next = allUnits.find((u) => !used.includes(u))
    if (next) {
      setPrices([...prices, { unit: next, price: 0, conversion: unitFactors[next] || 1 }])
    }
  }

  function updatePrice(idx: number, field: keyof ProductPrice, value: string | number) {
    setPrices((prev) =>
      prev.map((p, i) => {
        if (i !== idx) return p
        if (field === 'unit') {
          if (typeof value !== 'string' || !isUnitType(value)) return p
          return { ...p, unit: value, conversion: unitFactors[value] || 1 }
        }
        if (typeof value !== 'number') return p
        return { ...p, [field]: value }
      })
    )
  }

  function removePrice(idx: number) {
    if (prices.length <= 1) return
    setPrices(prices.filter((_, i) => i !== idx))
  }

  function handleStockUnitChange(value: string) {
    if (!isUnitType(value)) return
    const nextUnit = value as UnitType
    setStockUnit(nextUnit)
    setCostUnit(nextUnit)
    setPrices((current) => current.map((price, index) => (
      index === 0
        ? { ...price, unit: nextUnit, conversion: unitFactors[nextUnit] || 1 }
        : price
    )))
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error('Nama produk wajib diisi')
      return
    }
    if (!sku.trim()) {
      toast.error('SKU wajib diisi')
      return
    }
    if (costPrice <= 0) {
      toast.error('Harga modal wajib diisi')
      return
    }
    if (prices.some((price) => price.price <= 0)) {
      toast.error('Semua harga jual wajib diisi')
      return
    }
    if (!editing && !stockVendorId) {
      toast.error('Nama vendor wajib dipilih')
      return
    }
    if (stock < 0 || minStock < 0 || costPrice < 0 || prices.some((price) => price.price < 0)) {
      toast.error('Stok, harga modal, harga jual, dan stok minimum tidak boleh negatif')
      return
    }
    if (!editing && stock > 0 && !stockVendorId) {
      toast.error('Pilih vendor untuk stok awal produk')
      return
    }
    if (!editing && stock > 0 && stockPaymentStatus === 'kredit' && !stockDueDate) {
      toast.error('Tanggal jatuh tempo wajib diisi untuk stok awal kredit')
      return
    }
    setSaving(true)
    const payload = {
      name: name.trim(),
      sku: sku || null,
      cost_price: costPrice,
      cost_unit: costUnit,
      cost_conversion: unitFactors[costUnit] || 1,
      stock: editing ? stock : 0,
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
      const { data: createdProduct, error } = await supabase.from('products').insert(payload).select('id').single()
      if (error) toast.error(error.message)
      else {
        if (stock > 0) {
          const { error: receiptError } = await supabase.rpc('receive_stock_batch', {
            p_product_id: createdProduct.id,
            p_quantity: stock,
            p_unit_cost: costPrice,
            p_vendor_id: stockVendorId,
            p_payment_status: stockPaymentStatus,
            p_due_date: stockPaymentStatus === 'kredit' ? stockDueDate : null,
          })
          if (receiptError) {
            toast.error(`Produk dibuat, tetapi stok awal gagal disimpan: ${receiptError.message}`)
            setModal(false)
            load()
            setSaving(false)
            return
          }
        }
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
      <div className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-ink">Produk</h2>
          <p className="mt-1 text-sm text-muted-foreground">Kelola katalog dan harga multi-satuan.</p>
        </div>
        <div className="relative z-10 flex w-full flex-col gap-3 lg:w-auto lg:flex-row lg:items-center">
          <div className="flex w-full min-w-0 items-center gap-2 lg:w-auto">
            <Button variant="outline" className="shrink-0 px-3" onClick={() => navigate('/products/history')}>
              <History className="h-4 w-4" />
              Riwayat Input
            </Button>
            <div className="relative min-w-0 flex-1 lg:w-72 lg:flex-none">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
                  className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-ink"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
          <Button className="relative z-10 w-full shrink-0 justify-center lg:w-auto" onClick={openCreate}>
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
          <CardContent className="flex flex-col items-center py-16 text-muted-foreground">
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
            <table className="w-full table-fixed text-xs lg:min-w-[720px] lg:table-auto lg:text-sm">
              <thead className="border-b border-primary/80 bg-primary text-center text-[11px] uppercase tracking-wide text-white">
                <tr>
                  <th className="w-[7%] px-0.5 py-2 font-semibold lg:w-12 lg:px-3">No.</th>
                  <th className="w-[27%] px-0.5 py-2 font-semibold lg:w-auto lg:px-3">Produk</th>
                  <th className="w-[14%] px-0.5 py-2 font-semibold lg:w-auto lg:px-3">Stok</th>
                  <th className="w-[18%] px-0.5 py-2 font-semibold lg:w-auto lg:px-3">Modal</th>
                  <th className="w-[20%] px-0.5 py-2 font-semibold lg:w-auto lg:px-3">Harga jual</th>
                  <th className="w-[14%] whitespace-nowrap px-0.5 py-2 font-semibold lg:w-28 lg:px-3">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {products.map((p, index) => (
                  <tr key={p.id} className="odd:bg-surface even:bg-muted/50 hover:bg-primary/5">
                    <td className="px-0.5 py-2 text-center text-[11px] text-muted-foreground lg:px-3 lg:text-xs">{page * pageSize + index + 1}</td>
                    <td className="min-w-0 px-0.5 py-2 text-center lg:px-3">
                      <div className="flex min-w-0 items-center justify-center">
                        <div className="min-w-0 text-center">
                          <p className="truncate font-medium text-ink/90">{p.name}</p>
                          {p.sku && <p className="truncate text-[11px] text-muted-foreground">SKU: {p.sku}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-0.5 py-2 text-center text-[11px] text-muted-foreground lg:px-3 lg:text-xs">
                      <span className={p.stock <= p.min_stock ? 'font-semibold text-amber-600' : ''}>
                        {Math.floor(p.stock / (p.stock_conversion || 1))}
                      </span>{' '}
                      {UNIT_LABELS[(p.stock_unit || 'satuan') as UnitType]}
                    </td>
                    <td className="whitespace-nowrap px-0.5 py-2 text-center text-[11px] text-muted-foreground lg:px-3 lg:text-xs">
                      {formatCurrency(p.cost_price)} <span className="hidden text-muted-foreground lg:inline">/ {UNIT_LABELS[(p.cost_unit || 'satuan') as UnitType]}</span>
                    </td>
                    <td className="min-w-0 px-0.5 py-2 text-center lg:px-3">
                      <div className="flex flex-wrap justify-center gap-1">
                        {p.prices?.map((pr) => (
                          <span key={pr.unit} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            <span className="hidden lg:inline">{UNIT_LABELS[pr.unit] || pr.unit}: </span>{formatCurrency(pr.price)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-0.5 py-2 text-center lg:px-3">
                      <div className="flex justify-center gap-0 lg:gap-0.5">
                        <Button variant="ghost" size="icon" className="h-6 w-6 lg:h-7 lg:w-7" onClick={() => openEdit(p)} aria-label={`Edit ${p.name}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-primary lg:h-7 lg:w-7" onClick={() => openStock(p)} aria-label={`Tambah stok ${p.name}`}>
                          <Boxes className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 lg:h-7 lg:w-7" onClick={() => requestDelete(p)} aria-label={`Nonaktifkan ${p.name}`}>
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
              <span className="text-xs text-muted-foreground">Halaman {page + 1}</span>
              <Button variant="outline" disabled={!hasNextPage} onClick={() => setPage((current) => current + 1)}>
                Berikutnya <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}

          {stockProduct && (
            <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 p-0 sm:items-center sm:p-4">
              <Card className="flex max-h-[calc(100dvh-1rem)] w-full max-w-md flex-col rounded-t-2xl sm:max-h-[90vh] sm:rounded-2xl">
                <CardHeader className="flex-row items-center justify-between border-b">
                  <div>
                    <CardTitle>Tambah Stok</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">{stockProduct.name}</p>
                  </div>
                  <button onClick={() => setStockProduct(null)} aria-label="Tutup tambah stok">
                    <X className="h-5 w-5" />
                  </button>
                </CardHeader>
                <CardContent className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-[env(safe-area-inset-bottom)] pt-4">
                  <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
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
                    <p className="mt-1 text-xs text-muted-foreground">
                      HPP ini hanya berlaku untuk stok baru. Stok lama tetap dihitung dengan HPP batch sebelumnya.
                    </p>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Vendor</label>
                    <Select
                      value={stockVendorId}
                      onChange={setStockVendorId}
                      options={[
                        { value: '', label: 'Pilih vendor' },
                        ...vendors.map((vendor) => ({ value: vendor.id, label: vendor.name })),
                      ]}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Status pembayaran</label>
                    <Select
                      value={stockPaymentStatus}
                      onChange={(value) => setStockPaymentStatus(value as 'lunas' | 'kredit')}
                      options={[
                        { value: 'lunas', label: 'Lunas' },
                        { value: 'kredit', label: 'Kredit' },
                      ]}
                    />
                  </div>
                  {stockPaymentStatus === 'kredit' && (
                    <div>
                      <label className="mb-1 block text-sm font-medium">Tanggal jatuh tempo</label>
                      <Input type="date" value={stockDueDate} onChange={(event) => setStockDueDate(event.target.value)} />
                    </div>
                  )}
                  <div className="rounded-lg border border-stone-200">
                    <div className="border-b border-stone-200 bg-muted/50 px-3 py-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Simulasi margin stok baru
                          </p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
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
                                <td className="px-2 py-1.5 text-muted-foreground">{index + 1}</td>
                                <td className="px-2 py-1.5 font-medium text-ink/85">{UNIT_LABELS[price.unit]}</td>
                                <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">{formatCurrency(price.price)}</td>
                                <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">{formatCurrency(margin.unitCost)}</td>
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
        <div className="fixed inset-0 z-50 bg-black/40">
          <button
            type="button"
            aria-label="Tutup panel produk"
            className="absolute inset-0 cursor-default"
            onClick={() => setModal(false)}
          />
          <Card className="product-drawer absolute inset-y-0 right-0 flex w-full max-w-xl flex-col rounded-none border-y-0 border-r-0 shadow-[-12px_0_32px_rgba(32,42,46,0.18)] sm:w-[min(92vw,640px)]">
            <CardHeader className="relative z-10 flex-row items-center justify-between border-b bg-surface px-5 py-4">
              <CardTitle>{editingPricesOnly ? 'Ubah Harga Jual' : editing ? 'Edit Produk' : 'Tambah Produk'}</CardTitle>
              <button type="button" onClick={() => setModal(false)} aria-label="Tutup panel produk" className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-ink">
                <X className="h-5 w-5" />
              </button>
            </CardHeader>
            <CardContent className="min-h-0 min-w-0 flex-1 space-y-4 overflow-x-hidden overflow-y-auto px-5 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-5">
              <div>
                <label className="mb-1 block text-sm font-medium">Nama Produk *</label>
                <Input
                  value={name}
                  onChange={(e) => setName(toTitleCase(e.target.value))}
                  placeholder="Nama item"
                  readOnly={editingPricesOnly}
                />
              </div>
              <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="min-w-0">
                  <label className="mb-1 block text-sm font-medium">SKU</label>
                  <div className="flex min-w-0 gap-2">
                    <Input
                      value={sku}
                      onChange={(e) => setSku(e.target.value)}
                      readOnly={editingPricesOnly || (Boolean(editing?.sku) && !skuEditing)}
                      className={`min-w-0 w-full ${editingPricesOnly || (Boolean(editing?.sku) && !skuEditing) ? 'bg-muted text-muted-foreground' : ''}`}
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
                    <p className="mt-1 text-[11px] text-muted-foreground">SKU dikunci saat mengubah stok atau harga.</p>
                  )}
                </div>
                <div className="min-w-0">
                  <label className="mb-1 block text-sm font-medium">Stok</label>
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,6.5rem)] gap-2">
                    <Input
                      className="min-w-0 w-full"
                      type="number"
                      value={stock}
                      onChange={(e) => setStock(Number(e.target.value))}
                      onKeyDown={(event) => {
                        if (event.key === 'Tab' && !event.shiftKey && !editing) {
                          event.preventDefault()
                          stockUnitSelectRef.current?.focus()
                        }
                      }}
                      readOnly={Boolean(editing)}
                      title={editing ? 'Gunakan Tambah Stok untuk menerima stok baru' : undefined}
                    />
                    <Select
                      className="min-w-0 w-full"
                      value={stockUnit}
                      options={unitOptions}
                      onChange={handleStockUnitChange}
                      focusRef={stockUnitSelectRef}
                      disabled={Boolean(editing)}
                      aria-label="Satuan stok"
                    />
                  </div>
                </div>
              </div>
              {!editing && (
                <div className="grid grid-cols-1 gap-4 rounded-xl border border-primary/15 bg-primary/5 p-3 sm:grid-cols-2">
                  <div className="min-w-0">
                    <label className="mb-1 block text-sm font-medium">Nama Vendor</label>
                    <Select
                      value={stockVendorId}
                      onChange={setStockVendorId}
                      className="w-full"
                      options={[
                        { value: '', label: 'Vendor' },
                        ...vendors.map((vendor) => ({ value: vendor.id, label: vendor.name })),
                      ]}
                    />
                  </div>
                  <div className="min-w-0">
                    <label className="mb-1 block text-sm font-medium">Status pembayaran awal</label>
                    <Select
                      value={stockPaymentStatus}
                      onChange={(value) => setStockPaymentStatus(value as 'lunas' | 'kredit')}
                      className="w-full"
                      options={[
                        { value: 'lunas', label: 'Lunas' },
                        { value: 'kredit', label: 'Kredit' },
                      ]}
                    />
                  </div>
                  {stockPaymentStatus === 'kredit' && stock > 0 && (
                    <div className="min-w-0 sm:col-span-2">
                      <label className="mb-1 block text-sm font-medium">Tanggal jatuh tempo stok awal</label>
                      <Input type="date" value={stockDueDate} onChange={(event) => setStockDueDate(event.target.value)} />
                    </div>
                  )}
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">Harga Modal</label>
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,8rem)] gap-2">
                    <Input
                      className="min-w-0"
                      inputMode="numeric"
                      value={formatCurrencyInput(costPrice)}
                      onChange={(e) => setCostPrice(parseCurrencyInput(e.target.value))}
                      readOnly={Boolean(editing)}
                      title={editing ? 'Gunakan Tambah Stok untuk mengubah HPP batch baru' : undefined}
                    />
                    <Select
                      className="min-w-0"
                      value={costUnit}
                      options={unitOptions}
                      onChange={(value) => {
                        const nextUnit = value as UnitType
                        setCostUnit(nextUnit)
                        setPrices((current) => current.map((price, index) => (
                          index === 0
                            ? { ...price, unit: nextUnit, conversion: unitFactors[nextUnit] || 1 }
                            : price
                        )))
                      }}
                      disabled={Boolean(editing)}
                      aria-label="Satuan harga modal"
                    />
                  </div>
                  {editing && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
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
                    <div key={idx} className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.75fr)_auto] items-center gap-2">
                      <Input
                        className="flex-1"
                        placeholder="Harga"
                        inputMode="numeric"
                        value={formatCurrencyInput(pr.price)}
                        onChange={(e) => updatePrice(idx, 'price', parseCurrencyInput(e.target.value))}
                        onKeyDown={(event) => {
                          if (event.key === 'Tab' && !event.shiftKey && idx === prices.length - 1) {
                            event.preventDefault()
                            saveButtonRef.current?.focus()
                          }
                        }}
                      />
                      <Select
                        className="min-w-0"
                        value={pr.unit}
                        options={unitOptions}
                        onChange={(value) => updatePrice(idx, 'unit', value)}
                        disabled={editingPricesOnly}
                        aria-label={`Satuan harga jual ${idx + 1}`}
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
                              <p className="text-sm text-muted-foreground">
                                Produk akan disembunyikan dari kasir. Riwayat transaksi tetap tersimpan.
                              </p>
                              <p className="text-sm text-muted-foreground">
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
                <p className="mt-1 text-xs text-muted-foreground">
                  Kolom ketiga = jumlah unit dasar (pcs/meter) per satuan jual
                </p>
              </div>
            </CardContent>
            <div className="flex gap-2 border-t p-4">
              <Button variant="outline" className="flex-1" onClick={() => setModal(false)}>
                Batal
              </Button>
              <Button ref={saveButtonRef} className="flex-1" onClick={handleSave} disabled={saving}>
                {saving ? <LoadingDots className="text-current" dotClassName="h-1.5 w-1.5" /> : 'Simpan'}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
