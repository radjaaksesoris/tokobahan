import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc },
}))

import {
  enqueueSettlement,
  getQueuedSettlements,
  retryFailedSettlements,
  syncQueuedSettlements,
} from './offlineSettlements'

function deleteOfflineDatabase() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('konveksi-pos')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Offline settlement database is still open'))
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

describe('offline settlement synchronization', () => {
  beforeEach(async () => {
    vi.stubGlobal('navigator', { onLine: true })
    vi.stubGlobal('localStorage', createStorage())
    await deleteOfflineDatabase()
    vi.clearAllMocks()
    rpc.mockImplementation((name: string) => Promise.resolve(
      name === 'get_operational_reset_generation'
        ? { data: 0, error: null }
        : { data: null, error: null },
    ))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reuses the same idempotency key when a payment is retried', async () => {
    const settlement = await enqueueSettlement('customer', {
      sale_id: 'sale-1',
      amount: 2500,
    }, 'admin-1')
    rpc.mockImplementation((name: string) => Promise.resolve(
      name === 'get_operational_reset_generation'
        ? { data: 0, error: null }
        : { data: null, error: { message: 'Failed to fetch' } },
    ))

    const firstAttempt = await syncQueuedSettlements('admin-1')
    expect(firstAttempt).toEqual({ synced: 0, failed: 1 })
    expect(rpc).toHaveBeenCalledWith('pay_customer_debt', {
      p_sale_id: 'sale-1',
      p_amount: 2500,
      p_idempotency_key: settlement.idempotencyKey,
    })

    rpc.mockImplementation((name: string) => Promise.resolve(
      name === 'get_operational_reset_generation'
        ? { data: 0, error: null }
        : { data: null, error: null },
    ))
    const secondAttempt = await retryFailedSettlements('admin-1')

    expect(secondAttempt).toEqual({ synced: 1, failed: 0 })
    expect(rpc).toHaveBeenCalledWith('pay_customer_debt', {
      p_sale_id: 'sale-1',
      p_amount: 2500,
      p_idempotency_key: settlement.idempotencyKey,
    })
    expect(await getQueuedSettlements()).toEqual([])
  })

  it('returns queued records to failed status when the RPC throws', async () => {
    await enqueueSettlement('vendor', {
      allocations: [{ stock_batch_id: 'batch-1', amount: 1250 }],
    }, 'admin-1')
    rpc.mockImplementation((name: string) => name === 'get_operational_reset_generation'
      ? Promise.resolve({ data: 0, error: null })
      : Promise.reject(new TypeError('Network request failed')))

    const result = await syncQueuedSettlements('admin-1')
    const [queued] = await getQueuedSettlements()

    expect(result).toEqual({ synced: 0, failed: 1 })
    expect(queued).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: 'Network request failed',
    })
  })

  it('does not sync settlements created by a different or unknown account', async () => {
    const foreignSettlement = await enqueueSettlement('customer', {
      sale_id: 'sale-1',
      amount: 2500,
    }, 'admin-2')
    const legacySettlement = {
      ...await enqueueSettlement('customer', {
        sale_id: 'sale-2',
        amount: 3000,
      }, 'admin-1'),
      userId: undefined,
    }
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('konveksi-pos', 2)
      request.onsuccess = () => {
        const database = request.result
        const transaction = database.transaction('offline-settlements', 'readwrite')
        transaction.objectStore('offline-settlements').put(legacySettlement)
        transaction.oncomplete = () => {
          database.close()
          resolve()
        }
        transaction.onerror = () => reject(transaction.error)
      }
      request.onerror = () => reject(request.error)
    })

    expect(await syncQueuedSettlements('admin-1')).toEqual({ synced: 0, failed: 0 })
    expect(rpc.mock.calls.map(([name]) => name)).toContain('get_operational_reset_generation')
    expect(await getQueuedSettlements()).toEqual(expect.arrayContaining([
      foreignSettlement,
      legacySettlement,
    ]))
  })
})
