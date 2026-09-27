import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc },
}))

import { readOfflineCache, writeOfflineCache } from './offlineCache'
import { enqueueSettlement, getQueuedSettlements } from './offlineSettlements'
import { enqueueTransaction, getQueuedTransactions } from './offlineTransactions'
import { prepareOfflineQueuesForSync } from './offlineQueueReset'

const RESET_GENERATION_KEY = 'konveksi-pos:operational-reset-generation'

function deleteOfflineDatabase() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('konveksi-pos')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Offline database is still open'))
  })
}

function createStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, String(value)) },
  }
}

describe('offline queue reset generation', () => {
  beforeEach(async () => {
    vi.stubGlobal('navigator', { onLine: true })
    const storage = createStorage()
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('window', { localStorage: storage })
    await deleteOfflineDatabase()
    window.localStorage.clear()
    vi.clearAllMocks()
    rpc.mockResolvedValue({ data: 0, error: null })
  })

  afterEach(async () => {
    window.localStorage.clear()
    await deleteOfflineDatabase()
    vi.unstubAllGlobals()
  })

  it('discards offline data when the server reset generation changes', async () => {
    window.localStorage.setItem(RESET_GENERATION_KEY, '0')
    await enqueueTransaction({
      invoiceNo: 'OFF-TEST',
      totalAmount: 1200,
      totalCost: 800,
      totalProfit: 400,
      paymentMethod: 'cash',
      customerName: null,
      amountPaid: 1200,
      cashierId: 'admin-1',
      items: [],
    })
    await enqueueSettlement('customer', { sale_id: 'sale-1', amount: 100 }, 'admin-1')
    writeOfflineCache('products', [{ id: 'product-1' }])
    rpc.mockResolvedValue({ data: 1, error: null })

    await expect(prepareOfflineQueuesForSync()).resolves.toBe(true)

    expect(await getQueuedTransactions()).toEqual([])
    expect(await getQueuedSettlements()).toEqual([])
    expect(readOfflineCache('products')).toBeNull()
    expect(window.localStorage.getItem(RESET_GENERATION_KEY)).toBe('1')
  })

  it('preserves existing queues before the first server reset', async () => {
    await enqueueTransaction({
      invoiceNo: 'OFF-TEST',
      totalAmount: 1200,
      totalCost: 800,
      totalProfit: 400,
      paymentMethod: 'cash',
      customerName: null,
      amountPaid: 1200,
      cashierId: 'admin-1',
      items: [],
    })

    await expect(prepareOfflineQueuesForSync()).resolves.toBe(true)

    expect(await getQueuedTransactions()).toHaveLength(1)
    expect(window.localStorage.getItem(RESET_GENERATION_KEY)).toBe('0')
  })

  it('does not check or sync queues while offline', async () => {
    vi.stubGlobal('navigator', { onLine: false })

    await expect(prepareOfflineQueuesForSync()).resolves.toBe(false)

    expect(rpc).not.toHaveBeenCalled()
  })
})
