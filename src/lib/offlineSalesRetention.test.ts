import { describe, expect, it } from 'vitest'
import type { OperationalSnapshot } from '@/lib/offlineOperationalSnapshot'
import { pruneOperationalSales } from './offlineSalesRetention'

function createSnapshot(sales: Record<string, unknown>[]): OperationalSnapshot {
  return {
    format: 'tokobahan-operational-backup',
    version: '3',
    generated_at: '2026-11-02T00:00:00.000Z',
    generated_by: 'admin',
    tables: {
      categories: [],
      vendors: [],
      custom_units: [],
      products: [],
      product_stock_batches: [],
      customers: [],
      sales,
      sale_items: sales.map((sale) => ({ id: `item-${sale.id}`, sale_id: sale.id })),
      vendor_debt_payments: [],
      customer_debt_payments: [],
      stock_adjustments: [],
      sale_returns: sales.map((sale) => ({
        id: `return-${sale.id}`,
        sale_id: sale.id,
        sale_item_id: `item-${sale.id}`,
      })),
      settlement_idempotency: [],
    },
  }
}

function cashSale(id: number) {
  return {
    id: `sale-${id}`,
    invoice_no: `INV-${id}`,
    total_amount: 100,
    amount_paid: 100,
    payment_method: 'cash',
    created_at: new Date(Date.UTC(2026, 0, id)).toISOString(),
  }
}

describe('pruneOperationalSales', () => {
  it('retains the newest paid sales and removes their dependent rows', () => {
    const snapshot = createSnapshot(Array.from({ length: 502 }, (_, index) => cashSale(index + 1)))

    const result = pruneOperationalSales(snapshot)

    expect(result.tables.sales).toHaveLength(500)
    expect(result.tables.sales.some((sale) => sale.id === 'sale-502')).toBe(true)
    expect(result.tables.sales.some((sale) => sale.id === 'sale-3')).toBe(true)
    expect(result.tables.sales.some((sale) => sale.id === 'sale-1')).toBe(false)
    expect(result.tables.sales.some((sale) => sale.id === 'sale-2')).toBe(false)
    expect(result.tables.sale_items).toHaveLength(500)
    expect(result.tables.sale_returns).toHaveLength(500)
    expect(result).not.toBe(snapshot)
  })

  it('preserves every unpaid credit sale even when the total exceeds the limit', () => {
    const sales = [
      ...Array.from({ length: 501 }, (_, index) => cashSale(index + 1)),
      {
        ...cashSale(502),
        payment_method: 'credit',
        amount_paid: 25,
      },
    ]
    const snapshot = createSnapshot(sales)

    const result = pruneOperationalSales(snapshot)

    expect(result.tables.sales).toHaveLength(501)
    expect(result.tables.sales.some((sale) => sale.id === 'sale-502')).toBe(true)
    expect(result.tables.sales.some((sale) => sale.id === 'sale-1')).toBe(false)
  })

  it('considers recorded debt payments before retaining a credit sale', () => {
    const snapshot = createSnapshot([
      ...Array.from({ length: 501 }, (_, index) => cashSale(index + 1)),
      {
        ...cashSale(502),
        payment_method: 'credit',
        amount_paid: 25,
      },
    ])
    snapshot.tables.customer_debt_payments.push({
      id: 'payment-502',
      sale_id: 'sale-502',
      amount: 75,
    })

    const result = pruneOperationalSales(snapshot)

    expect(result.tables.sales).toHaveLength(500)
    expect(result.tables.sales.some((sale) => sale.id === 'sale-502')).toBe(true)
    expect(result.tables.customer_debt_payments).toHaveLength(1)
  })
})
