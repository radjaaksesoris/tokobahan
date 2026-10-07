import type { CartItem } from '@/types'
import {
  updateOperationalSnapshot,
} from '@/lib/offlineOperationalSnapshot'
import { getStockConversion } from '@/lib/productUnits'
import type { PaymentMethod } from '@/lib/paymentMethods'

export type OfflinePaymentMethod = PaymentMethod
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

interface OfflineCheckoutInput {
  invoiceNo: string
  items: CartItem[]
  paymentMethod: OfflinePaymentMethod
  customerName: string | null
  amountPaid: number
  cashierId: string | null
}

export async function saveOfflineCheckout(input: OfflineCheckoutInput) {
  if (!input.invoiceNo.trim()) throw new Error('Nomor invoice wajib diisi')
  if (!input.cashierId) throw new Error('Profil admin tidak ditemukan')
  if (input.items.length === 0) throw new Error('Transaksi harus memiliki minimal satu barang')

  const createdAt = new Date().toISOString()
  const saleId = crypto.randomUUID()

  await updateOperationalSnapshot((snapshot) => {
    if (snapshot.tables.sales.some((sale) => sale.invoice_no === input.invoiceNo)) {
      throw new Error(`Nomor invoice ${input.invoiceNo} sudah digunakan`)
    }

    let customerId: string | null = null
    let customers = snapshot.tables.customers
    if (input.paymentMethod === 'credit') {
      const name = input.customerName?.trim() || ''
      if (!name) throw new Error('Nama pelanggan wajib diisi untuk transaksi kredit')
      const normalizedName = name.toLocaleLowerCase()
      const existing = customers.find((customer) =>
        String(customer.normalized_name || String(customer.name).trim().toLocaleLowerCase()) === normalizedName,
      )
      if (existing) {
        customerId = String(existing.id)
        customers = customers.map((customer) => customer.id === customerId
          ? { ...customer, name }
          : customer)
      } else {
        customerId = crypto.randomUUID()
        customers = [...customers, {
          id: customerId,
          name,
          normalized_name: normalizedName,
          created_at: createdAt,
        }]
      }
    }

    const nextProducts = new Map(snapshot.tables.products.map((product) => [String(product.id), product]))
    const nextBatches = new Map(snapshot.tables.product_stock_batches.map((batch) => [String(batch.id), batch]))
    const saleItems = []

    for (const item of input.items) {
      const product = nextProducts.get(item.product.id)
      if (!product || product.is_active !== true) {
        throw new Error(`Produk ${item.product.name} tidak ditemukan atau tidak aktif`)
      }
      if (
        !Number.isFinite(item.quantity) ||
        item.quantity <= 0 ||
        !Number.isFinite(item.unit_price) ||
        item.unit_price <= 0
      ) {
        throw new Error(`Jumlah atau harga ${product.name} tidak valid`)
      }
      const configuredPrice = Array.isArray(product.prices)
        ? product.prices.find((price) =>
          price !== null &&
          typeof price === 'object' &&
          !Array.isArray(price) &&
          price.unit === item.unit,
        )
        : undefined
      const configuredConversion = Number(configuredPrice?.conversion)
      const configuredUnitPrice = Number(configuredPrice?.price)
      if (
        !configuredPrice ||
        !Number.isFinite(configuredConversion) ||
        configuredConversion <= 0 ||
        !Number.isFinite(configuredUnitPrice) ||
        configuredUnitPrice <= 0
      ) {
        throw new Error(`Satuan ${item.unit} untuk ${product.name} tidak tersedia di katalog`)
      }
      if (item.conversion !== configuredConversion) {
        throw new Error(`Konversi satuan ${product.name} berubah, muat ulang katalog`)
      }
      if (item.unit_price > configuredUnitPrice) {
        throw new Error(`Harga jual ${product.name} melebihi harga katalog`)
      }
      const stockQuantity = item.quantity * configuredConversion / getStockConversion(product)
      if (!Number.isFinite(stockQuantity) || stockQuantity <= 0 || Number(product.stock) < stockQuantity) {
        throw new Error(`Stok ${item.product.name} tidak mencukupi`)
      }

      let remaining = stockQuantity
      let lineCost = 0
      const fifoBatches = [...nextBatches.values()]
        .filter((batch) => batch.product_id === item.product.id && Number(batch.quantity_remaining) > 0)
        .sort((a, b) =>
          String(a.received_at).localeCompare(String(b.received_at)) ||
          String(a.id).localeCompare(String(b.id)),
        )

      for (const batch of fifoBatches) {
        if (remaining <= 0) break
        const available = Number(batch.quantity_remaining)
        const consumed = Math.min(remaining, available)
        lineCost += consumed * Number(batch.unit_cost)
        remaining -= consumed
        nextBatches.set(String(batch.id), {
          ...batch,
          quantity_remaining: available - consumed,
        })
      }
      if (remaining > 0) throw new Error(`Batch HPP untuk ${item.product.name} tidak mencukupi`)

      const lineTotal = roundMoney(item.unit_price * item.quantity)
      lineCost = roundMoney(lineCost)
      if (lineTotal <= lineCost) {
        throw new Error(`Harga jual ${product.name} harus lebih besar dari HPP FIFO`)
      }
      const lineProfit = roundMoney(lineTotal - lineCost)
      saleItems.push({
        id: crypto.randomUUID(),
        sale_id: saleId,
        product_id: item.product.id,
        product_name: String(product.name),
        unit: item.unit,
        quantity: item.quantity,
        conversion: configuredConversion,
        unit_price: item.unit_price,
        line_total: lineTotal,
        line_cost: lineCost,
        line_profit: lineProfit,
        created_at: createdAt,
      })
      nextProducts.set(item.product.id, {
        ...product,
          stock: Number(product.stock) - stockQuantity,
        updated_at: createdAt,
      })
    }

    const totalAmount = roundMoney(saleItems.reduce((sum, item) => sum + item.line_total, 0))
    const totalCost = roundMoney(saleItems.reduce((sum, item) => sum + item.line_cost, 0))
    const amountPaid = input.paymentMethod === 'credit' ? input.amountPaid : totalAmount
    if (!Number.isFinite(amountPaid) || amountPaid < 0 || amountPaid > totalAmount) {
      throw new Error('Nominal pembayaran tidak valid')
    }

    return {
      snapshot: {
        ...snapshot,
        tables: {
          ...snapshot.tables,
          customers,
          products: snapshot.tables.products.map((product) =>
            nextProducts.get(String(product.id)) || product,
          ),
          product_stock_batches: snapshot.tables.product_stock_batches.map((batch) =>
            nextBatches.get(String(batch.id)) || batch,
          ),
          sales: [...snapshot.tables.sales, {
            id: saleId,
            invoice_no: input.invoiceNo,
            total_amount: totalAmount,
            total_cost: totalCost,
            total_profit: totalAmount - totalCost,
            payment_method: input.paymentMethod,
            notes: null,
            cashier_id: input.cashierId,
            customer_id: customerId,
            amount_paid: amountPaid,
            created_at: createdAt,
          }],
          sale_items: [...snapshot.tables.sale_items, ...saleItems],
        },
      },
      result: saleId,
    }
  })

  return saleId
}
