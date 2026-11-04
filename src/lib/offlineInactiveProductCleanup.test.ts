import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  readOperationalSnapshot,
  writeOperationalSnapshot,
  type OperationalSnapshot,
} from './offlineOperationalSnapshot'
import {
  getInactiveProductDeletionBlockReason,
  permanentlyDeleteUnusedInactiveProduct,
} from './offlineInactiveProductCleanup'

function createSnapshot(overrides: Partial<OperationalSnapshot['tables']> = {}): OperationalSnapshot {
  const tables = Object.fromEntries([
    'categories',
    'vendors',
    'custom_units',
    'products',
    'product_stock_batches',
    'customers',
    'sales',
    'sale_items',
    'vendor_debt_payments',
    'customer_debt_payments',
    'stock_adjustments',
    'sale_returns',
    'settlement_idempotency',
  ].map((table) => [table, []]))

  return {
    format: 'tokobahan-operational-backup',
    version: '3',
    generated_at: '2026-11-04T00:00:00.000Z',
    generated_by: 'admin-1',
    tables: {
      ...tables,
      products: [{ id: 'product-1', is_active: false, stock: 0 }],
      ...overrides,
    } as OperationalSnapshot['tables'],
  }
}

function deleteOfflineDatabase() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('konveksi-pos')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Offline database is still open'))
  })
}

describe('inactive product permanent deletion safety', () => {
  beforeEach(deleteOfflineDatabase)
  afterEach(deleteOfflineDatabase)

  it('allows removing an inactive product with no remaining stock or history', () => {
    expect(getInactiveProductDeletionBlockReason(createSnapshot(), 'product-1')).toBeNull()
  })

  it('blocks deleting active products', () => {
    const snapshot = createSnapshot({
      products: [{ id: 'product-1', is_active: true, stock: 0 }],
    })
    expect(getInactiveProductDeletionBlockReason(snapshot, 'product-1'))
      .toBe('Hanya produk nonaktif yang dapat dihapus permanen')
  })

  it('blocks deleting products with remaining stock', () => {
    const snapshot = createSnapshot({
      products: [{ id: 'product-1', is_active: false, stock: 1 }],
    })
    expect(getInactiveProductDeletionBlockReason(snapshot, 'product-1'))
      .toBe('Stok produk masih tersedia')
  })

  it('blocks deleting products referenced by sales, batches, or stock adjustments', () => {
    const snapshots = [
      createSnapshot({ sale_items: [{ id: 'sale-item-1', product_id: 'product-1' }] }),
      createSnapshot({ product_stock_batches: [{ id: 'batch-1', product_id: 'product-1' }] }),
      createSnapshot({ stock_adjustments: [{ id: 'adjustment-1', product_id: 'product-1' }] }),
    ]

    expect(snapshots.map((snapshot) =>
      getInactiveProductDeletionBlockReason(snapshot, 'product-1'),
    )).toEqual([
      'Produk memiliki riwayat transaksi',
      'Produk memiliki riwayat stok masuk',
      'Produk memiliki riwayat penyesuaian stok',
    ])
  })

  it('permanently removes an eligible item from the local snapshot', async () => {
    await writeOperationalSnapshot(createSnapshot())

    await permanentlyDeleteUnusedInactiveProduct('product-1')

    await expect(readOperationalSnapshot()).resolves.toMatchObject({
      tables: { products: [] },
    })
  })

  it('preserves the local snapshot if deletion is blocked by history', async () => {
    const snapshot = createSnapshot({
      sale_items: [{ id: 'sale-item-1', product_id: 'product-1' }],
    })
    await writeOperationalSnapshot(snapshot)

    await expect(permanentlyDeleteUnusedInactiveProduct('product-1'))
      .rejects.toThrow('Produk memiliki riwayat transaksi')
    await expect(readOperationalSnapshot()).resolves.toMatchObject({
      tables: { products: [{ id: 'product-1' }] },
    })
  })
})
