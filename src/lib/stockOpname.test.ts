import { describe, expect, it } from 'vitest'
import { reconcileStockBatches, type StockBatch } from './stockOpname'

const batch = (id: string, receivedAt: string, remaining: number): StockBatch => ({
  id,
  product_id: 'product-1',
  quantity_received: remaining,
  quantity_remaining: remaining,
  unit_cost: 10,
  received_at: receivedAt,
  vendor_id: 'vendor-1',
  payment_status: 'kredit',
  due_date: '2026-10-10',
})

describe('reconcileStockBatches', () => {
  it('consumes reduced stock from batches in FIFO order without removing history', () => {
    const batches = [
      batch('newer', '2026-02-01T00:00:00.000Z', 5),
      batch('older', '2026-01-01T00:00:00.000Z', 4),
    ]

    const result = reconcileStockBatches(batches, 'product-1', 6, 12, '2026-03-01T00:00:00.000Z')

    expect(result.map(({ id, quantity_remaining }) => [id, quantity_remaining])).toEqual([
      ['newer', 5],
      ['older', 1],
    ])
  })

  it('adds a debt-free batch at current cost when stock increases', () => {
    const result = reconcileStockBatches(
      [batch('existing', '2026-01-01T00:00:00.000Z', 3)],
      'product-1',
      5,
      17,
      '2026-03-01T00:00:00.000Z',
      () => 'new-batch',
    )

    expect(result).toHaveLength(2)
    expect(result[1]).toMatchObject({
      id: 'new-batch',
      product_id: 'product-1',
      quantity_received: 2,
      quantity_remaining: 2,
      unit_cost: 17,
      vendor_id: null,
      payment_status: 'lunas',
      due_date: null,
    })
  })

  it('leaves batches for other products untouched', () => {
    const other = { ...batch('other', '2026-01-01T00:00:00.000Z', 3), product_id: 'product-2' }
    const result = reconcileStockBatches([other], 'product-1', 0, 10, '2026-03-01T00:00:00.000Z')
    expect(result).toEqual([other])
  })

  it('normalizes existing stock quantities even when the physical count is unchanged', () => {
    const batchWithFloatingPointNoise = {
      ...batch('noisy', '2026-01-01T00:00:00.000Z', 3.9400000000000004),
      quantity_received: 3.9400000000000004,
    }

    expect(reconcileStockBatches(
      [batchWithFloatingPointNoise],
      'product-1',
      3.94,
      10,
      '2026-03-01T00:00:00.000Z',
    )).toMatchObject([{
      quantity_received: 3.94,
      quantity_remaining: 3.94,
    }])
  })
})
