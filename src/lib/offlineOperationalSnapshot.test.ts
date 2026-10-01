import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearOperationalSnapshot,
  OFFLINE_OPERATIONAL_SNAPSHOT_STORE,
  readOperationalSnapshot,
  writeOperationalSnapshot,
} from './offlineOperationalSnapshot'

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
    const snapshot = {
      products: [{ id: 'product-1', name: 'Kain' }],
      inventory: [{ id: 'batch-1', quantity: 12 }],
    }

    await expect(readOperationalSnapshot()).resolves.toBeNull()
    await writeOperationalSnapshot(snapshot)
    await expect(readOperationalSnapshot()).resolves.toEqual(snapshot)

    const replacement = { products: [{ id: 'product-2', name: 'Benang' }] }
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
})
