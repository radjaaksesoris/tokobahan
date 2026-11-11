import { describe, expect, it } from 'vitest'
import {
  OPERATIONAL_SNAPSHOT_TABLES,
  type OperationalSnapshot,
} from './offlineOperationalSnapshot'
import { migrateSnapshotToIntegerStock } from './integerStockMigration'
import { validateOperationalSnapshotIntegrity } from './validateOperationalSnapshotIntegrity'

function createSnapshot(
  products: Record<string, unknown>[],
  batches: Record<string, unknown>[],
): OperationalSnapshot {
  const tables = Object.fromEntries(OPERATIONAL_SNAPSHOT_TABLES.map((table) => [table, []]))
  return {
    format: 'tokobahan-operational-backup',
    version: '3',
    generated_at: '2026-10-01T00:00:00.000Z',
    generated_by: 'admin-1',
    tables: {
      ...tables,
      products,
      product_stock_batches: batches,
    } as OperationalSnapshot['tables'],
  }
}

function rollProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 'product-1',
    name: '420 Htm',
    stock: 1.863,
    stock_unit: 'roll',
    stock_conversion: 44,
    cost_price: 480000,
    cost_unit: 'roll',
    cost_conversion: 44,
    min_stock: 1,
    prices: [
      { unit: 'meter', price: 13000, conversion: 1 },
      { unit: 'roll', price: 525000, conversion: 44 },
    ],
    ...overrides,
  }
}

describe('integer stock migration', () => {
  it('converts roll inventory and batches to whole meters and preserves batch value', () => {
    const snapshot = createSnapshot(
      [rollProduct()],
      [
        {
          id: 'batch-1',
          product_id: 'product-1',
          quantity_received: 1,
          quantity_remaining: 0.863,
          unit_cost: 475000,
          received_at: '2026-10-01T00:00:00.000Z',
        },
        {
          id: 'batch-2',
          product_id: 'product-1',
          quantity_received: 1,
          quantity_remaining: 1,
          unit_cost: 480000,
          received_at: '2026-10-02T00:00:00.000Z',
        },
      ],
    )

    const result = migrateSnapshotToIntegerStock(snapshot, '2026-10-03T00:00:00.000Z', () => 'new-id')

    expect(result.snapshot.tables.products[0]).toMatchObject({
      stock: 82,
      stock_unit: 'meter',
      stock_conversion: 1,
      stock_unit_mode: 'integer-base',
      min_stock: 44,
    })
    expect(result.snapshot.tables.product_stock_batches.map((batch) => [
      batch.quantity_received,
      batch.quantity_remaining,
    ])).toEqual([[44, 38], [44, 44]])
    expect(Number(result.snapshot.tables.product_stock_batches[0].unit_cost) * 44).toBeCloseTo(475000, 0)
    expect(result.snapshot.tables.stock_adjustments).toHaveLength(1)
    expect(result).toMatchObject({
      convertedProducts: 1,
      roundedProducts: 1,
      createdAdjustmentBatches: 0,
      adjustmentRows: 1,
    })
    expect(() => validateOperationalSnapshotIntegrity(result.snapshot)).not.toThrow()
  })

  it('reconciles independently rounded batches to the product stock and records the adjustment', () => {
    const snapshot = createSnapshot(
      [rollProduct({ stock: 0.98 })],
      [
        {
          id: 'batch-1',
          product_id: 'product-1',
          quantity_received: 0.49,
          quantity_remaining: 0.49,
          unit_cost: 480000,
          received_at: '2026-10-01T00:00:00.000Z',
        },
        {
          id: 'batch-2',
          product_id: 'product-1',
          quantity_received: 0.49,
          quantity_remaining: 0.49,
          unit_cost: 480000,
          received_at: '2026-10-02T00:00:00.000Z',
        },
      ],
    )

    const result = migrateSnapshotToIntegerStock(snapshot, '2026-10-03T00:00:00.000Z', () => 'adjustment-batch')

    expect(result.snapshot.tables.products[0].stock).toBe(43)
    expect(result.snapshot.tables.product_stock_batches.map((batch) => batch.quantity_remaining)).toEqual([21, 22])
    expect(result.snapshot.tables.product_stock_batches.reduce((total, batch) =>
      total + Number(batch.quantity_remaining), 0,
    )).toBe(43)
    expect(result.snapshot.tables.stock_adjustments).toHaveLength(1)
  })

  it('rejects conversions that cannot be represented as whole base units without changing the source', () => {
    const snapshot = createSnapshot([
      rollProduct({
        prices: [
          { unit: 'meter', price: 13000, conversion: 1 },
          { unit: 'pack', price: 25000, conversion: 2.5 },
        ],
      }),
    ], [])

    expect(() => migrateSnapshotToIntegerStock(snapshot)).toThrow(
      'konversi pack tidak setara dengan bilangan bulat meter',
    )
    expect(snapshot.tables.products[0].stock_unit).toBe('roll')
  })

  it('does not migrate already normalized products twice', () => {
    const snapshot = createSnapshot([
      rollProduct({
        stock: 82,
        stock_unit: 'meter',
        stock_conversion: 1,
        stock_unit_mode: 'integer-base',
      }),
    ], [])

    const result = migrateSnapshotToIntegerStock(snapshot)

    expect(result.convertedProducts).toBe(0)
    expect(result.snapshot).toBe(snapshot)
  })

  it('rounds decimal values in products already marked as integer-base', () => {
    const snapshot = createSnapshot([
      rollProduct({
        stock: 3.4,
        stock_unit: 'meter',
        stock_conversion: 1,
        stock_unit_mode: 'integer-base',
      }),
    ], [{
      id: 'batch-1',
      product_id: 'product-1',
      quantity_received: 4.4,
      quantity_remaining: 3.4,
      unit_cost: 10,
      received_at: '2026-10-01T00:00:00.000Z',
    }])

    const result = migrateSnapshotToIntegerStock(snapshot)

    expect(result.snapshot.tables.products[0].stock).toBe(3)
    expect(result.snapshot.tables.product_stock_batches[0]).toMatchObject({
      quantity_received: 4,
      quantity_remaining: 3,
    })
    expect(result.convertedProducts).toBe(1)
  })
})
