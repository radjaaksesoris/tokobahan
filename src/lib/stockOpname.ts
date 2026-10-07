import { roundStockQuantity } from '@/lib/productUnits'

export interface StockBatch {
  id: string
  product_id: string
  quantity_received: number
  quantity_remaining: number
  unit_cost: number
  received_at: string
  vendor_id: string | null
  payment_status: 'kredit' | 'lunas'
  due_date: string | null
  [key: string]: unknown
}

export function reconcileStockBatches(
  batches: StockBatch[],
  productId: string,
  physicalStock: number,
  unitCost: number,
  now: string,
  createId: () => string = () => crypto.randomUUID(),
) {
  if (!Number.isFinite(physicalStock) || physicalStock < 0) {
    throw new Error('Stok fisik harus berupa angka nol atau lebih')
  }

  const normalizedBatches = batches.map((batch) => batch.product_id === productId
    ? {
        ...batch,
        quantity_received: roundStockQuantity(batch.quantity_received),
        quantity_remaining: roundStockQuantity(batch.quantity_remaining),
      }
    : batch)
  const productBatches = normalizedBatches.filter((batch) => batch.product_id === productId)
  if (productBatches.some((batch) =>
    !Number.isFinite(batch.quantity_remaining) || batch.quantity_remaining < 0,
  )) {
    throw new Error('Jumlah sisa pada batch stok lokal tidak valid')
  }

  const normalizedPhysicalStock = roundStockQuantity(physicalStock)
  const remaining = roundStockQuantity(productBatches.reduce((total, batch) => total + batch.quantity_remaining, 0))
  const difference = roundStockQuantity(normalizedPhysicalStock - remaining)
  let updatedBatches = normalizedBatches

  if (difference < 0) {
    let toConsume = -difference
    const fifo = [...productBatches].sort((a, b) =>
      a.received_at.localeCompare(b.received_at) || a.id.localeCompare(b.id),
    )
    const consumedById = new Map<string, number>()
    for (const batch of fifo) {
      if (toConsume <= 0) break
      const consumed = roundStockQuantity(Math.min(batch.quantity_remaining, toConsume))
      consumedById.set(batch.id, consumed)
      toConsume = roundStockQuantity(toConsume - consumed)
    }
    if (toConsume > 0) throw new Error('Batch stok lokal tidak dapat direkonsiliasi dengan aman')
    updatedBatches = normalizedBatches.map((batch) => ({
      ...batch,
      quantity_remaining: roundStockQuantity(batch.quantity_remaining - (consumedById.get(batch.id) || 0)),
    }))
  } else if (difference > 0) {
    updatedBatches = [
      ...batches,
      {
        id: createId(),
        product_id: productId,
        quantity_received: difference,
        quantity_remaining: difference,
        unit_cost: unitCost,
        received_at: now,
        vendor_id: null,
        payment_status: 'lunas',
        due_date: null,
      },
    ]
  }

  return updatedBatches
}
