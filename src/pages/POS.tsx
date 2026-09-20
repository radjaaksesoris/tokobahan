import { useEffect, useState, useMemo, type KeyboardEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { useCartStore } from '@/store/useCartStore'
import { useAuthStore } from '@/store/useAuthStore'
import type { Product, UnitType } from '@/types'
import { UNIT_LABELS } from '@/types'
import { formatCurrency } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent } from '@/components/ui/Card'
import {
  Search,
  Plus,
  Minus,
  Trash2,
  ShoppingCart,
  CheckCircle2,
  Loader2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { notifyLowStockPush } from '@/lib/notifications'

export default function POS() {
  const [products, setProducts] = useState<Product[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [selectedUnit, setSelectedUnit] = useState<UnitType>('satuan')
  const [qty, setQty] = useState(1)
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'transfer' | 'qris' | 'credit'>('cash')
  const [showCart, setShowCart] = useState(false)
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1)

  const { items, addItem, updateQuantity, removeItem, clearCart, getTotals } = useCartStore()
  const profile = useAuthStore((s) => s.profile)
  const totals = getTotals()

  useEffect(() => {
    const timer = window.setTimeout(loadProducts, 250)
    return () => window.clearTimeout(timer)
  }, [search])

  async function loadProducts() {
    setLoading(true)
    let query = supabase
      .from('products')
      .select('id, name, sku, barcode, category_id, cost_price, cost_unit, cost_conversion, stock_unit, stock_conversion, stock, min_stock, unit_base, prices, image_url, is_active, created_at, updated_at')
      .eq('is_active', true)
      .order('name')
      .limit(100)
    const term = search.trim().replace(/[%_,]/g, ' ')
    if (term) query = query.or(`name.ilike.%${term}%,sku.ilike.%${term}%,barcode.ilike.%${term}%`)
    const { data, error } = await query
    if (error) toast.error(error.message)
    else {
      setProducts(
        (data || []).map((p) => ({
          ...p,
          prices: (p.prices as any) || [],
        })) as Product[]
      )
    }
    setLoading(false)
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return products
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q) ||
        p.barcode?.toLowerCase().includes(q)
    )
  }, [products, search])

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!search.trim() || filtered.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveSuggestionIndex((current) => (current + 1) % filtered.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveSuggestionIndex((current) => (current <= 0 ? filtered.length - 1 : current - 1))
    } else if (event.key === 'Enter' && activeSuggestionIndex >= 0) {
      event.preventDefault()
      const selectedSuggestion = filtered[activeSuggestionIndex]
      if (selectedSuggestion) openAdd(selectedSuggestion)
    } else if (event.key === 'Escape') {
      setActiveSuggestionIndex(-1)
    }
  }

  function openAdd(product: Product) {
    if (product.stock <= 0) {
      toast.error(`${product.name} habis`)
      return
    }
    setSelectedProduct(product)
    const firstUnit = product.prices?.[0]?.unit || 'satuan'
    setSelectedUnit(firstUnit as UnitType)
    setQty(1)
  }

  function confirmAdd() {
    if (!selectedProduct) return
    if (selectedProduct.stock <= 0) {
      toast.error(`${selectedProduct.name} habis`)
      setSelectedProduct(null)
      return
    }
    if (qty > selectedProduct.stock) {
      toast.error(`Stok ${selectedProduct.name} hanya tersisa ${selectedProduct.stock}`)
      return
    }
    addItem(selectedProduct, selectedUnit, qty)
    toast.success(`${selectedProduct.name} ditambahkan`)
    setSelectedProduct(null)
  }

  async function handleCheckout() {
    if (items.length === 0) return
    setCheckoutLoading(true)

    const insufficientStock = items.find((item) => item.quantity > item.product.stock)
    if (insufficientStock) {
      toast.error(
        insufficientStock.product.stock <= 0
          ? `${insufficientStock.product.name} habis`
          : `Stok ${insufficientStock.product.name} hanya tersisa ${insufficientStock.product.stock}`
      )
      setCheckoutLoading(false)
      return
    }

    const { data: invoiceNo, error: invoiceError } = await supabase.rpc('next_invoice_number')
    if (invoiceError || !invoiceNo) {
      toast.error(invoiceError?.message || 'Gagal membuat nomor transaksi')
      setCheckoutLoading(false)
      return
    }

    const saleItems = items.map((i) => ({
      product_id: i.product.id,
      product_name: i.product.name,
      unit: i.unit,
      quantity: i.quantity,
      conversion: i.conversion,
      unit_price: i.unit_price,
      line_total: i.line_total,
      line_cost: i.line_cost,
      line_profit: i.line_profit,
    }))

    const { error: checkoutError } = await supabase.rpc('checkout_sale', {
      p_invoice_no: invoiceNo,
      p_total_amount: totals.subtotal,
      p_total_cost: totals.totalCost,
      p_total_profit: totals.totalProfit,
      p_payment_method: paymentMethod,
      p_cashier_id: profile?.id || null,
      p_items: saleItems,
    })
    if (checkoutError) {
      const isMissingCheckoutFunction =
        checkoutError.code === 'PGRST202' ||
        checkoutError.message.includes('Could not find the function public.checkout_sale')
      const isInsufficientStock = checkoutError.message.toLowerCase().includes('tidak mencukupi')
      toast.error(
        isMissingCheckoutFunction
          ? 'Fitur pembayaran belum aktif. Jalankan migration checkout_sale di Supabase.'
          : isInsufficientStock
            ? 'Transaksi dibatalkan: stok barang habis atau tidak mencukupi.'
          : checkoutError.message
      )
      setCheckoutLoading(false)
      return
    }

    toast.success(`Transaksi ${invoiceNo} berhasil! Laba: ${formatCurrency(totals.totalProfit)}`)
    clearCart()
    setShowCart(false)
    loadProducts()
    notifyLowStockPush().catch((error) => {
      console.error('Failed to send low-stock push notifications:', error)
    })
    setCheckoutLoading(false)
  }

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-7rem)] max-w-[1440px] flex-col gap-4 lg:flex-row">
      {/* Product list */}
      <div className="flex flex-1 flex-col min-h-0">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-[0.18em] text-primary">Ruang kasir</p>
            <h2 className="text-3xl font-bold tracking-tight text-ink">Transaksi baru</h2>
          </div>
          <div className="hidden rounded-xl border border-stone-300 bg-surface px-3 py-2 text-right sm:block">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Item dipilih</p>
            <p className="text-lg font-bold tabular-nums text-ink">{items.length}</p>
          </div>
        </div>
        <div className="mb-3 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Cari produk / SKU / barcode..."
              className="pl-9 pr-10"
              value={search}
              role="combobox"
              aria-autocomplete="list"
              aria-controls="pos-product-suggestions"
              aria-expanded={Boolean(search.trim() && filtered.length > 0)}
              aria-activedescendant={
                activeSuggestionIndex >= 0
                  ? `pos-product-suggestion-${filtered[activeSuggestionIndex]?.id}`
                  : undefined
              }
              onChange={(e) => {
                setSearch(e.target.value)
                setActiveSuggestionIndex(-1)
              }}
              onKeyDown={handleSearchKeyDown}
              autoFocus
            />
            {search && (
              <button
                type="button"
                aria-label="Reset pencarian"
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-stone-200 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            {search.trim() && filtered.length > 0 && (
              <div
                id="pos-product-suggestions"
                role="listbox"
                className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-xl border border-stone-200 bg-surface p-1 shadow-lg"
              >
                {filtered.map((product, index) => (
                  <button
                    key={product.id}
                    id={`pos-product-suggestion-${product.id}`}
                    type="button"
                    role="option"
                    aria-selected={index === activeSuggestionIndex}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => openAdd(product)}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      index === activeSuggestionIndex
                        ? 'bg-teal-50 text-teal-800'
                        : 'text-slate-700 hover:bg-stone-100'
                    }`}
                  >
                    <span className="truncate font-medium">{product.name}</span>
                    <span className="ml-3 shrink-0 text-xs text-slate-400">
                      {product.stock <= 0 ? 'Habis' : `Stok: ${product.stock}`}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button
            variant="secondary"
            className="lg:hidden shrink-0"
            onClick={() => setShowCart(true)}
          >
            <ShoppingCart className="h-5 w-5" />
            {items.length > 0 && (
              <span className="ml-1 rounded-full bg-ink px-1.5 text-xs text-white">
                {items.length}
              </span>
            )}
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-12 text-center text-slate-400">Produk tidak ditemukan</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  onClick={() => openAdd(p)}
                  className={`group flex flex-col rounded-2xl border border-stone-200/80 bg-surface p-3 text-left transition-all duration-200 ${
                    p.stock <= 0
                      ? 'cursor-not-allowed opacity-60'
                      : 'hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-[0_12px_24px_rgba(33,108,104,0.12)] active:scale-[0.98]'
                  }`}
                >
                  <div className="mb-2 flex h-16 items-center justify-center rounded-xl bg-stone-100 text-2xl font-bold text-stone-300 transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                    {p.name.charAt(0)}
                  </div>
                  <p className="line-clamp-2 text-sm font-medium text-slate-800">{p.name}</p>
                  <p className={`mt-1 text-xs ${p.stock <= 0 ? 'font-semibold text-red-500' : 'text-slate-400'}`}>
                    {p.stock <= 0 ? 'Barang habis' : `Stok: ${p.stock}`}
                  </p>
                  <p className="mt-0.5 text-sm font-semibold text-teal-700">
                    {formatCurrency(
                      p.prices?.find((x) => x.unit === 'satuan')?.price ?? p.cost_price
                    )}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Cart - desktop */}
      <div className="hidden w-full max-w-sm flex-col rounded-2xl border border-ink/10 bg-ink text-white shadow-[0_18px_40px_rgba(32,42,46,0.18)] lg:flex">
        <CartPanel
          items={items}
          totals={totals}
          paymentMethod={paymentMethod}
          setPaymentMethod={setPaymentMethod}
          updateQuantity={updateQuantity}
          removeItem={removeItem}
          onCheckout={handleCheckout}
          loading={checkoutLoading}
        />
      </div>

      {/* Cart - mobile sheet */}
      {showCart && (
        <div className="fixed inset-0 z-50 flex flex-col bg-surface lg:hidden">
          <div className="flex h-14 items-center justify-between border-b px-4">
            <h3 className="font-semibold">Keranjang</h3>
            <button onClick={() => setShowCart(false)}>
              <X className="h-5 w-5" />
            </button>
          </div>
          <CartPanel
            items={items}
            totals={totals}
            paymentMethod={paymentMethod}
            setPaymentMethod={setPaymentMethod}
            updateQuantity={updateQuantity}
            removeItem={removeItem}
            onCheckout={handleCheckout}
            loading={checkoutLoading}
          />
        </div>
      )}

      {/* Unit selector modal */}
      {selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
          <Card className="w-full max-w-md rounded-t-2xl sm:rounded-2xl">
            <CardContent className="p-5">
              <h3 className="mb-1 text-lg font-semibold">{selectedProduct.name}</h3>
              <p className="mb-4 text-sm text-slate-500">Pilih satuan & jumlah</p>

              <div className="mb-4 grid grid-cols-3 gap-2">
                {(selectedProduct.stock_unit
                  ? [selectedProduct.stock_unit]
                  : selectedProduct.prices?.length
                    ? selectedProduct.prices.map((p) => p.unit)
                    : (['satuan'] as UnitType[])
                ).map((u) => (
                  <button
                    key={u}
                    onClick={() => setSelectedUnit(u as UnitType)}
                    className={`rounded-lg border px-2 py-2.5 text-sm font-medium transition ${
                      selectedUnit === u
                        ? 'border-teal-600 bg-teal-50 text-teal-700'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {UNIT_LABELS[u as UnitType] || u}
                  </button>
                ))}
              </div>

              <div className="mb-4 flex items-center justify-center gap-4">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setQty(Math.max(1, qty - 1))}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <Input
                  type="number"
                  min={1}
                  max={selectedProduct.stock}
                  value={qty}
                  onChange={(e) =>
                    setQty(Math.min(
                      selectedProduct.stock,
                      Math.max(1, parseInt(e.target.value) || 1)
                    ))
                  }
                  className="w-20 text-center text-lg font-bold"
                />
                <Button variant="outline" size="icon"                 onClick={() => setQty(Math.min(selectedProduct.stock, qty + 1))}
                disabled={qty >= selectedProduct.stock}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              <div className="mb-4 rounded-lg bg-slate-50 p-3 text-center">
                <p className="text-xs text-slate-500">Total</p>
                <p className="text-xl font-bold text-teal-700">
                  {formatCurrency(
                    (selectedProduct.prices?.find((p) => p.unit === selectedUnit)?.price ||
                      0) * qty
                  )}
                </p>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setSelectedProduct(null)}>
                  Batal
                </Button>
                <Button className="flex-1" onClick={confirmAdd} disabled={selectedProduct.stock <= 0}>
                  Tambah
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

function CartPanel({
  items,
  totals,
  paymentMethod,
  setPaymentMethod,
  updateQuantity,
  removeItem,
  onCheckout,
  loading,
}: {
  items: ReturnType<typeof useCartStore.getState>['items']
  totals: ReturnType<typeof useCartStore.getState>['getTotals'] extends () => infer R ? R : never
  paymentMethod: string
  setPaymentMethod: (m: any) => void
  updateQuantity: (id: string, unit: UnitType, q: number) => void
  removeItem: (id: string, unit: UnitType) => void
  onCheckout: () => void
  loading: boolean
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/10 px-4 py-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">Pesanan berjalan</p>
        <h3 className="mt-1 font-heading text-lg font-semibold text-white">Keranjang ({items.length})</h3>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {items.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">Keranjang kosong</p>
        ) : (
          items.map((item) => (
            <div
              key={`${item.product.id}-${item.unit}`}
              className="rounded-xl border border-white/10 bg-white/5 p-3"
            >
              <div className="flex justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{item.product.name}</p>
                  <p className="text-xs text-stone-400">
                    {UNIT_LABELS[item.unit]} × {formatCurrency(item.unit_price)}
                  </p>
                </div>
                <button
                  onClick={() => removeItem(item.product.id, item.unit)}
                  className="text-stone-400 hover:text-red-300"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <button
                    className="rounded-lg border border-white/10 bg-white/10 p-2 text-white"
                    onClick={() => updateQuantity(item.product.id, item.unit, item.quantity - 1)}
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                  <button
                    className="rounded-lg border border-white/10 bg-white/10 p-2 text-white"
                    onClick={() => updateQuantity(item.product.id, item.unit, item.quantity + 1)}
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
                <p className="text-sm font-semibold text-accent">
                  {formatCurrency(item.line_total)}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="space-y-3 border-t border-white/10 p-4">
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-stone-400">Subtotal</span>
            <span className="font-medium text-white">{formatCurrency(totals.subtotal)}</span>
          </div>
          <div className="flex justify-between text-emerald-600">
            <span>Estimasi Laba</span>
            <span className="font-medium">{formatCurrency(totals.totalProfit)}</span>
          </div>
        </div>

        <div className="flex gap-1.5">
          {(['cash', 'transfer', 'qris', 'credit'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setPaymentMethod(m)}
              className={`flex-1 rounded-lg border py-2 text-xs font-medium capitalize ${
              paymentMethod === m
                  ? 'border-accent bg-accent text-ink'
                  : 'border-white/15 text-stone-300 hover:border-white/30'
              }`}
            >
              {m === 'cash' ? 'Tunai' : m === 'transfer' ? 'TF' : m === 'qris' ? 'QRIS' : 'Kredit'}
            </button>
          ))}
        </div>

        <Button
          className="w-full"
          size="lg"
          disabled={items.length === 0 || loading}
          onClick={onCheckout}
        >
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <>
              <CheckCircle2 className="h-5 w-5" />
              Bayar {formatCurrency(totals.subtotal)}
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
