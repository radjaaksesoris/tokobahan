import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  readOperationalSnapshot,
  writeOperationalSnapshot,
  type OperationalSnapshot,
} from '@/lib/offlineOperationalSnapshot'
import {
  deleteOperationalRows,
  readOperationalTable,
  upsertOperationalRows,
} from './offlineOperationalRepository'

const snapshot: OperationalSnapshot = {
  format: 'tokobahan-operational-backup',
  version: '3',
  generated_at: '2026-10-01T00:00:00.000Z',
  generated_by: 'admin-1',
  tables: {
    categories: [],
    vendors: [],
    custom_units: [],
    products: [],
    product_stock_batches: [],
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

describe('offline operational repository', () => {
  beforeEach(deleteOfflineDatabase)
  afterEach(deleteOfflineDatabase)

  it('reads only initialized local operational data', async () => {
    await expect(readOperationalTable('products')).rejects.toThrow('Snapshot lokal belum diinisialisasi')
    await writeOperationalSnapshot({
      ...snapshot,
      tables: { ...snapshot.tables, products: [{ id: 'p1', name: 'Benang' }] },
    })
    await expect(readOperationalTable('products')).resolves.toEqual([{ id: 'p1', name: 'Benang' }])
  })

  it('upserts rows by stable ID and reports inserted and updated counts', async () => {
    await writeOperationalSnapshot({
      ...snapshot,
      tables: { ...snapshot.tables, products: [{ id: 'p1', name: 'Benang', stock: 10 }] },
    })
    await expect(upsertOperationalRows('products', [
      { id: 'p1', name: 'Benang', stock: 5 },
      { id: 'p2', name: 'Kain' },
    ])).resolves.toEqual({ inserted: 1, updated: 1 })
    await expect(readOperationalSnapshot()).resolves.toMatchObject({
      tables: { products: [
        { id: 'p1', name: 'Benang', stock: 5 },
        { id: 'p2', name: 'Kain' },
      ] },
    })
  })

  it('deletes only requested IDs from a local table', async () => {
    await writeOperationalSnapshot({
      ...snapshot,
      tables: { ...snapshot.tables, products: [{ id: 'p1' }, { id: 'p2' }] },
    })
    await expect(deleteOperationalRows('products', ['p1', 'missing'])).resolves.toBe(1)
    await expect(readOperationalTable('products')).resolves.toEqual([{ id: 'p2' }])
  })
})
