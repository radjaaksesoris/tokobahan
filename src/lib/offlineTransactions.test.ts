import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createOfflineInvoice } from './offlineInvoice'
import { getQueuedTransactions } from './offlineTransactions'

function deleteOfflineDatabase() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('konveksi-pos')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Offline transaction database is still open'))
  })
}

async function storeLegacyTransaction() {
  await getQueuedTransactions()
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('konveksi-pos')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('offline-transactions', 'readwrite')
    transaction.objectStore('offline-transactions').put({
      id: 'legacy-transaction',
      invoiceNo: 'RJA-260101-12345678',
      totalAmount: 1200,
      totalCost: 800,
      totalProfit: 400,
      paymentMethod: 'cash',
      customerName: null,
      amountPaid: 1200,
      cashierId: 'cashier-1',
      items: [],
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

describe('legacy offline transactions', () => {
  beforeEach(async () => {
    await deleteOfflineDatabase()
  })

  afterEach(async () => {
    await deleteOfflineDatabase()
  })

  it('creates sequential five-digit local invoice numbers', async () => {
    const invoice = await createOfflineInvoice()
    expect(invoice).toMatch(/^RJA-\d{5}$/)
    expect(invoice).toHaveLength(9)
  })

  it('keeps legacy queued checkouts readable without syncing or deleting them', async () => {
    await storeLegacyTransaction()

    expect(await getQueuedTransactions()).toMatchObject([
      { id: 'legacy-transaction', status: 'pending' },
    ])
  })
})
