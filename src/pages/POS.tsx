import { useEffect, useState, useMemo } from 'react'
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

  const { items, addItem, updateQuantity, removeItem, clearCart, getTotals } = useCartStore()
  const profile = useAuthStore((s) => s.profile)
  const totals = getTotals()

  useEffect(() => {
    loadProducts()
  }, [])

  async function loadProducts() {
    setLoading(true)
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('is_active', true)
      .order('name')
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

  function openAdd(product: Product) {
    setSelectedProduct(product)
    const firstUnit = product.prices?.[0]?.unit || 'satuan'
    setSelectedUnit(firstUnit as UnitType)
    setQty(1)
  }

  function confirmAdd() {
    if (!selectedProduct) return
    addItem(selectedProduct, selectedUnit, qty)
    toast.success(`${selectedProduct.name} ditambahkan`)
    setSelectedProduct(null)
  }

  async function handleCheckout() {
    if (items.length === 0) return
    setCheckoutLoading(true)

    const invoiceNo = `INV-${Date.now().toString(36).toUpperCase()}`

    const { data: sale, error: saleError } = await supabase
      .from('sales')
      .insert({
        invoice_no: invoiceNo,
        total_amount: totals.subtotal,
        total_cost: totals.totalCost,
        total_profit: totals.totalProfit,
        payment_method: paymentMethod,
        cashier_id: profile?.id || null,
      })
      .select()
      .single()

    if (saleError || !sale) {
      toast.error(saleError?.message || 'Gagal menyimpan transaksi')
      setCheckoutLoading(false)
      return
    }

    const saleItems = items.map((i) => ({
      sale_id: sale.id,
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

    const { error: itemsError } = await supabase.from('sale_items').insert(saleItems)
    if (itemsError) {
      toast.error(itemsError.message)
      setCheckoutLoading(false)
      return
    }

    // Update stock
    for (const item of items) {
      const deduct = item.quantity * item.conversion
      await supabase
        .from('products')
        .update({ stock: Math.max(0, item.product.stock - deduct) })
        .eq('id', item.product.id)
    }

    toast.success(`Transaksi ${invoiceNo} berhasil! Laba: ${formatCurrency(totals.totalProfit)}`)
    clearCart()
    setShowCart(false)
    loadProducts()
    setCheckoutLoading(false)
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem-1.5rem)] flex-col gap-3 lg:flex-row lg:h-[calc(100vh-3.5rem-3rem)]">
      {/* Product list */}
      <div className="flex flex-1 flex-col min-h-0">
        <div className="mb-3 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Cari produk / SKU / barcode..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>
          <Button
            variant="secondary"
            className="lg:hidden shrink-0"
            onClick={() => setShowCart(true)}
          >
            <ShoppingCart className="h-5 w-5" />
            {items.length > 0 && (
              <span className="ml-1 rounded-full bg-teal-700 px-1.5 text-xs text-white">
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
                  className="flex flex-col rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-teal-400 hover:shadow-md active:scale-[0.98]"
                >
                  <div className="mb-2 flex h-16 items-center justify-center rounded-lg bg-slate-100 text-2xl font-bold text-slate-300">
                    {p.name.charAt(0)}
                  </div>
                  <p className="line-clamp-2 text-sm font-medium text-slate-800">{p.name}</p>
                  <p className="mt-1 text-xs text-slate-400">Stok: {p.stock}</p>
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
      <div className="hidden w-full max-w-sm flex-col rounded-xl border border-slate-200 bg-white lg:flex">
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
        <div className="fixed inset-0 z-50 flex flex-col bg-white lg:hidden">
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
                {(selectedProduct.prices?.length
                  ? selectedProduct.prices.map((p) => p.unit)
                  : (['satuan', 'lusin', 'gross'] as UnitType[])
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
                  value={qty}
                  onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-20 text-center text-lg font-bold"
                />
                <Button variant="outline" size="icon" onClick={() => setQty(qty + 1)}>
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
                <Button className="flex-1" onClick={confirmAdd}>
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
      <div className="border-b px-4 py-3">
        <h3 className="font-semibold text-slate-800">Keranjang ({items.length})</h3>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {items.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">Keranjang kosong</p>
        ) : (
          items.map((item) => (
            <div
              key={`${item.product.id}-${item.unit}`}
              className="rounded-lg border border-slate-100 bg-slate-50 p-3"
            >
              <div className="flex justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.product.name}</p>
                  <p className="text-xs text-slate-500">
                    {UNIT_LABELS[item.unit]} × {formatCurrency(item.unit_price)}
                  </p>
                </div>
                <button
                  onClick={() => removeItem(item.product.id, item.unit)}
                  className="text-slate-400 hover:text-red-500"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <button
                    className="rounded border bg-white p-1"
                    onClick={() => updateQuantity(item.product.id, item.unit, item.quantity - 1)}
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                  <button
                    className="rounded border bg-white p-1"
                    onClick={() => updateQuantity(item.product.id, item.unit, item.quantity + 1)}
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
                <p className="text-sm font-semibold text-teal-700">
                  {formatCurrency(item.line_total)}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="border-t p-4 space-y-3">
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Subtotal</span>
            <span className="font-medium">{formatCurrency(totals.subtotal)}</span>
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
                  ? 'border-teal-600 bg-teal-50 text-teal-700'
                  : 'border-slate-200 text-slate-600'
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
