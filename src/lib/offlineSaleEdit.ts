import type { Product } from '@/types'
import { parseProductPrices } from '@/types'
import type { PaymentMethod } from '@/lib/paymentMethods'
import {
  getStockUnitsFromConversion,
  roundStockQuantity,
} from '@/lib/productUnits'
import {
  updateOperationalSnapshot,
  type OperationalSnapshot,
} from '@/lib/offlineOperationalSnapshot'

interface SaleRecord extends Record<string, unknown> {
  id: string
  total_amount: number
  total_cost: number
  total_profit: number
  payment_method: PaymentMethod
  customer_id: string | null
  amount_paid: number
}

interface SaleItemRecord extends Record<string, unknown> {
  id: string
  sale_id: string
  product_id: string
  product_name: string
  unit: string
  quantity: number
  conversion: number
  unit_price: number
  line_total: number
  line_cost: number
  line_profit: number
}

export interface SaleEditItemInput {
  sourceItemId: string | null
  productId: string
  unit: string
  quantity: number
  unitPrice: number
}

export interface SaleEditInput {
  saleId: string
  items: SaleEditItemInput[]
  paymentMethod: PaymentMethod
  customerName: string
}

const roundMoney = (amount: number) => Math.round((amount + Number.EPSILON) * 100) / 100
const roundHistoricalQuantity = (quantity: number) =>
  Math.sign(quantity) * Math.round((Math.abs(quantity) + Number.EPSILON) * 1000) / 1000

function normalizedName(name: string) {
  return name.trim().toLocaleLowerCase()
}

export function applyOfflineSaleEdit(
  snapshot: OperationalSnapshot,
  input: SaleEditInput,
): { snapshot: OperationalSnapshot; sale: SaleRecord; items: SaleItemRecord[] } {
  const sale = snapshot.tables.sales.find((row) => row.id === input.saleId) as SaleRecord | undefined
  if (!sale) throw new Error('Transaksi tidak ditemukan di penyimpanan lokal')

  const originalItems = snapshot.tables.sale_items
    .filter((row) => row.sale_id === sale.id) as SaleItemRecord[]
  const originalItemIds = new Set(originalItems.map((item) => item.id))
  const hasReturns = snapshot.tables.sale_returns.some((row) =>
    row.sale_id === sale.id || originalItemIds.has(String(row.sale_item_id)),
  )
  if (snapshot.tables.customer_debt_payments.some((row) => row.sale_id === sale.id)) {
    throw new Error('Transaksi yang sudah memiliki cicilan hutang tidak dapat diedit')
  }
  if (!Object.hasOwn({
    cash: true,
    credit: true,
    transfer: true,
    qris: true,
  }, input.paymentMethod)) {
    throw new Error('Metode pembayaran tidak valid')
  }
  if (input.items.length === 0) throw new Error('Transaksi harus memiliki minimal satu barang')
  if (input.paymentMethod === 'credit' && !input.customerName.trim()) {
    throw new Error('Nama pelanggan wajib diisi untuk transaksi kredit')
  }

  const products = snapshot.tables.products as unknown as Product[]
  const productById = new Map(products.map((product) => [product.id, product]))
  if (hasReturns && input.paymentMethod !== sale.payment_method) {
    throw new Error('Metode pembayaran transaksi yang sudah memiliki retur tidak dapat diubah')
  }

  const returnsByItem = new Map<string, Array<Record<string, unknown>>>()
  for (const saleReturn of snapshot.tables.sale_returns) {
    if (saleReturn.sale_id !== sale.id && !originalItemIds.has(String(saleReturn.sale_item_id))) continue
    const itemId = String(saleReturn.sale_item_id || '')
    if (!originalItemIds.has(itemId)) {
      throw new Error('Data retur transaksi tidak terhubung ke barang yang valid')
    }
    const returns = returnsByItem.get(itemId) || []
    returns.push(saleReturn)
    returnsByItem.set(itemId, returns)
  }

  const returnedItemIds = new Set(returnsByItem.keys())
  const returnedHistory: SaleItemRecord[] = []
  const editableOriginalItems: SaleItemRecord[] = []
  for (const item of originalItems) {
    const itemReturns = returnsByItem.get(item.id)
    if (!itemReturns?.length) {
      editableOriginalItems.push(item)
      continue
    }

    const originalQuantity = Number(item.quantity)
    const returnedQuantity = roundHistoricalQuantity(itemReturns.reduce((sum, row) => sum + Number(row.quantity), 0))
    if (!Number.isFinite(originalQuantity) || originalQuantity <= 0 || returnedQuantity > originalQuantity) {
      throw new Error(`Jumlah retur untuk ${item.product_name} tidak valid`)
    }
    const refundAmount = roundMoney(itemReturns.reduce((sum, row) => {
      const refund = Number(row.refund_amount)
      if (!Number.isFinite(refund) || refund < 0) {
        throw new Error(`Nilai retur untuk ${item.product_name} tidak valid`)
      }
      return sum + refund
    }, 0))
    const returnedCost = roundMoney(itemReturns.reduce(
      (sum, row) => sum + roundMoney(Number(item.line_cost) * Number(row.quantity) / originalQuantity),
      0,
    ))
    const returnedProfit = roundMoney(itemReturns.reduce(
      (sum, row) => sum + roundMoney(Number(item.line_profit) * Number(row.quantity) / originalQuantity),
      0,
    ))
    returnedHistory.push({
      ...item,
      quantity: returnedQuantity,
      line_total: refundAmount,
      line_cost: returnedCost,
      line_profit: returnedProfit,
    })

    const remainingQuantity = roundHistoricalQuantity(originalQuantity - returnedQuantity)
    if (remainingQuantity > 0) {
      editableOriginalItems.push({
        ...item,
        quantity: remainingQuantity,
        line_total: roundMoney(Number(item.line_total) - refundAmount),
        line_cost: roundMoney(Number(item.line_cost) - returnedCost),
        line_profit: roundMoney(Number(item.line_profit) - returnedProfit),
      })
    }
  }

  const originalById = new Map(editableOriginalItems.map((item) => [item.id, item]))
  const usedSources = new Set<string>()
  const nextBatches = snapshot.tables.product_stock_batches.map((batch) => ({ ...batch }))
  const stockDeltas = new Map<string, number>()
  const returnedCosts = new Map<string, number>()
  const additions: Array<{ productId: string; saleItemIndex: number; quantity: number }> = []
  const nextItems: SaleItemRecord[] = []

  const addDelta = (productId: string, quantity: number, cost: number) => {
    stockDeltas.set(productId, (stockDeltas.get(productId) || 0) + quantity)
    returnedCosts.set(productId, (returnedCosts.get(productId) || 0) + cost)
  }

  input.items.forEach((draft, index) => {
    const product = productById.get(draft.productId)
    if (!product) throw new Error('Produk transaksi tidak ditemukan di katalog lokal')
    if (product.stock_unit_mode !== 'integer-base') {
      throw new Error(`Normalisasi stok ${product.name} terlebih dahulu di Pengaturan > Stok`)
    }
    const price = parseProductPrices(product.prices).find((entry) => entry.unit === draft.unit)
    if (!price || price.conversion <= 0) {
      throw new Error(`Satuan ${draft.unit} untuk ${product.name} tidak tersedia`)
    }
    if (
      !Number.isFinite(draft.quantity) || draft.quantity <= 0 ||
      !Number.isInteger(draft.quantity) ||
      !Number.isFinite(draft.unitPrice) || draft.unitPrice <= 0
    ) {
      throw new Error(`Jumlah atau harga ${product.name} tidak valid`)
    }

    const source = draft.sourceItemId ? originalById.get(draft.sourceItemId) : undefined
    if (draft.sourceItemId && (!source || usedSources.has(source.id))) {
      throw new Error('Barang transaksi sumber tidak valid')
    }
    if (!product.is_active && (!source || source.product_id !== product.id)) {
      throw new Error(`Produk ${product.name} sudah nonaktif dan tidak dapat ditambahkan ke transaksi`)
    }
    if (source) usedSources.add(source.id)

    let retainedCost = 0
    let additionalStock = getStockUnitsFromConversion(product, price.conversion, draft.quantity)
    if (source && source.product_id === product.id) {
      const oldStockQuantity = getStockUnitsFromConversion(
        product,
        Number(source.conversion),
        Number(source.quantity),
      )
      const retainedStock = Math.min(oldStockQuantity, additionalStock)
      const oldCost = Number(source.line_cost)
      retainedCost = oldStockQuantity > 0 ? roundMoney(oldCost * retainedStock / oldStockQuantity) : 0
      const returnedStock = roundStockQuantity(oldStockQuantity - retainedStock)
      if (returnedStock > 0) addDelta(product.id, returnedStock, roundMoney(oldCost - retainedCost))
      additionalStock = roundStockQuantity(additionalStock - retainedStock)
    } else if (source) {
      const oldProduct = productById.get(source.product_id)
      if (!oldProduct) throw new Error(`Produk ${source.product_name} tidak ditemukan untuk penyesuaian stok`)
      const oldStockQuantity = getStockUnitsFromConversion(
        oldProduct,
        Number(source.conversion),
        Number(source.quantity),
      )
      addDelta(
        oldProduct.id,
        oldStockQuantity,
        Number(source.line_cost),
      )
    }

    if (additionalStock > 0) additions.push({ productId: product.id, saleItemIndex: index, quantity: additionalStock })
    const lineTotal = roundMoney(draft.quantity * draft.unitPrice)
    nextItems.push({
      id: source && !returnedItemIds.has(source.id) ? source.id : crypto.randomUUID(),
      sale_id: sale.id,
      product_id: product.id,
      product_name: product.name,
      unit: draft.unit,
      quantity: draft.quantity,
      conversion: price.conversion,
      unit_price: draft.unitPrice,
      line_total: lineTotal,
      line_cost: retainedCost,
      line_profit: 0,
      created_at: source && !returnedItemIds.has(source.id) ? source.created_at : new Date().toISOString(),
    })
  })

  for (const source of editableOriginalItems) {
    if (usedSources.has(source.id)) continue
    const product = productById.get(source.product_id)
    if (!product) throw new Error(`Produk ${source.product_name} tidak ditemukan untuk penyesuaian stok`)
    const stockQuantity = getStockUnitsFromConversion(
      product,
      Number(source.conversion),
      Number(source.quantity),
    )
    addDelta(product.id, stockQuantity, Number(source.line_cost))
  }

  const now = new Date().toISOString()
  for (const [productId, quantity] of stockDeltas) {
    if (quantity <= 0) continue
    const cost = returnedCosts.get(productId) || 0
    const product = productById.get(productId)
    if (!product || !Number.isFinite(cost) || cost < 0) {
      throw new Error('HPP barang yang dikembalikan tidak valid')
    }
    nextBatches.push({
      id: crypto.randomUUID(),
      product_id: productId,
      quantity_received: quantity,
      quantity_remaining: quantity,
      unit_cost: roundMoney(cost / quantity),
      vendor_id: null,
      payment_status: 'lunas',
      due_date: null,
      received_at: now,
      created_at: now,
    })
  }

  const addedCosts = new Map<number, number>()
  for (const addition of additions) {
    let remaining = addition.quantity
    let cost = 0
    const batches = nextBatches
      .filter((batch) => batch.product_id === addition.productId && Number(batch.quantity_remaining) > 0)
      .sort((a, b) =>
        String(a.received_at).localeCompare(String(b.received_at)) ||
        String(a.id).localeCompare(String(b.id)),
      )
    for (const batch of batches) {
      if (remaining <= 0) break
      const available = Number(batch.quantity_remaining)
      const consumed = roundStockQuantity(Math.min(remaining, available))
      cost += consumed * Number(batch.unit_cost)
      remaining = roundStockQuantity(remaining - consumed)
      batch.quantity_remaining = roundStockQuantity(available - consumed)
    }
    if (remaining > 0) {
      const product = productById.get(addition.productId)
      throw new Error(`Batch HPP atau stok ${product?.name || 'barang'} tidak mencukupi`)
    }
    addedCosts.set(addition.saleItemIndex, roundMoney(cost))
  }

  for (const [index, item] of nextItems.entries()) {
    item.line_cost = roundMoney(item.line_cost + (addedCosts.get(index) || 0))
    if (item.line_total <= item.line_cost) {
      throw new Error(`Harga jual ${item.product_name} harus lebih besar dari HPP FIFO`)
    }
    item.line_profit = roundMoney(item.line_total - item.line_cost)
  }

  const nextProducts = products.map((product) => {
    const delta = stockDeltas.get(product.id) || 0
    const consumed = additions
      .filter((addition) => addition.productId === product.id)
      .reduce((sum, addition) => sum + addition.quantity, 0)
    const stock = roundStockQuantity(Number(product.stock) + delta - consumed)
    if (stock < 0) throw new Error(`Stok ${product.name} tidak mencukupi`)
    return delta || consumed
      ? { ...product, stock, updated_at: now }
      : product
  })

  const totalAmount = roundMoney(nextItems.reduce((sum, item) => sum + item.line_total, 0))
  const totalCost = roundMoney(nextItems.reduce((sum, item) => sum + item.line_cost, 0))
  if (
    sale.payment_method === 'credit' &&
    input.paymentMethod !== 'credit' &&
    Number(sale.amount_paid) < Number(sale.total_amount)
  ) {
    throw new Error('Sisa hutang belum lunas. Gunakan menu Pelunasan Hutang sebelum mengubah metode bayar.')
  }
  const amountPaid = input.paymentMethod === 'credit'
    ? sale.payment_method === 'credit' ? Number(sale.amount_paid) : 0
    : hasReturns
      ? roundMoney(Number(sale.amount_paid) + totalAmount - Number(sale.total_amount))
      : totalAmount
  if (!Number.isFinite(amountPaid) || amountPaid < 0 || (!hasReturns && amountPaid > totalAmount)) {
    throw new Error('Total transaksi tidak boleh lebih kecil dari jumlah yang sudah dibayar')
  }
  if (input.paymentMethod === 'credit') {
    const debtPayments = snapshot.tables.customer_debt_payments
      .filter((payment) => payment.sale_id === sale.id)
      .reduce((sum, payment) => sum + Number(payment.amount), 0)
    const cashRefunds = [...returnsByItem.values()]
      .flat()
      .reduce((sum, saleReturn) => sum + Number(saleReturn.cash_refund_amount ?? 0), 0)
    if (!Number.isFinite(debtPayments) || !Number.isFinite(cashRefunds)) {
      throw new Error('Riwayat pembayaran atau retur kredit tidak valid')
    }
    if (roundMoney(amountPaid + debtPayments - cashRefunds) > totalAmount) {
      throw new Error(
        'Total kredit tidak boleh lebih kecil dari pembayaran bersih yang sudah diterima. Proses pengembalian dana terlebih dahulu.',
      )
    }
  }

  let customers = snapshot.tables.customers
  let customerId: string | null = hasReturns ? sale.customer_id : null
  const customerName = input.customerName.trim()
  if (!hasReturns && customerName) {
    const normalized = normalizedName(customerName)
    const existing = customers.find((customer) =>
      normalizedName(String(customer.normalized_name || customer.name)) === normalized,
    )
    if (existing) {
      customerId = String(existing.id)
      customers = customers.map((customer) => customer.id === customerId
        ? { ...customer, name: customerName, normalized_name: normalized }
        : customer)
    } else {
      customerId = crypto.randomUUID()
      customers = [...customers, {
        id: customerId,
        name: customerName,
        normalized_name: normalized,
        created_at: now,
      }]
    }
  }

  const updatedSale: SaleRecord = {
    ...sale,
    total_amount: totalAmount,
    total_cost: totalCost,
    total_profit: roundMoney(totalAmount - totalCost),
    payment_method: input.paymentMethod,
    customer_id: customerId,
    amount_paid: amountPaid,
    cash_received: null,
  }

  return {
    snapshot: {
      ...snapshot,
      tables: {
        ...snapshot.tables,
        customers,
        products: snapshot.tables.products.map((row) => {
          const updated = nextProducts.find((product) => product.id === String(row.id))
          return updated ? { ...row, stock: updated.stock, updated_at: updated.updated_at } : row
        }),
        product_stock_batches: nextBatches,
        sales: snapshot.tables.sales.map((row) => row.id === sale.id ? updatedSale : row),
        sale_items: [
          ...snapshot.tables.sale_items.filter((row) => row.sale_id !== sale.id),
          ...returnedHistory,
          ...nextItems,
        ],
      },
    },
    sale: updatedSale,
    items: [...returnedHistory, ...nextItems],
  }
}

export function editOfflineSale(input: SaleEditInput) {
  return updateOperationalSnapshot((snapshot) => {
    const updated = applyOfflineSaleEdit(snapshot, input)
    return { snapshot: updated.snapshot, result: undefined }
  })
}
