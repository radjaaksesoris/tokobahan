import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearOperationalSnapshot,
  beginOperationalSnapshotSync,
  endOperationalSnapshotSync,
  OFFLINE_OPERATIONAL_SNAPSHOT_STORE,
  OPERATIONAL_SNAPSHOT_TABLES,
  readOperationalSnapshot,
  updateOperationalSnapshot,
  type OperationalSnapshot,
  validateOperationalSnapshot,
  writeOperationalSnapshot,
} from './offlineOperationalSnapshot'

function createSnapshot(overrides: Partial<OperationalSnapshot['tables']> = {}): OperationalSnapshot {
  const tables = Object.fromEntries(OPERATIONAL_SNAPSHOT_TABLES.map((table) => [table, []]))
  return {
    format: 'tokobahan-operational-backup',
    version: '3',
    generated_at: '2026-10-01T00:00:00.000Z',
    generated_by: 'admin-1',
    tables: { ...tables, ...overrides } as OperationalSnapshot['tables'],
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

describe('offline operational snapshot storage', () => {
  beforeEach(deleteOfflineDatabase)
  afterEach(async () => {
    vi.unstubAllGlobals()
    await deleteOfflineDatabase()
  })

  it('reads, replaces, and clears the single operational snapshot', async () => {
    const snapshot = createSnapshot({
      products: [{ id: 'product-1', name: 'Kain' }],
      product_stock_batches: [{ id: 'batch-1', quantity_remaining: 12 }],
    })

    await expect(readOperationalSnapshot()).resolves.toBeNull()
    await writeOperationalSnapshot(snapshot)
    await expect(readOperationalSnapshot()).resolves.toEqual(snapshot)

    const replacement = createSnapshot({
      products: [{ id: 'product-2', name: 'Benang' }],
    })
    await writeOperationalSnapshot(replacement)
    await expect(readOperationalSnapshot()).resolves.toEqual(replacement)

    await clearOperationalSnapshot()
    await expect(readOperationalSnapshot()).resolves.toBeNull()
  })

  it('upgrades a version 2 database without losing its existing queues', async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('konveksi-pos', 2)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('offline-transactions', { keyPath: 'id' })
        request.result.createObjectStore('offline-settlements', { keyPath: 'id' })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction(
      ['offline-transactions', 'offline-settlements'],
      'readwrite',
    )
    transaction.objectStore('offline-transactions').put({ id: 'transaction-1' })
    transaction.objectStore('offline-settlements').put({ id: 'settlement-1' })
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()

    await expect(readOperationalSnapshot()).resolves.toBeNull()
    const upgraded = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('konveksi-pos', 3)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    expect(upgraded.objectStoreNames.contains(OFFLINE_OPERATIONAL_SNAPSHOT_STORE)).toBe(true)
    const queues = upgraded.transaction(
      ['offline-transactions', 'offline-settlements'],
      'readonly',
    )
    const transactionRows = await new Promise<unknown[]>((resolve, reject) => {
      const request = queues.objectStore('offline-transactions').getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const settlementRows = await new Promise<unknown[]>((resolve, reject) => {
      const request = queues.objectStore('offline-settlements').getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    upgraded.close()

    expect(transactionRows).toEqual([{ id: 'transaction-1' }])
    expect(settlementRows).toEqual([{ id: 'settlement-1' }])
  })

  it('rejects with an explicit error when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined)

    await expect(readOperationalSnapshot()).rejects.toThrow(
      'Penyimpanan offline tidak tersedia di browser ini',
    )
  })

  it('requires a complete supported backup payload before sync', () => {
    const snapshot = createSnapshot()
    const tables = snapshot.tables

    expect(validateOperationalSnapshot(snapshot)).toEqual(snapshot)
    expect(() => validateOperationalSnapshot({ ...snapshot, tables: { ...tables, sales: undefined } }))
      .toThrow('Data tabel sales tidak lengkap atau tidak valid')
    expect(() => validateOperationalSnapshot({ ...snapshot, version: '2' }))
      .toThrow('Format atau versi snapshot operasional tidak didukung')
    expect(() => validateOperationalSnapshot({
      ...snapshot,
      tables: { ...tables, products: [{ id: 'p1' }, null] },
    })).toThrow('Data tabel products tidak lengkap atau tidak valid')
  })

  it('updates a complete snapshot atomically and rejects an uninitialized store', async () => {
    await expect(updateOperationalSnapshot((current) => ({
      snapshot: current,
      result: true,
    }))).rejects.toThrow('Snapshot lokal belum diinisialisasi')

    await writeOperationalSnapshot(createSnapshot())
    await expect(updateOperationalSnapshot((current) => ({
      snapshot: {
        ...current,
        tables: {
          ...current.tables,
          products: [{ id: 'product-1', name: 'Benang', stock: 10 }],
        },
      },
      result: 'saved',
    }))).resolves.toBe('saved')
    await expect(readOperationalSnapshot()).resolves.toMatchObject({
      tables: { products: [{ id: 'product-1', name: 'Benang', stock: 10 }] },
    })
  })

  it('locks local writes while a snapshot is being synchronized', async () => {
    const snapshot = createSnapshot()
    await writeOperationalSnapshot(snapshot)

    await expect(beginOperationalSnapshotSync()).resolves.toEqual(snapshot)
    await expect(beginOperationalSnapshotSync()).rejects.toThrow('Sinkronisasi snapshot sedang berjalan')
    await expect(updateOperationalSnapshot((current) => ({
      snapshot: current,
      result: undefined,
    }))).rejects.toThrow('Snapshot sedang disinkronkan dan tidak dapat diubah')
    await expect(clearOperationalSnapshot()).rejects.toThrow('Snapshot sedang disinkronkan dan belum dapat dihapus')

    await endOperationalSnapshotSync()
    await expect(updateOperationalSnapshot((current) => ({
      snapshot: current,
      result: 'unlocked',
    }))).resolves.toBe('unlocked')
  })
})
