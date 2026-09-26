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

describe('offline settlement synchronization', () => {
  beforeEach(async () => {
    vi.stubGlobal('navigator', { onLine: true })
    await deleteOfflineDatabase()
    vi.clearAllMocks()
    rpc.mockResolvedValue({ data: null, error: null })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reuses the same idempotency key when a payment is retried', async () => {
    const settlement = await enqueueSettlement('customer', {
      sale_id: 'sale-1',
      amount: 2500,
    })
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Failed to fetch' },
    })

    const firstAttempt = await syncQueuedSettlements()
    expect(firstAttempt).toEqual({ synced: 0, failed: 1 })
    expect(rpc).toHaveBeenNthCalledWith(1, 'pay_customer_debt', {
      p_sale_id: 'sale-1',
      p_amount: 2500,
      p_idempotency_key: settlement.idempotencyKey,
    })

    const secondAttempt = await retryFailedSettlements()

    expect(secondAttempt).toEqual({ synced: 1, failed: 0 })
    expect(rpc).toHaveBeenNthCalledWith(2, 'pay_customer_debt', {
      p_sale_id: 'sale-1',
      p_amount: 2500,
      p_idempotency_key: settlement.idempotencyKey,
    })
    expect(await getQueuedSettlements()).toEqual([])
  })

  it('returns queued records to failed status when the RPC throws', async () => {
    await enqueueSettlement('vendor', {
      allocations: [{ stock_batch_id: 'batch-1', amount: 1250 }],
    })
    rpc.mockRejectedValueOnce(new TypeError('Network request failed'))

    const result = await syncQueuedSettlements()
    const [queued] = await getQueuedSettlements()

    expect(result).toEqual({ synced: 0, failed: 1 })
    expect(queued).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: 'Network request failed',
    })
  })
})
