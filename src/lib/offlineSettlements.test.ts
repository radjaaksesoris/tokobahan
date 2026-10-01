import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getQueuedSettlements } from './offlineSettlements'

function deleteOfflineDatabase() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('konveksi-pos')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Offline settlement database is still open'))
  })
}

async function storeLegacySettlement() {
  await getQueuedSettlements()
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('konveksi-pos')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('offline-settlements', 'readwrite')
    transaction.objectStore('offline-settlements').put({
      id: 'legacy-settlement',
      userId: 'admin-1',
      kind: 'customer',
      payload: { sale_id: 'sale-1', amount: 2500 },
      status: 'pending',
      attempts: 0,
      lastError: null,
      createdAt: new Date().toISOString(),
    })
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  database.close()
}

describe('legacy offline settlements', () => {
  beforeEach(async () => {
    await deleteOfflineDatabase()
  })

  afterEach(async () => {
    await deleteOfflineDatabase()
  })

  it('keeps legacy queued settlements readable without syncing or deleting them', async () => {
    await storeLegacySettlement()

    expect(await getQueuedSettlements()).toMatchObject([
      { id: 'legacy-settlement', status: 'pending' },
    ])
  })
})
