import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearOfflineOperationalData } from './offlineOperationalData'

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('konveksi-pos', 3)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains('offline-transactions')) {
        database.createObjectStore('offline-transactions', { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains('offline-settlements')) {
        database.createObjectStore('offline-settlements', { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains('offline-operational-snapshot')) {
        database.createObjectStore('offline-operational-snapshot', { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function clearDatabase() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('konveksi-pos')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Offline database is still open'))
  })
}

describe('clear offline operational data', () => {
  beforeEach(async () => {
    await clearDatabase()
  })

  afterEach(async () => {
    await clearDatabase()
  })

  it('clears transaction and settlement queues together', async () => {
    const database = await openDatabase()
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

    await clearOfflineOperationalData()

    const result = await openDatabase()
    const read = result.transaction(
      ['offline-transactions', 'offline-settlements'],
      'readonly',
    )
    const transactionRows = await new Promise<unknown[]>((resolve, reject) => {
      const request = read.objectStore('offline-transactions').getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const settlementRows = await new Promise<unknown[]>((resolve, reject) => {
      const request = read.objectStore('offline-settlements').getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    result.close()

    expect(transactionRows).toEqual([])
    expect(settlementRows).toEqual([])
  })
})
