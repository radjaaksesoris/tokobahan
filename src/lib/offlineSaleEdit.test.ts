import { describe, expect, it } from 'vitest'
import type { Product } from '@/types'
import type { OperationalSnapshot } from './offlineOperationalSnapshot'
import { applyOfflineSaleEdit } from './offlineSaleEdit'

const product: Product = {
  id: 'product-1',
  name: 'Benang',
  sku: 'B-1',
  barcode: null,
  category_id: null,
  cost_price: 4,
  cost_unit: 'satuan',
  cost_conversion: 1,
  stock: 7,
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
      { id: 'batch-1', product_id: product.id, quantity_remaining: 0, quantity_received: 2, unit_cost: 2, received_at: '2026-09-01T00:00:00.000Z' },
      { id: 'batch-2', product_id: product.id, quantity_remaining: 7, quantity_received: 8, unit_cost: 4, received_at: '2026-09-02T00:00:00.000Z' },
    ],
    customers: [{ id: 'customer-1', name: 'Pelanggan', normalized_name: 'pelanggan', created_at: '2026-09-01T00:00:00.000Z' }],
    sales: [{
      id: 'sale-1',
      invoice_no: 'INV-1',
      total_amount: 30,
      total_cost: 8,
      total_profit: 22,
      payment_method: 'cash',
      notes: null,
      cashier_id: 'admin-1',
      customer_id: null,
      amount_paid: 30,
      created_at: '2026-10-01T00:00:00.000Z',
    }],
    sale_items: [{
      id: 'sale-item-1',
      sale_id: 'sale-1',
      product_id: 'product-1',
      product_name: 'Benang',
      unit: 'satuan',
      quantity: 3,
      conversion: 1,
      unit_price: 10,
      line_total: 30,
      line_cost: 8,
      line_profit: 22,
      created_at: '2026-10-01T00:00:00.000Z',
    }],
    vendor_debt_payments: [],
    customer_debt_payments: [],
    stock_adjustments: [],
    sale_returns: [],
    settlement_idempotency: [],
  },
}

const edit = {
  saleId: 'sale-1',
  items: [{
    sourceItemId: 'sale-item-1',
    productId: 'product-1',
    unit: 'satuan',
    quantity: 3,
    unitPrice: 12,
  }],
  paymentMethod: 'cash' as const,
  customerName: '',
}

describe('offline transaction editing', () => {
  it('updates sale totals without changing stock when only price changes', () => {
    const result = applyOfflineSaleEdit(snapshot, edit)

    expect(result.sale).toMatchObject({
      total_amount: 36,
      total_cost: 8,
      total_profit: 28,
    })
    expect(result.snapshot.tables.products[0].stock).toBe(7)
    expect(result.items[0].line_total).toBe(36)
  })

  it('restores stock and historical cost when quantity is reduced', () => {
    const result = applyOfflineSaleEdit(snapshot, {
      ...edit,
      items: [{ ...edit.items[0], quantity: 2 }],
    })

    expect(result.snapshot.tables.products[0].stock).toBe(8)
    expect(result.items[0].quantity).toBe(2)
    expect(result.snapshot.tables.product_stock_batches).toHaveLength(3)
    expect(result.sale.total_cost).toBeCloseTo(5.33, 2)
  })

  it('consumes FIFO stock and updates cost when quantity is increased', () => {
    const result = applyOfflineSaleEdit(snapshot, {
      ...edit,
      items: [{ ...edit.items[0], quantity: 4 }],
    })

    expect(result.snapshot.tables.products[0].stock).toBe(6)
    expect(result.snapshot.tables.product_stock_batches[1].quantity_remaining).toBe(6)
    expect(result.sale.total_cost).toBe(12)
    expect(result.sale.total_profit).toBe(36)
  })

  it('rejects editing transactions that already have returns or debt payments', () => {
    expect(() => applyOfflineSaleEdit({
      ...snapshot,
      tables: {
        ...snapshot.tables,
        sale_returns: [{ id: 'return-1', sale_id: 'sale-1', sale_item_id: 'sale-item-1' }],
      },
    }, edit)).toThrow('retur')

    expect(() => applyOfflineSaleEdit({
      ...snapshot,
      tables: {
        ...snapshot.tables,
        customer_debt_payments: [{ id: 'payment-1', sale_id: 'sale-1', amount: 2 }],
      },
    }, edit)).toThrow('cicilan')
  })

  it('does not turn unpaid credit into paid cash during a correction', () => {
    const creditSnapshot = {
      ...snapshot,
      tables: {
        ...snapshot.tables,
        sales: snapshot.tables.sales.map((sale) => ({
          ...sale,
          payment_method: 'credit',
          amount_paid: 10,
          total_amount: 30,
        })),
      },
    }

    expect(() => applyOfflineSaleEdit(creditSnapshot, {
      ...edit,
      paymentMethod: 'cash',
    })).toThrow('Sisa hutang belum lunas')
  })

  it('resets payment to zero when changing a fully-paid sale to credit', () => {
    const result = applyOfflineSaleEdit(snapshot, {
      ...edit,
      paymentMethod: 'credit',
      customerName: 'Pelanggan',
    })

    expect(result.sale).toMatchObject({
      payment_method: 'credit',
      customer_id: 'customer-1',
      amount_paid: 0,
    })
  })
})
