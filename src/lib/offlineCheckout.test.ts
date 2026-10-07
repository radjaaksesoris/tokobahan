import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CartItem, Product } from '@/types'
import {
  readOperationalSnapshot,
  writeOperationalSnapshot,
  type OperationalSnapshot,
} from './offlineOperationalSnapshot'
import { saveOfflineCheckout } from './offlineCheckout'

const product: Product = {
  id: 'product-1',
  name: 'Benang',
  sku: 'B-1',
  barcode: null,
  category_id: null,
  cost_price: 4,
  cost_unit: 'satuan',
  cost_conversion: 1,
  stock: 10,
  stock_unit: 'satuan',
  stock_conversion: 1,
  min_stock: 1,
  unit_base: 'pcs',
  prices: [
    { unit: 'satuan', price: 10, conversion: 1 },
    { unit: 'lusin', price: 120, conversion: 12 },
  ],
  image_url: null,
  is_active: true,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
}

const item: CartItem = {
  product,
  unit: 'satuan',
  quantity: 3,
  unit_price: 10,
  conversion: 1,
  line_total: 30,
  line_cost: 12,
  line_profit: 18,
}

const snapshot: OperationalSnapshot = {
  format: 'tokobahan-operational-backup',
  version: '3',
  generated_at: '2026-10-01T00:00:00.000Z',
  generated_by: 'admin-1',
  tables: {
    categories: [],
    vendors: [],
    custom_units: [],
    products: [{ ...product }],
    product_stock_batches: [
      { id: 'batch-1', product_id: product.id, quantity_remaining: 2, quantity_received: 2, unit_cost: 2, received_at: '2026-09-01T00:00:00.000Z' },
      { id: 'batch-2', product_id: product.id, quantity_remaining: 8, quantity_received: 8, unit_cost: 4, received_at: '2026-09-02T00:00:00.000Z' },
    ],
    customers: [],
    sales: [],
    sale_items: [],
    vendor_debt_payments: [],
    customer_debt_payments: [],
    stock_adjustments: [],
    sale_returns: [],
    settlement_idempotency: [],
  },
}

function deleteOfflineDatabase() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('konveksi-pos')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Offline database is still open'))
  })
}

describe('offline checkout', () => {
  beforeEach(async () => {
    await deleteOfflineDatabase()
    await writeOperationalSnapshot(snapshot)
  })
  afterEach(deleteOfflineDatabase)

  it('saves sales locally and consumes FIFO stock batches atomically', async () => {
    await saveOfflineCheckout({
      invoiceNo: 'OFF-TEST-1',
      items: [item],
      paymentMethod: 'credit',
      customerName: 'Pelanggan Satu',
      amountPaid: 10,
      cashierId: 'admin-1',
    })

    const updated = await readOperationalSnapshot()
    expect(updated?.tables.products[0].stock).toBe(7)
    expect(updated?.tables.product_stock_batches.map((batch) => batch.quantity_remaining)).toEqual([0, 7])
    expect(updated?.tables.sales[0]).toMatchObject({
      invoice_no: 'OFF-TEST-1',
      total_amount: 30,
      total_cost: 8,
      total_profit: 22,
      payment_method: 'credit',
      amount_paid: 10,
    })
    expect(updated?.tables.customers[0]).toMatchObject({
      name: 'Pelanggan Satu',
      normalized_name: 'pelanggan satu',
    })
    expect(updated?.tables.sale_items[0]).toMatchObject({
      line_cost: 8,
      line_profit: 22,
    })
  })

  it.each(['transfer', 'qris'] as const)(
    'saves a fully-paid %s transaction without creating a credit customer',
    async (paymentMethod) => {
      await saveOfflineCheckout({
        invoiceNo: `OFF-${paymentMethod.toUpperCase()}-1`,
        items: [item],
        paymentMethod,
        customerName: null,
        amountPaid: 30,
        cashierId: 'admin-1',
      })

      await expect(readOperationalSnapshot()).resolves.toMatchObject({
        tables: {
          sales: [{
            payment_method: paymentMethod,
            amount_paid: 30,
            customer_id: null,
          }],
          customers: [],
        },
      })
    },
  )

  it('deducts stock proportionally to the selected unit conversion', async () => {
    const dozen: CartItem = {
      ...item,
      unit: 'lusin',
      quantity: 1,
      unit_price: 120,
      conversion: 12,
      line_total: 120,
      line_cost: 4,
      line_profit: 116,
    }

    await writeOperationalSnapshot({
      ...snapshot,
      tables: {
        ...snapshot.tables,
        products: [{ ...product, stock: 24 }],
        product_stock_batches: [
          { id: 'batch-1', product_id: product.id, quantity_remaining: 2, quantity_received: 2, unit_cost: 2, received_at: '2026-09-01T00:00:00.000Z' },
          { id: 'batch-2', product_id: product.id, quantity_remaining: 22, quantity_received: 22, unit_cost: 4, received_at: '2026-09-02T00:00:00.000Z' },
        ],
      },
    })

    await saveOfflineCheckout({
      invoiceNo: 'OFF-DOZEN-1',
      items: [dozen],
      paymentMethod: 'cash',
      customerName: null,
      amountPaid: 120,
      cashierId: 'admin-1',
    })

    const updated = await readOperationalSnapshot()
    expect(updated?.tables.products[0].stock).toBe(12)
    expect(updated?.tables.product_stock_batches.map((batch) => batch.quantity_remaining)).toEqual([0, 12])
    expect(updated?.tables.sale_items[0]).toMatchObject({
      quantity: 1,
      unit: 'lusin',
      conversion: 12,
    })
  })

  it('keeps repeated fractional stock deductions at three-decimal precision', async () => {
    const convertedProduct = {
      ...product,
      stock: 10,
      stock_conversion: 2.54,
    }
    const convertedItem: CartItem = {
      ...item,
      product: convertedProduct,
      unit: 'lusin',
      quantity: 0.1,
      unit_price: 120,
      conversion: 12,
      line_total: 12,
      line_cost: 0.4,
      line_profit: 11.6,
    }
    await writeOperationalSnapshot({
      ...snapshot,
      tables: {
        ...snapshot.tables,
        products: [convertedProduct],
        product_stock_batches: [{
          id: 'batch-1',
          product_id: product.id,
          quantity_remaining: 10,
          quantity_received: 10,
          unit_cost: 1,
          received_at: '2026-09-01T00:00:00.000Z',
        }],
      },
    })

    for (const invoiceNo of ['OFF-FRACTIONAL-1', 'OFF-FRACTIONAL-2']) {
      await saveOfflineCheckout({
        invoiceNo,
        items: [convertedItem],
        paymentMethod: 'cash',
        customerName: null,
        amountPaid: 12,
        cashierId: 'admin-1',
      })
    }

    await expect(readOperationalSnapshot()).resolves.toMatchObject({
      tables: {
        products: [{ stock: 9.056 }],
        product_stock_batches: [{ quantity_remaining: 9.056 }],
      },
    })
  })

  it('rejects stale catalog prices and conversions without changing stock', async () => {
    await expect(saveOfflineCheckout({
      invoiceNo: 'OFF-STALE-PRICE',
      items: [{ ...item, unit_price: 11, line_total: 33 }],
      paymentMethod: 'cash',
      customerName: null,
      amountPaid: 33,
      cashierId: 'admin-1',
    })).rejects.toThrow('melebihi harga katalog')

    await expect(saveOfflineCheckout({
      invoiceNo: 'OFF-STALE-CONVERSION',
      items: [{ ...item, conversion: 12 }],
      paymentMethod: 'cash',
      customerName: null,
      amountPaid: 30,
      cashierId: 'admin-1',
    })).rejects.toThrow('Konversi satuan')

    await expect(readOperationalSnapshot()).resolves.toMatchObject({
      tables: {
        products: [{ stock: 10 }],
        product_stock_batches: [{ quantity_remaining: 2 }, { quantity_remaining: 8 }],
        sales: [],
      },
    })
  })

  it('does not partially update stock when the FIFO batches are incomplete', async () => {
    const incomplete = {
      ...snapshot,
      tables: {
        ...snapshot.tables,
        product_stock_batches: [snapshot.tables.product_stock_batches[0]],
      },
    }
    await writeOperationalSnapshot(incomplete)

    await expect(saveOfflineCheckout({
      invoiceNo: 'OFF-TEST-2',
      items: [item],
      paymentMethod: 'cash',
      customerName: null,
      amountPaid: 30,
      cashierId: 'admin-1',
    })).rejects.toThrow('Batch HPP untuk Benang tidak mencukupi')
    await expect(readOperationalSnapshot()).resolves.toMatchObject({
      tables: {
        products: [{ stock: 10 }],
        product_stock_batches: [{ quantity_remaining: 2 }],
        sales: [],
      },
    })
  })
})
