import { useEffect, useState, useMemo, useRef, type KeyboardEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { getPriceForUnit, useCartStore } from '@/store/useCartStore'
import { useAuthStore } from '@/store/useAuthStore'
import type { Product, UnitType } from '@/types'
import { parseProductPrices, UNIT_LABELS } from '@/types'
import { formatCurrency, toTitleCase } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent } from '@/components/ui/Card'
import {
  Search,
  ArrowLeft,
  Plus,
  Minus,
  Trash2,
  ShoppingCart,
  CheckCircle2,
  X,
  Delete,
  LoaderCircle,
} from 'lucide-react'
import { LoadingDots } from '@/components/ui/LoadingDots'
import { toast } from 'sonner'
import { notifyLowStockPush } from '@/lib/notifications'
import { readOfflineCache, writeOfflineCache } from '@/lib/offlineCache'
import {
  createOfflineInvoice,
  enqueueTransaction,
  getQueuedTransactions,
  isOfflineError,
  removeQueuedTransaction,
  retryFailedTransactions,
  subscribeOfflineTransactions,
  type QueuedTransaction,
} from '@/lib/offlineTransactions'

type PaymentMethod = 'cash' | 'qris' | 'credit'
const POS_CATALOG_CACHE_KEY = 'pos-catalog'

function sortCatalogProducts(products: Product[]) {
  return [...products].sort((a, b) => Number(a.stock <= 0) - Number(b.stock <= 0))
}

interface ReceiptData {
  invoiceNo: string
  createdAt: string
  paymentMethod: PaymentMethod
  customerName: string | null
  amountPaid: number
  change: number
  total: number
  items: {
    name: string
    unit: string
    quantity: number
    unitPrice: number
    lineTotal: number
  }[]
}

export default function POS() {
  const navigate = useNavigate()
  const [products, setProducts] = useState<Product[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [selectedUnit, setSelectedUnit] = useState<UnitType>('satuan')
  const [qty, setQty] = useState(1)
  const [qtyInput, setQtyInput] = useState('1')
  const [salePriceInput, setSalePriceInput] = useState('')
  const [salePriceError, setSalePriceError] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [showCart, setShowCart] = useState(false)
  const initialLoadComplete = useRef(false)
  const searchFilterRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const checkoutButtonRef = useRef<HTMLButtonElement>(null)
  const keypadPanelRef = useRef<HTMLDivElement>(null)
  const [activeProductIndex, setActiveProductIndex] = useState(-1)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [cashReceived, setCashReceived] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([])
  const qtyInputRef = useRef<HTMLInputElement>(null)
  const addItemButtonRef = useRef<HTMLButtonElement>(null)
  const paymentInputRef = useRef<HTMLInputElement>(null)
  const finishPaymentButtonRef = useRef<HTMLButtonElement>(null)
  const [showKeypadPanel, setShowKeypadPanel] = useState(false)
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const [queuedTransactions, setQueuedTransactions] = useState<QueuedTransaction[]>([])
  const [isSyncing, setIsSyncing] = useState(false)
  const [receipt, setReceipt] = useState<ReceiptData | null>(null)
  const [showReceiptPreview, setShowReceiptPreview] = useState(true)

  const { items, addItem, updateQuantity, removeItem, clearCart, getTotals } = useCartStore()
  const profile = useAuthStore((s) => s.profile)
  const totals = getTotals()
  const failedQueueCount = queuedTransactions.filter((transaction) => transaction.status === 'failed').length
  const getReservedQuantity = (productId: string) =>
    items
      .filter((item) => item.product.id === productId)
      .reduce((sum, item) => sum + item.quantity, 0)
  const getAvailableStock = (product: Product) =>
    Math.max(0, product.stock - getReservedQuantity(product.id))

  function createReceipt(invoiceNo: string): ReceiptData {
    const amountPaid = paymentMethod === 'credit' ? Number(cashReceived) || 0 : totals.subtotal
    return {
      invoiceNo,
      createdAt: new Date().toISOString(),
      paymentMethod,
      customerName: paymentMethod === 'credit' ? customerName.trim() || null : null,
      amountPaid,
      change: paymentMethod === 'cash' ? Math.max(0, amountPaid - totals.subtotal) : 0,
      total: totals.subtotal,
      items: items.map((item) => ({
        name: item.product.name,
        unit: UNIT_LABELS[item.unit] || item.unit,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        lineTotal: item.line_total,
      })),
    }
  }

  async function loadSavedReceipt(saleId: string | null, invoiceNo: string) {
    let query = supabase
      .from('sales')
      .select('invoice_no, total_amount, payment_method, amount_paid, created_at, customer:customers(name), sale_items(product_name, unit, quantity, unit_price, line_total)')
      .order('created_at', { ascending: false })
      .limit(1)
    query = saleId ? query.eq('id', saleId) : query.eq('invoice_no', invoiceNo)
    const { data, error } = await query.maybeSingle()
    if (error || !data) return null
    const sale = data as unknown as {
      invoice_no: string
      total_amount: number
      payment_method: string
      amount_paid: number
      created_at: string
      customer: { name: string } | null
      sale_items: Array<{ product_name: string; unit: string; quantity: number; unit_price: number; line_total: number }>
    }
    return {
      invoiceNo: sale.invoice_no,
      createdAt: sale.created_at,
      paymentMethod: sale.payment_method as PaymentMethod,
      customerName: sale.customer?.name || null,
      amountPaid: Number(sale.amount_paid) || 0,
      change: sale.payment_method === 'cash' ? Math.max(0, Number(sale.amount_paid) - Number(sale.total_amount)) : 0,
      total: Number(sale.total_amount),
      items: (sale.sale_items || []).map((item) => ({
        name: item.product_name,
        unit: UNIT_LABELS[item.unit] || item.unit,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unit_price),
        lineTotal: Number(item.line_total),
      })),
    } satisfies ReceiptData
  }

  async function refreshQueue() {
    const transactions = await getQueuedTransactions()
    setQueuedTransactions(transactions)
    setIsSyncing(transactions.some((transaction) => transaction.status === 'syncing'))
  }

  useEffect(() => {
    const updateOnlineState = () => setIsOnline(navigator.onLine)
    refreshQueue().catch((error) => console.error('Failed to load offline transaction queue:', error))
    window.addEventListener('online', updateOnlineState)
    window.addEventListener('offline', updateOnlineState)
    const unsubscribe = subscribeOfflineTransactions(() => refreshQueue().catch(console.error))
    return () => {
      window.removeEventListener('online', updateOnlineState)
      window.removeEventListener('offline', updateOnlineState)
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(loadProducts, 250)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    if (!showKeypadPanel) return

    function closeKeypadOnOutsideClick(event: PointerEvent) {
      const target = event.target as Node
      if (searchFilterRef.current?.contains(target) || keypadPanelRef.current?.contains(target)) return
      setShowKeypadPanel(false)
    }

    document.addEventListener('pointerdown', closeKeypadOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeKeypadOnOutsideClick)
  }, [showKeypadPanel])

  function openSearchKeypad() {
    if (window.matchMedia('(max-width: 1023px)').matches) {
      setShowKeypadPanel(true)
    }
  }

  useEffect(() => {
    if (!selectedProduct) return
    const focusTimer = window.setTimeout(() => {
      qtyInputRef.current?.focus()
      qtyInputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(focusTimer)
  }, [selectedProduct])

  useEffect(() => {
    if (!showPaymentModal) return
    const focusTimer = window.setTimeout(() => {
      if (window.matchMedia('(min-width: 1024px)').matches) {
        paymentInputRef.current?.focus()
        paymentInputRef.current?.select()
      }
    }, 0)
    return () => window.clearTimeout(focusTimer)
  }, [showPaymentModal])

  useEffect(() => {
    if (paymentMethod !== 'credit' || !isOnline) return
    let cancelled = false
    supabase
      .from('customers')
      .select('id, name')
      .order('name')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          toast.error(error.message || 'Gagal memuat daftar pelanggan')
          return
        }
        setCustomers(data || [])
      })
    return () => {
      cancelled = true
    }
  }, [isOnline, paymentMethod])

  async function loadProducts() {
    if (!initialLoadComplete.current) setLoading(true)
    let query = supabase
      .from('products')
      .select('id, name, sku, barcode, category_id, cost_price, cost_unit, cost_conversion, stock_unit, stock_conversion, stock, min_stock, unit_base, prices, image_url, is_active, created_at, updated_at')
      .eq('is_active', true)
      .order('name')
      .limit(100)
    const term = search.trim().replace(/[%_,]/g, ' ')
    if (term) query = query.or(`name.ilike.%${term}%,sku.ilike.%${term}%,barcode.ilike.%${term}%`)
    const { data, error } = await query
    if (error) {
      const cachedProducts = readOfflineCache<Product[]>(POS_CATALOG_CACHE_KEY)
      if (cachedProducts) {
        const normalizedTerm = search.trim().toLowerCase()
        setProducts(sortCatalogProducts(normalizedTerm
          ? cachedProducts.filter((product) =>
            product.name.toLowerCase().includes(normalizedTerm) ||
            product.sku?.toLowerCase().includes(normalizedTerm) ||
            product.barcode?.toLowerCase().includes(normalizedTerm))
          : cachedProducts))
        toast.info('Katalog lokal digunakan karena katalog online gagal dimuat')
      } else {
        toast.error(navigator.onLine ? error.message : 'Katalog belum pernah disimpan untuk penggunaan offline')
        setProducts([])
      }
    }
    else {
      const normalizedProducts = (data || []).map((p) => ({
          ...p,
          prices: parseProductPrices(p.prices),
        })) as Product[]
      setProducts(sortCatalogProducts(normalizedProducts))
      if (!search.trim()) writeOfflineCache(POS_CATALOG_CACHE_KEY, normalizedProducts)
    }
    initialLoadComplete.current = true
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

  function clearSearch() {
    setSearch('')
    setActiveProductIndex(-1)
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Tab') {
      event.preventDefault()
      checkoutButtonRef.current?.focus()
      return
    }
    if (filtered.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveProductIndex((current) => (current + 1) % filtered.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveProductIndex((current) => (current <= 0 ? filtered.length - 1 : current - 1))
    } else if (event.key === 'Enter' && activeProductIndex >= 0) {
      event.preventDefault()
      const selectedProduct = filtered[activeProductIndex]
      if (selectedProduct) openAdd(selectedProduct)
    } else if (event.key === 'Escape') {
      setActiveProductIndex(-1)
    }
  }

  function openAdd(product: Product) {
    const availableStock = getAvailableStock(product)
    if (availableStock <= 0) {
      toast.error(`${product.name} habis`)
      return
    }
    setSelectedProduct(product)
    setShowKeypadPanel(false)
    const firstUnit = product.prices?.[0]?.unit || 'satuan'
    setSelectedUnit(firstUnit as UnitType)
    setQty(1)
    setQtyInput('1')
    setSalePriceInput(String(getPriceForUnit(product, firstUnit).price))
    setSalePriceError('')
  }

  function confirmAdd() {
    if (!selectedProduct) return
    const availableStock = getAvailableStock(selectedProduct)
    const quantity = Math.min(availableStock, Math.max(1, Number(qtyInput) || 1))
    const salePrice = Number(salePriceInput)
    if (!Number.isFinite(salePrice) || salePrice <= selectedProduct.cost_price) {
      toast.error(`Harga jual harus lebih besar dari HPP (${formatCurrency(selectedProduct.cost_price)})`)
      return
    }
    setQty(quantity)
    setQtyInput(String(quantity))
    if (availableStock <= 0) {
      toast.error(`${selectedProduct.name} habis`)
      setSelectedProduct(null)
      return
    }
    if (quantity <= 0) {
      toast.error(`Stok ${selectedProduct.name} habis`)
      return
    }
    addItem(selectedProduct, selectedUnit, quantity, salePrice)
    setSelectedProduct(null)
    setSearch('')
    setActiveProductIndex(-1)
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus()
    })
  }

  function handleCheckout() {
    if (paymentMethod === 'cash' || paymentMethod === 'credit') {
      setCashReceived('')
      setShowPaymentModal(true)
      return
    }
    processCheckout()
  }

  async function processCheckout() {
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

    let invoiceNo: string | null = null
    if (isOnline) {
      const { data, error: invoiceError } = await supabase.rpc('next_invoice_number')
      if (!invoiceError && data) invoiceNo = data
      else if (!isOfflineError(invoiceError)) {
        toast.error(invoiceError?.message || 'Gagal membuat nomor transaksi')
        setCheckoutLoading(false)
        return
      }
    }
    invoiceNo ||= createOfflineInvoice()

    let queuedTransaction: QueuedTransaction
    try {
      queuedTransaction = await enqueueTransaction({
        invoiceNo,
        totalAmount: totals.subtotal,
        totalCost: totals.totalCost,
        totalProfit: totals.totalProfit,
        paymentMethod,
        customerName: paymentMethod === 'credit' ? customerName.trim() || null : null,
        amountPaid: paymentMethod === 'credit' ? Number(cashReceived) || 0 : totals.subtotal,
        cashierId: profile?.id || null,
        items: saleItems,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal menyimpan transaksi lokal')
      setCheckoutLoading(false)
      return
    }
    if (!isOnline) {
      toast.info(`Transaksi disimpan offline (${invoiceNo})`)
      if (showReceiptPreview) setReceipt(createReceipt(invoiceNo))
      setProducts((current) => current.map((product) => {
        const sold = items.filter((item) => item.product.id === product.id)
          .reduce((sum, item) => sum + item.quantity, 0)
        return sold ? { ...product, stock: Math.max(0, product.stock - sold) } : product
      }))
      clearCart()
      setShowPaymentModal(false)
      setCashReceived('')
      setShowCart(false)
      setCheckoutLoading(false)
      return
    }

    const { data: checkoutSaleId, error: checkoutError } = await supabase.rpc('checkout_sale', {
          p_invoice_no: invoiceNo,
          p_total_amount: totals.subtotal,
          p_total_cost: totals.totalCost,
          p_total_profit: totals.totalProfit,
          p_payment_method: paymentMethod,
          p_cashier_id: profile?.id || null,
          p_items: saleItems,
          p_customer_name: paymentMethod === 'credit' ? customerName.trim() : null,
          p_amount_paid: paymentMethod === 'credit' ? Number(cashReceived) || 0 : totals.subtotal,
    })
    if (checkoutError) {
      if (isOfflineError(checkoutError)) {
        toast.info(`Transaksi disimpan offline (${invoiceNo})`)
        if (showReceiptPreview) setReceipt(createReceipt(invoiceNo))
        setProducts((current) => current.map((product) => {
          const sold = items.filter((item) => item.product.id === product.id)
            .reduce((sum, item) => sum + item.quantity, 0)
          return sold ? { ...product, stock: Math.max(0, product.stock - sold) } : product
        }))
        clearCart()
        setShowPaymentModal(false)
        setCashReceived('')
        setShowCart(false)
        setCheckoutLoading(false)
        return
      }
      await removeQueuedTransaction(queuedTransaction.id)
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

    await removeQueuedTransaction(queuedTransaction.id)
    const savedReceipt = await loadSavedReceipt(checkoutSaleId, invoiceNo)
    toast.success(`Transaksi ${savedReceipt?.invoiceNo || invoiceNo} berhasil!`)
    if (showReceiptPreview) setReceipt(savedReceipt || createReceipt(invoiceNo))
    clearCart()
    setShowPaymentModal(false)
    setCashReceived('')
    setShowCart(false)
    loadProducts()
    notifyLowStockPush().catch((error) => {
      console.error('Failed to send low-stock push notifications:', error)
    })
    setCheckoutLoading(false)
  }

  async function retryOfflineTransactions() {
    setIsSyncing(true)
    try {
      await retryFailedTransactions()
      await refreshQueue()
    } catch (error) {
      console.error('Retry offline transaction sync failed:', error)
    } finally {
      setIsSyncing(false)
    }
  }

  return (
    <div className="mobile-page-background mx-auto flex min-h-[calc(100dvh-5rem)] h-[calc(100dvh-5rem)] max-w-[1440px] flex-row gap-3 pt-2 lg:gap-4">
      {/* Product list */}
      <div className="flex flex-1 flex-col min-h-0">
        <div className="mb-2 flex items-start justify-between gap-2 lg:mb-4 lg:gap-3">
          <div className="flex items-center gap-3">
            <img
              src={`${import.meta.env.BASE_URL}icon-192.png`}
              alt="Radja Aksesoris"
              className="h-8 w-8 rounded-lg object-cover shadow-sm lg:h-10 lg:w-10 lg:rounded-xl"
            />
            <h2 className="text-xl font-bold tracking-tight text-ink lg:text-3xl">RADJA AKSESORIS</h2>
          </div>
          {(queuedTransactions.length > 0 || !isOnline || isSyncing) && (
            <button
              type="button"
              onClick={isSyncing ? undefined : queuedTransactions.some((transaction) => transaction.status === 'failed') ? retryOfflineTransactions : undefined}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                isSyncing
                  ? 'border-blue-200 bg-blue-50 text-blue-800'
                  : !isOnline
                  ? 'border-amber-300 bg-amber-50 text-amber-800'
                  : queuedTransactions.some((transaction) => transaction.status === 'failed')
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : 'border-teal-200 bg-teal-50 text-teal-800'
              }`}
              title={isSyncing ? 'Sinkronisasi transaksi sedang berjalan' : !isOnline ? 'Offline' : 'Klik untuk mencoba ulang transaksi gagal'}
            >
              {isSyncing ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <span className={`h-1.5 w-1.5 rounded-full ${!isOnline ? 'bg-amber-500' : queuedTransactions.some((transaction) => transaction.status === 'failed') ? 'bg-red-500' : 'bg-teal-500'}`} />
              )}
              {isSyncing ? 'Menyinkronkan...' : !isOnline ? 'Offline' : failedQueueCount > 0 ? `${failedQueueCount} gagal` : `${queuedTransactions.length} tersimpan`}
            </button>
          )}
          <button
            type="button"
            onClick={() => navigate('/')}
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl border border-border bg-surface px-2.5 text-xs font-semibold text-ink transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 lg:min-h-10 lg:gap-2 lg:px-3"
            aria-label="Kembali ke Dashboard"
            title="Kembali ke Dashboard"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Dashboard</span>
          </button>
        </div>
        <div className="mb-2 flex gap-2 lg:mb-3">
          <div ref={searchFilterRef} className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              aria-label="Cari produk, SKU, atau barcode"
              placeholder="Cari produk / SKU / barcode..."
              className="pl-9 pr-10"
              value={search}
              onClick={openSearchKeypad}
              onChange={(e) => {
                setSearch(e.target.value)
                setActiveProductIndex(-1)
              }}
              onKeyDown={handleSearchKeyDown}
            />
            {search && (
              <button
                type="button"
                aria-label="Reset pencarian"
                onClick={clearSearch}
                className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-stone-200 hover:text-ink/85"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <LoadingDots dotClassName="h-2 w-2" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-12 text-center text-muted-foreground">Produk tidak ditemukan</p>
          ) : (
            <div className="grid grid-cols-1 gap-1 xl:grid-cols-2 xl:gap-1.5">
              {filtered.map((p, index) => (
                (() => {
                  const availableStock = getAvailableStock(p)
                  return (
                <button
                  key={p.id}
                  onClick={() => openAdd(p)}
                  className={`group flex min-h-12 items-center gap-1.5 rounded-xl border bg-surface p-1.5 text-left transition-all duration-200 lg:min-h-14 lg:gap-2 lg:p-2 ${
                    activeProductIndex === index
                      ? 'border-primary bg-teal-100 ring-2 ring-primary/30 shadow-[0_0_0_1px_rgba(33,108,104,0.18)]'
                      : 'border-stone-200/80'
                  } ${
                    availableStock <= 0
                      ? 'cursor-not-allowed opacity-60'
                      : 'hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-[0_12px_24px_rgba(33,108,104,0.12)] active:scale-[0.98]'
                  }`}
                >
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold transition-colors lg:h-9 lg:w-9 lg:text-base ${
                    activeProductIndex === index
                      ? 'bg-primary text-white'
                      : 'bg-muted text-stone-300 group-hover:bg-primary/10 group-hover:text-primary'
                  }`}>
                    {p.name.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-xs font-medium lg:text-[13px] ${
                      activeProductIndex === index ? 'text-teal-900' : 'text-ink/90'
                    }`}>{p.name}</p>
                    <p className={`mt-0.5 text-[10px] ${
                      availableStock <= 0
                        ? 'font-semibold text-red-500'
                        : activeProductIndex === index
                          ? 'text-teal-700'
                          : 'text-muted-foreground'
                    }`}>
                      {availableStock <= 0 ? 'Barang habis' : `Stok: ${availableStock}`}
                    </p>
                  </div>
                  <p className={`shrink-0 text-[11px] font-semibold lg:text-xs ${
                    activeProductIndex === index ? 'text-teal-900' : 'text-teal-700'
                  }`}>
                    {formatCurrency(
                      p.prices?.find((x) => x.unit === 'satuan')?.price ?? p.cost_price
                    )}
                  </p>
                </button>
                  )
                })()
              ))}
            </div>
          )}
        </div>
      </div>

      <Button
        variant="secondary"
        className="fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex justify-center shadow-lg lg:hidden"
        onClick={() => setShowCart(true)}
      >
        <ShoppingCart className="h-5 w-5" />
        <span>Keranjang{items.length > 0 ? ` (${items.length})` : ''}</span>
        {items.length > 0 && (
          <span className="ml-auto font-semibold text-primary">{formatCurrency(totals.subtotal)}</span>
        )}
      </Button>

      {/* Cart - desktop */}
      <div ref={keypadPanelRef} className="pos-cart-panel flex w-[38%] max-w-sm min-h-0 flex-col rounded-2xl border border-ink/10 bg-ink text-white shadow-[0_18px_40px_rgba(32,42,46,0.18)] lg:sticky lg:top-0 lg:h-full">
        {showKeypadPanel ? (
          <KeypadPanel
            value={search}
            onChange={(value) => {
              setSearch(value)
              setActiveProductIndex(-1)
            }}
            onClose={() => setShowKeypadPanel(false)}
          />
        ) : (
          <CartPanel
            items={items}
            totals={totals}
            paymentMethod={paymentMethod}
            setPaymentMethod={setPaymentMethod}
            customerName={customerName}
            setCustomerName={setCustomerName}
            customers={customers}
            updateQuantity={updateQuantity}
            removeItem={removeItem}
            onCheckout={handleCheckout}
            loading={checkoutLoading}
            checkoutButtonRef={checkoutButtonRef}
          />
        )}
      </div>

      {/* Cart - mobile sheet */}
      {showCart && (
        <div className="fixed inset-0 z-50 flex flex-col bg-surface lg:hidden">
          <div className="flex h-14 items-center justify-between border-b px-4">
            <h3 className="font-semibold">Keranjang</h3>
            <button type="button" aria-label="Tutup keranjang" className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted" onClick={() => setShowCart(false)}>
              <X className="h-5 w-5" />
            </button>
          </div>
          <CartPanel
            items={items}
            totals={totals}
            paymentMethod={paymentMethod}
            setPaymentMethod={setPaymentMethod}
            customerName={customerName}
            setCustomerName={setCustomerName}
            customers={customers}
            updateQuantity={updateQuantity}
            removeItem={removeItem}
            onCheckout={handleCheckout}
            loading={checkoutLoading}
            checkoutButtonRef={checkoutButtonRef}
          />
        </div>
      )}

      {/* Unit selector modal */}
      {selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
          <Card className="w-full max-w-md rounded-t-2xl sm:rounded-2xl">
            <CardContent className="p-5">
              <h3 className="mb-1 text-lg font-semibold">{selectedProduct.name}</h3>
              <p className="mb-4 text-sm text-muted-foreground">Pilih satuan & jumlah</p>

              <div className="mb-4 flex items-center gap-2">
                <div className="grid min-w-0 flex-1 grid-cols-3 gap-2">
                  {(selectedProduct.stock_unit
                    ? [selectedProduct.stock_unit]
                    : selectedProduct.prices?.length
                      ? selectedProduct.prices.map((p) => p.unit)
                      : (['satuan'] as UnitType[])
                  ).map((u) => (
                    <button
                      key={u}
                      onClick={() => {
                        const nextUnit = u as UnitType
                        setSelectedUnit(nextUnit)
                        setSalePriceInput(String(getPriceForUnit(selectedProduct, nextUnit).price))
                        setSalePriceError('')
                      }}
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
                <div className="shrink-0 rounded-lg border border-teal-600 bg-teal-50 px-3 py-2 text-center">
                  <p className="text-[10px] text-muted-foreground">Sisa stok</p>
                  <p className={`text-sm font-bold ${
                    getAvailableStock(selectedProduct) - (Number(qtyInput) || 0) <= 0 ? 'text-red-600' : 'text-teal-700'
                  }`}>
                    {Math.max(0, getAvailableStock(selectedProduct) - (Number(qtyInput) || 0))} {UNIT_LABELS[selectedProduct.stock_unit] || selectedProduct.stock_unit}
                  </p>
                </div>
              </div>

              <div className="mb-4 flex items-center justify-center gap-4">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    const next = Math.max(1, qty - 1)
                    setQty(next)
                    setQtyInput(String(next))
                  }}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <Input
                  ref={qtyInputRef}
                  type="text"
                  value={qtyInput}
                  inputMode="none"
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '')
                    if (!digits) {
                      setQtyInput('')
                      return
                    }
                    const next = Math.min(getAvailableStock(selectedProduct), Math.max(1, Number(digits)))
                    setQty(next)
                    setQtyInput(String(next))
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      confirmAdd()
                    } else if (e.key === 'Tab' && !e.shiftKey) {
                      e.preventDefault()
                      addItemButtonRef.current?.focus()
                    }
                  }}
                  className="w-20 text-center text-lg font-bold"
                />
                <Button variant="outline" size="icon" onClick={() => {
                  const next = Math.min(getAvailableStock(selectedProduct), qty + 1)
                  setQty(next)
                  setQtyInput(String(next))
                }}
                disabled={qty >= getAvailableStock(selectedProduct)}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              <div className="mb-4 grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-slate-50 p-3 text-center">
                  <p className="text-xs text-muted-foreground">HPP</p>
                  <p className="text-lg font-bold text-ink">
                    {formatCurrency(selectedProduct.cost_price)}
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3 text-center">
                  <label htmlFor="sale-price" className="mb-1 block text-xs text-muted-foreground">Harga Jual</label>
                  <Input
                    id="sale-price"
                    type="text"
                    inputMode="numeric"
                    value={salePriceInput}
                    onChange={(event) => {
                      const nextValue = event.target.value.replace(/\D/g, '')
                      const nextError = !nextValue || Number(nextValue) <= selectedProduct.cost_price
                      setSalePriceInput(nextValue)
                      setSalePriceError(nextError ? 'invalid' : '')
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        confirmAdd()
                      }
                    }}
                    className={`h-9 px-2 text-center text-lg font-bold text-teal-700 ${
                      salePriceError ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20' : ''
                    }`}
                    aria-label="Harga jual"
                    aria-invalid={Boolean(salePriceError)}
                  />
                </div>
              </div>

              <div className="mb-4 rounded-lg bg-slate-50 p-3 text-center">
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="text-xl font-bold text-teal-700">
                  {formatCurrency((Number(salePriceInput) || 0) * (Number(qtyInput) || 0))}
                </p>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setSelectedProduct(null)}>
                  Batal
                </Button>
                <Button
                  ref={addItemButtonRef}
                  className="flex-1 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
                  onClick={confirmAdd}
                  disabled={getAvailableStock(selectedProduct) <= 0 || Boolean(salePriceError)}
                >
                  Tambah
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
      {showPaymentModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
          <Card className="w-full max-w-md rounded-t-2xl sm:rounded-2xl">
            <CardContent className="p-5">
              <div className="mb-4">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
                  {paymentMethod === 'credit' ? 'Penjualan kredit' : 'Pembayaran tunai'}
                </p>
                <h3 className="mt-1 text-xl font-semibold text-ink">Selesaikan transaksi</h3>
              </div>
              <div className="overflow-hidden rounded-2xl border border-stone-200 bg-muted/50">
                <div className="flex items-center justify-between border-b border-stone-200 bg-teal-50 px-4 py-3">
                  <span className="text-sm font-medium text-muted-foreground">Total transaksi</span>
                  <span className="text-xl font-bold text-teal-800">{formatCurrency(totals.subtotal)}</span>
                </div>
                {paymentMethod === 'credit' && <div className="border-b border-stone-200 px-4 py-3">
                  <label htmlFor="credit-customer-name" className="mb-1 block text-xs font-medium text-muted-foreground">Pelanggan kredit</label>
                  <Input
                    id="credit-customer-name"
                    value={customerName}
                    readOnly
                    aria-label="Nama pelanggan kredit"
                    className="bg-white"
                  />
                </div>}
                <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
                  <span className="text-sm font-medium text-muted-foreground">{paymentMethod === 'credit' ? 'Bayar sekarang' : 'Uang diterima'}</span>
                  <span className="text-xl font-bold text-ink lg:hidden">{formatCurrency(Number(cashReceived) || 0)}</span>
                  <Input
                    ref={paymentInputRef}
                    value={cashReceived ? formatCurrency(Number(cashReceived)) : ''}
                    inputMode="numeric"
                    onChange={(event) => setCashReceived(event.target.value.replace(/\D/g, ''))}
                    onFocus={(event) => event.currentTarget.select()}
                    onKeyDown={(event) => {
                      if (event.key === 'Tab') {
                        event.preventDefault()
                        finishPaymentButtonRef.current?.focus()
                      }
                    }}
                    className="hidden h-9 w-36 text-right text-xl font-bold lg:block"
                    aria-label={paymentMethod === 'credit' ? 'Bayar sekarang' : 'Uang diterima'}
                  />
                </div>
                <div className={`flex items-center justify-between px-4 py-3 ${
                  Number(cashReceived) >= totals.subtotal ? 'bg-emerald-50' : 'bg-white'
                }`}>
                  <span className="text-sm font-medium text-muted-foreground">{paymentMethod === 'credit' ? 'Sisa hutang' : 'Kembalian'}</span>
                  <span className={`text-xl font-bold ${
                    Number(cashReceived) >= totals.subtotal ? 'text-emerald-700' : 'text-muted-foreground'
                  }`}>
                    {formatCurrency(paymentMethod === 'credit'
                      ? Math.max(0, totals.subtotal - (Number(cashReceived) || 0))
                      : Math.max(0, (Number(cashReceived) || 0) - totals.subtotal))}
                  </span>
                </div>
              </div>
              <div className="lg:hidden">
                <NumericKeypad
                  value={cashReceived}
                  title="Nominal pembayaran"
                  onChange={setCashReceived}
                  onClose={() => setShowPaymentModal(false)}
                />
              </div>
              <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface px-3 py-3 transition-colors hover:border-primary/40 hover:bg-primary/5">
                <input
                  type="checkbox"
                  checked={showReceiptPreview}
                  onChange={(event) => setShowReceiptPreview(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                />
                <span>
                  <span className="block text-sm font-semibold text-ink">Tampilkan preview struk</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                    Periksa tampilan struk 58 mm sebelum mencetak.
                  </span>
                </span>
              </label>
              <div className="mt-3 flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowPaymentModal(false)}>
                  Batal
                </Button>
                <Button
                  ref={finishPaymentButtonRef}
                  className="flex-1 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
                  disabled={
                    checkoutLoading ||
                    (paymentMethod === 'credit'
                      ? (!customerName.trim() || Number(cashReceived) > totals.subtotal)
                      : Number(cashReceived) < totals.subtotal)
                  }
                  onClick={processCheckout}
                >
                  {checkoutLoading ? <LoadingDots className="text-current" dotClassName="h-1.5 w-1.5" /> : 'Selesaikan'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
      {receipt && <ReceiptPreview receipt={receipt} onClose={() => setReceipt(null)} />}
      </div>
  )
}

function ReceiptPreview({ receipt, onClose }: { receipt: ReceiptData; onClose: () => void }) {
  const printButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const focusTimer = window.setTimeout(() => {
      printButtonRef.current?.focus()
    }, 0)
    return () => window.clearTimeout(focusTimer)
  }, [])

  function printReceipt() {
    window.print()
  }

  return (
    <>
      <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4 print:hidden">
        <Card className="w-full max-w-md rounded-t-2xl sm:rounded-2xl">
          <CardContent className="space-y-4 p-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Preview struk 58 mm</p>
              <h3 className="mt-1 text-xl font-bold text-ink">Siap dicetak</h3>
              <p className="mt-1 text-sm text-muted-foreground">{receipt.invoiceNo} · {formatCurrency(receipt.total)}</p>
            </div>
            <div className="receipt-preview-frame">
              <ReceiptDocument receipt={receipt} />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={onClose}>Nanti</Button>
              <Button
                ref={printButtonRef}
                className="flex-1 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
                onClick={printReceipt}
              >
                Cetak struk
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
      {createPortal(
        <div id="receipt-print-root" aria-hidden="true">
          <ReceiptDocument receipt={receipt} />
        </div>,
        document.body
      )}
    </>
  )
}

function ReceiptDocument({ receipt }: { receipt: ReceiptData }) {
  const paymentLabels: Record<PaymentMethod, string> = {
    cash: 'Tunai',
    qris: 'QRIS',
    credit: 'Hutang',
  }

  return (
    <article className="receipt-document">
      <header className="receipt-header">
        <div className="receipt-brand">
          <img src={`${import.meta.env.BASE_URL}logo-radja.png`} alt="Logo Radja Aksesoris" />
          <div className="receipt-brand-copy">
            <strong>RADJA AKSESORIS</strong>
            <span>Konveksi</span>
          </div>
        </div>
        <span className="receipt-title">Struk Penjualan</span>
      </header>
      <div className="receipt-rule" />
      <div className="receipt-meta">
        <span>No. {receipt.invoiceNo}</span>
        <span>{new Date(receipt.createdAt).toLocaleString('id-ID')}</span>
      </div>
      {receipt.customerName && <div>Pelanggan: {receipt.customerName}</div>}
      <div className="receipt-rule" />
      <div className="receipt-items">
        {receipt.items.map((item, index) => (
          <div key={`${item.name}-${index}`} className="receipt-item">
            <div>{item.name}</div>
            <div className="receipt-item-detail">
              <span>{item.quantity} {item.unit} × {formatCurrency(item.unitPrice)}</span>
              <strong>{formatCurrency(item.lineTotal)}</strong>
            </div>
          </div>
        ))}
      </div>
      <div className="receipt-rule" />
      <div className="receipt-total"><span>TOTAL</span><strong>{formatCurrency(receipt.total)}</strong></div>
      <div className="receipt-summary"><span>Pembayaran</span><span>{paymentLabels[receipt.paymentMethod]}</span></div>
      {receipt.paymentMethod === 'cash' && (
        <>
          <div className="receipt-summary"><span>Dibayar</span><span>{formatCurrency(receipt.amountPaid)}</span></div>
          <div className="receipt-summary"><span>Kembalian</span><span>{formatCurrency(receipt.change)}</span></div>
        </>
      )}
      {receipt.paymentMethod === 'credit' && receipt.amountPaid > 0 && (
        <>
          <div className="receipt-summary"><span>Dibayar sebagian</span><span>{formatCurrency(receipt.amountPaid)}</span></div>
          <div className="receipt-summary"><span>Sisa hutang</span><span>{formatCurrency(Math.max(0, receipt.total - receipt.amountPaid))}</span></div>
        </>
      )}
      <footer className="receipt-center receipt-footer">Terima kasih</footer>
    </article>
  )
}

function NumericKeypad({
  value,
  title,
  max,
  onChange,
  onClose,
}: {
  value: string
  title: string
  max?: number
  onChange: (value: string) => void
  onClose: () => void
}) {
  function append(digit: string) {
    const next = `${value}${digit}`.replace(/^0+(?=\d)/, '')
    if (!max || Number(next) <= max) onChange(next)
  }

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <button type="button" className="text-xs font-medium text-teal-700" onClick={onClose}>
          Selesai
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '⌫'].map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => key === '⌫' ? onChange(value.slice(0, -1)) : append(key)}
            className="h-11 rounded-xl border border-slate-200 bg-slate-50 text-lg font-semibold text-ink/85 transition-colors hover:bg-slate-100 active:bg-slate-200"
          >
            {key}
          </button>
        ))}
      </div>
    </div>
  )
}

function KeypadPanel({
  value,
  onChange,
  onClose,
}: {
  value: string
  onChange: (value: string) => void
  onClose: () => void
}) {
  return (
    <div className="keypad-panel flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">Input manual</p>
          <h3 className="mt-1 font-heading text-lg font-semibold text-white">Keypad Kasir</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 px-3 text-xs font-semibold text-stone-200 transition-colors hover:bg-white/10"
          aria-label="Kembali ke transaksi"
        >
          <ShoppingCart className="h-4 w-4" aria-hidden="true" />
          Transaksi
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <div className="mt-4">
          <TextKeypad
            value={value}
            onChange={onChange}
            onClose={onClose}
          />
        </div>
      </div>
    </div>
  )
}

function TextKeypad({
  value,
  onChange,
  onClose,
}: {
  value: string
  onChange: (value: string) => void
  onClose: () => void
}) {
  const rows = [
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
    ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
  ]
  const numberRows = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']]

  return (
    <div className="mt-4 space-y-2">
      <div className="mx-auto grid max-w-[15rem] grid-cols-3 gap-1.5">
        {numberRows.flat().map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(`${value}${key}`)}
            className="min-h-10 rounded-lg border border-accent/30 bg-accent/15 px-1 text-sm font-bold text-accent transition-colors hover:bg-accent/25 active:bg-accent active:text-ink"
          >
            {key}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange(`${value}0`)}
          className="col-start-2 min-h-10 rounded-lg border border-accent/30 bg-accent/15 px-1 text-sm font-bold text-accent transition-colors hover:bg-accent/25 active:bg-accent active:text-ink"
        >
          0
        </button>
      </div>
      <div className="space-y-2 border-t border-white/10 pt-3">
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} className="flex justify-center gap-1.5">
            {row.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => onChange(`${value}${key}`)}
                className="min-h-10 min-w-0 flex-1 rounded-lg border border-white/10 bg-white/10 px-1 text-sm font-semibold text-white transition-colors hover:bg-white/20 active:bg-accent active:text-ink"
              >
                {key}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 pt-1">
        <button
          type="button"
          onClick={() => onChange(value.slice(0, -1))}
          className="inline-flex min-h-11 w-16 items-center justify-center rounded-lg border border-white/10 bg-white/10 text-stone-200 transition-colors hover:bg-white/20 active:bg-accent active:text-ink"
          aria-label="Hapus karakter terakhir"
        >
          <Delete className="h-5 w-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onChange(`${value} `)}
          className="min-h-11 flex-1 rounded-lg border border-white/10 bg-white/10 text-xs font-semibold text-stone-200 transition-colors hover:bg-white/20 active:bg-accent active:text-ink"
        >
          Spasi
        </button>
        <button
          type="button"
          onClick={() => onChange('')}
          className="min-h-11 w-16 rounded-lg border border-white/10 bg-white/10 text-xs font-semibold text-stone-200 transition-colors hover:bg-white/20 active:bg-accent active:text-ink"
        >
          Bersihkan
        </button>
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 w-16 rounded-lg bg-accent text-xs font-bold text-ink transition-colors hover:bg-amber-300"
        >
          Selesai
        </button>
      </div>
    </div>
  )
}

function CartPanel({
  items,
  totals,
  paymentMethod,
  setPaymentMethod,
  customerName,
  setCustomerName,
  customers,
  updateQuantity,
  removeItem,
  onCheckout,
  loading,
  checkoutButtonRef,
}: {
  items: ReturnType<typeof useCartStore.getState>['items']
  totals: ReturnType<typeof useCartStore.getState>['getTotals'] extends () => infer R ? R : never
  paymentMethod: PaymentMethod
  setPaymentMethod: (method: PaymentMethod) => void
  customerName: string
  setCustomerName: (name: string) => void
  customers: { id: string; name: string }[]
  updateQuantity: (id: string, unit: UnitType, q: number) => void
  removeItem: (id: string, unit: UnitType) => void
  onCheckout: () => void
  loading: boolean
  checkoutButtonRef: RefObject<HTMLButtonElement | null>
}) {
  const [customerNameFocused, setCustomerNameFocused] = useState(false)
  const [activeCustomerIndex, setActiveCustomerIndex] = useState(-1)
  const customerSuggestions = customers
    .filter((customer) => customer.name.toLowerCase().includes(customerName.trim().toLowerCase()))
    .slice(0, 8)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-white/10 px-4 py-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">Pesanan berjalan</p>
        <h3 className="mt-1 font-heading text-lg font-semibold text-white">Keranjang ({items.length})</h3>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-2">
        {items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Keranjang kosong</p>
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
                    className="rounded-lg border border-white/10 bg-white/10 p-2 text-white disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => updateQuantity(item.product.id, item.unit, item.quantity - 1)}
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                  <button
                    className="rounded-lg border border-white/10 bg-white/10 p-2 text-white"
                    onClick={() => updateQuantity(item.product.id, item.unit, item.quantity + 1)}
                    disabled={item.quantity >= item.product.stock}
                    title={item.quantity >= item.product.stock ? 'Jumlah sudah mencapai stok' : 'Tambah jumlah'}
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
        </div>

        <div className="flex gap-1.5">
          {(['cash', 'credit'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setPaymentMethod(m)}
              className={`flex-1 rounded-lg border py-2 text-xs font-medium capitalize ${
              paymentMethod === m
                  ? 'border-accent bg-accent text-ink'
                  : 'border-white/15 text-stone-300 hover:border-white/30'
              }`}
            >
              {m === 'cash' ? 'Tunai' : 'Kredit'}
            </button>
          ))}
        </div>

        {paymentMethod === 'credit' && (
          <div className="relative">
            <Input
              value={customerName}
              onChange={(event) => {
                setCustomerName(toTitleCase(event.target.value))
                setActiveCustomerIndex(-1)
              }}
              onFocus={() => setCustomerNameFocused(true)}
              onBlur={() => window.setTimeout(() => setCustomerNameFocused(false), 150)}
              placeholder="Nama pelanggan (wajib)"
              aria-label="Nama pelanggan untuk transaksi kredit"
              onKeyDown={(event) => {
                if (event.key === 'Tab') {
                  event.preventDefault()
                  checkoutButtonRef.current?.focus()
                }
                if (event.key === 'ArrowDown' && customerSuggestions.length > 0) {
                  event.preventDefault()
                  setActiveCustomerIndex((current) => (current + 1) % customerSuggestions.length)
                }
                if (event.key === 'ArrowUp' && customerSuggestions.length > 0) {
                  event.preventDefault()
                  setActiveCustomerIndex((current) => (current <= 0 ? customerSuggestions.length - 1 : current - 1))
                }
                if (event.key === 'Enter' && activeCustomerIndex >= 0) {
                  event.preventDefault()
                  const customer = customerSuggestions[activeCustomerIndex]
                  if (customer) {
                    setCustomerName(customer.name)
                    setActiveCustomerIndex(-1)
                    checkoutButtonRef.current?.focus()
                  }
                }
              }}
              className="border-white/15 bg-white/10 text-white placeholder:text-stone-400 focus:border-accent focus:ring-accent/20"
            />
            {customerNameFocused && customerName.trim() && customerSuggestions.length > 0 && (
              <div className="absolute inset-x-0 bottom-full z-20 mb-1 max-h-40 overflow-y-auto rounded-xl border border-white/10 bg-ink p-1 shadow-lg">
                {customerSuggestions.map((customer, index) => (
                  <button
                    key={customer.id}
                    type="button"
                    className={`block w-full rounded-lg px-3 py-2 text-left text-sm text-white transition-colors ${
                      activeCustomerIndex === index ? 'bg-white/15' : 'hover:bg-white/10'
                    }`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setCustomerName(customer.name)
                      setCustomerNameFocused(false)
                      checkoutButtonRef.current?.focus()
                    }}
                  >
                    {customer.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <Button
          ref={checkoutButtonRef}
          className="w-full focus:ring-2 focus:ring-accent focus-visible:ring-accent focus:ring-offset-1 focus:ring-offset-ink"
          size="lg"
          disabled={items.length === 0 || loading}
          onClick={onCheckout}
        >
          {loading ? (
            <LoadingDots className="text-current" dotClassName="h-1.5 w-1.5" />
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
