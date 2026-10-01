import { describe, expect, it } from 'vitest'
import {
  OPERATIONAL_SNAPSHOT_TABLES,
  type OperationalSnapshot,
} from './offlineOperationalSnapshot'
import { validateOperationalSnapshotIntegrity } from './validateOperationalSnapshotIntegrity'

function createSnapshot(overrides: Partial<OperationalSnapshot['tables']> = {}): OperationalSnapshot {
  const tables = Object.fromEntries(OPERATIONAL_SNAPSHOT_TABLES.map((table) => [table, []]))
  return {
    format: 'tokobahan-operational-backup',
    version: '3',
    generated_at: '2026-10-01T00:00:00.000Z',
    generated_by: 'admin-1',
    server_revision: '1',
    tables: { ...tables, ...overrides } as OperationalSnapshot['tables'],
  }
}

describe('operational snapshot integrity', () => {
  it('accepts a snapshot with consistent product, stock batch and vendor references', () => {
    const snapshot = createSnapshot({
      vendors: [{ id: 'vendor-1', name: 'Vendor' }],
      products: [{ id: 'product-1', stock: 2, cost_price: 5, category_id: null }],
      product_stock_batches: [{
        id: 'batch-1',
        product_id: 'product-1',
        vendor_id: 'vendor-1',
        quantity_received: 2,
        quantity_remaining: 1,
        unit_cost: 5,
      }],
    })

    expect(validateOperationalSnapshotIntegrity(snapshot)).toBe(snapshot)
  })

  it('rejects a stock batch that references a missing product', () => {
    const snapshot = createSnapshot({
      product_stock_batches: [{
        id: 'batch-1',
        product_id: 'missing-product',
        quantity_received: 2,
        quantity_remaining: 1,
        unit_cost: 5,
      }],
    })

    expect(() => validateOperationalSnapshotIntegrity(snapshot))
      .toThrow('relasi produk batch stok tidak ditemukan')
  })

  it('rejects a return whose sale item belongs to a different sale', () => {
    const snapshot = createSnapshot({
      products: [{ id: 'product-1', stock: 1, cost_price: 5, category_id: null }],
      sales: [
        { id: 'sale-1', total_amount: 10, amount_paid: 10, customer_id: null },
        { id: 'sale-2', total_amount: 10, amount_paid: 10, customer_id: null },
      ],
      sale_items: [{
        id: 'item-1',
        sale_id: 'sale-1',
        product_id: 'product-1',
        quantity: 1,
        unit_price: 10,
      }],
      sale_returns: [{
        id: 'return-1',
        sale_id: 'sale-2',
        sale_item_id: 'item-1',
        quantity: 1,
        refund_amount: 10,
        cash_refund_amount: 10,
      }],
    })

    expect(() => validateOperationalSnapshotIntegrity(snapshot))
      .toThrow('item transaksi retur tidak sesuai')
  })

  it('rejects duplicate identifiers before syncing', () => {
    const snapshot = createSnapshot({
      vendors: [
        { id: 'vendor-1', name: 'Vendor A' },
        { id: 'vendor-1', name: 'Vendor B' },
      ],
    })

    expect(() => validateOperationalSnapshotIntegrity(snapshot))
      .toThrow('ID vendors duplikat')
  })
})
