import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { eq, from, maybeSingle, rpc, select } = vi.hoisted(() => ({
  eq: vi.fn(),
  from: vi.fn(),
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
  select: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { from, rpc },
}))

import {
  enqueueTransaction,
  getQueuedTransactions,
  retryFailedTransactions,
  syncQueuedTransactions,
} from './offlineTransactions'

const transaction = {
  invoiceNo: 'OFF-20260926193000-TEST0001',
  totalAmount: 1200,
  totalCost: 800,
  totalProfit: 400,
  paymentMethod: 'cash',
  customerName: null,
  amountPaid: 1200,
  cashierId: 'cashier-1',
  items: [{ product_id: 'product-1', quantity: 2 }],
}

function deleteOfflineDatabase() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('konveksi-pos')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Offline transaction database is still open'))
  })
}

describe('offline transaction synchronization', () => {
  beforeEach(async () => {
    vi.stubGlobal('navigator', { onLine: true })
    await deleteOfflineDatabase()
    vi.clearAllMocks()
    from.mockReturnValue({ select })
    select.mockReturnValue({ eq })
    eq.mockReturnValue({ maybeSingle })
    maybeSingle.mockResolvedValue({ data: null, error: null })
    rpc.mockResolvedValue({ data: null, error: null })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends queued checkouts through the atomic checkout RPC', async () => {
    await enqueueTransaction(transaction)

    const result = await syncQueuedTransactions()

    expect(result).toEqual({ synced: 1, failed: 0 })
    expect(rpc).toHaveBeenCalledWith('checkout_sale', {
      p_invoice_no: transaction.invoiceNo,
      p_total_amount: transaction.totalAmount,
      p_total_cost: transaction.totalCost,
      p_total_profit: transaction.totalProfit,
      p_payment_method: transaction.paymentMethod,
      p_cashier_id: transaction.cashierId,
      p_items: transaction.items,
      p_customer_name: transaction.customerName,
      p_amount_paid: transaction.amountPaid,
    })
    expect(await getQueuedTransactions()).toEqual([])
  })

  it('retries failed checkouts and removes them after success', async () => {
    await enqueueTransaction(transaction)
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'temporary failure' } })

    const firstAttempt = await syncQueuedTransactions()
    expect(firstAttempt).toEqual({ synced: 0, failed: 1 })
    expect((await getQueuedTransactions())[0]).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: 'temporary failure',
    })

    const retryResult = await retryFailedTransactions()

    expect(retryResult).toEqual({ synced: 1, failed: 0 })
    expect(await getQueuedTransactions()).toEqual([])
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('does not submit a checkout already committed with the same invoice', async () => {
    await enqueueTransaction(transaction)
    maybeSingle.mockResolvedValue({ data: { id: 'sale-1' }, error: null })

    const result = await syncQueuedTransactions()

    expect(result).toEqual({ synced: 1, failed: 0 })
    expect(rpc).not.toHaveBeenCalled()
    expect(await getQueuedTransactions()).toEqual([])
  })
})
