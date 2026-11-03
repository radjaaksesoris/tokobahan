import { getCostConversion, getSmallestConfiguredUnit, getStockConversion } from '@/lib/productUnits'
import { parseProductPrices } from '@/types'
import type { OperationalSnapshot } from '@/lib/offlineOperationalSnapshot'
import { validateOperationalSnapshotIntegrity } from '@/lib/validateOperationalSnapshotIntegrity'

type Summary = {
  snapshot: OperationalSnapshot
  convertedProducts: number
  roundedProducts: number
  createdAdjustmentBatches: number
  adjustmentRows: number
}

function toInteger(value: number, description: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${description} tidak valid`)
  }
  return Math.round(value + Number.EPSILON)
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function migrateSnapshotToIntegerStock(
  snapshot: OperationalSnapshot,
  now = new Date().toISOString(),
  createId: () => string = () => crypto.randomUUID(),
): Summary {
  const products = snapshot.tables.products.map((row) => ({ ...row }))
  const batches = snapshot.tables.product_stock_batches.map((row) => ({ ...row }))
  const adjustments = [...snapshot.tables.stock_adjustments]
  let convertedProducts = 0
  let roundedProducts = 0
  let createdAdjustmentBatches = 0
  let adjustmentRows = 0

  for (const productRow of products) {
    if (productRow.stock_unit_mode === 'integer-base') continue
    const product = { ...productRow }
    const prices = parseProductPrices(product.prices)
    const smallestUnit = getSmallestConfiguredUnit(prices)
    if (!smallestUnit) {
      throw new Error(`Produk ${String(product.name)} tidak memiliki konversi satuan jual yang valid`)
    }

    for (const price of prices) {
      const ratio = price.conversion / smallestUnit.conversion
      if (Math.abs(ratio - Math.round(ratio)) > 1e-8) {
        throw new Error(
          `Produk ${String(product.name)} belum dapat dinormalisasi: konversi ${price.unit} tidak setara dengan bilangan bulat ${smallestUnit.unit}`,
        )
      }
    }

    const oldStockConversion = getStockConversion(product)
    const costConversion = getCostConversion(product)
    const costRatio = costConversion / smallestUnit.conversion
    if (Math.abs(costRatio - Math.round(costRatio)) > 1e-8) {
      throw new Error(
        `Produk ${String(product.name)} belum dapat dinormalisasi: satuan modal ${product.cost_unit} tidak setara dengan bilangan bulat ${smallestUnit.unit}`,
      )
    }

    const originalStock = Number(product.stock)
    const exactStock = originalStock * oldStockConversion / smallestUnit.conversion
    const targetStock = toInteger(exactStock, `Stok produk ${String(product.name)}`)
    const minStock = toInteger(
      Number(product.min_stock || 0) * oldStockConversion / smallestUnit.conversion,
      `Stok minimum ${String(product.name)}`,
    )
    const convertedProduct = {
      ...productRow,
      stock: targetStock,
      min_stock: minStock,
      stock_unit: smallestUnit.unit,
      stock_conversion: smallestUnit.conversion,
      stock_unit_mode: 'integer-base' as const,
      updated_at: now,
    }
    products[products.indexOf(productRow)] = convertedProduct

    const productBatches = batches.filter((batch) => batch.product_id === product.id)
    let batchAdjusted = false
    for (const batch of productBatches) {
      const oldReceived = Number(batch.quantity_received)
      const oldRemaining = Number(batch.quantity_remaining)
      const oldUnitCost = Number(batch.unit_cost)
      if (
        !Number.isFinite(oldReceived) || oldReceived <= 0 ||
        !Number.isFinite(oldRemaining) || oldRemaining < 0 ||
        !Number.isFinite(oldUnitCost) || oldUnitCost < 0
      ) {
        throw new Error(`Batch stok ${String(batch.id)} untuk ${String(product.name)} tidak valid`)
      }

      const convertedRemaining = toInteger(
        oldRemaining * oldStockConversion / smallestUnit.conversion,
        `Sisa batch ${String(batch.id)}`,
      )
      const convertedReceived = Math.max(
        convertedRemaining,
        toInteger(
          oldReceived * oldStockConversion / smallestUnit.conversion,
          `Jumlah batch ${String(batch.id)}`,
        ),
        1,
      )
      const originalBatchValue = oldReceived * oldUnitCost
      const adjustedUnitCost = roundMoney(originalBatchValue / convertedReceived)
      const index = batches.findIndex((entry) => entry.id === batch.id)
      batches[index] = {
        ...batch,
        quantity_received: convertedReceived,
        quantity_remaining: convertedRemaining,
        unit_cost: adjustedUnitCost,
      }
      batchAdjusted ||= convertedRemaining !== oldRemaining ||
        convertedReceived !== oldReceived ||
        smallestUnit.conversion !== oldStockConversion
    }

    let batchStock = productBatches.reduce((total, batch) => {
      const converted = batches.find((entry) => entry.id === batch.id)
      return total + Number(converted?.quantity_remaining || 0)
    }, 0)
    let difference = targetStock - batchStock
    if (difference < 0) {
      let toConsume = -difference
      const fifoBatches = [...productBatches].sort((a, b) =>
        String(a.received_at).localeCompare(String(b.received_at)) ||
        String(a.id).localeCompare(String(b.id)),
      )
      for (const batch of fifoBatches) {
        if (toConsume === 0) break
        const index = batches.findIndex((entry) => entry.id === batch.id)
        const remaining = Number(batches[index].quantity_remaining)
        const consumed = Math.min(remaining, toConsume)
        batches[index] = { ...batches[index], quantity_remaining: remaining - consumed }
        toConsume -= consumed
      }
      if (toConsume > 0) {
        throw new Error(`Batch stok ${String(product.name)} tidak dapat diselaraskan dengan jumlah produk`)
      }
      batchAdjusted = true
    } else if (difference > 0) {
      const costPrice = Number(product.cost_price)
      if (!Number.isFinite(costPrice) || costPrice < 0) {
        throw new Error(`Harga modal ${String(product.name)} tidak valid untuk batch penyesuaian`)
      }
      batches.push({
        id: createId(),
        product_id: product.id,
        quantity_received: difference,
        quantity_remaining: difference,
        unit_cost: roundMoney(costPrice * smallestUnit.conversion / costConversion),
        vendor_id: null,
        payment_status: 'lunas',
        due_date: null,
        received_at: now,
        created_at: now,
      })
      createdAdjustmentBatches += 1
      batchAdjusted = true
    }

    batchStock = batches
      .filter((batch) => batch.product_id === product.id)
      .reduce((total, batch) => total + Number(batch.quantity_remaining), 0)
    if (batchStock !== targetStock) {
      throw new Error(`Stok produk ${String(product.name)} tidak sama dengan total batch setelah normalisasi`)
    }

    const rounded = exactStock !== targetStock ||
      productBatches.some((batch) =>
        Number(batch.quantity_remaining) * oldStockConversion / smallestUnit.conversion !==
        Number(batches.find((entry) => entry.id === batch.id)?.quantity_remaining),
      )
    if (rounded) roundedProducts += 1

    adjustments.push({
      id: createId(),
      product_id: product.id,
      system_stock: targetStock,
      physical_stock: targetStock,
      difference: 0,
      reason:
        `Normalisasi stok: ${String(originalStock)} ${String(productRow.stock_unit)} ` +
        `setara ${exactStock.toFixed(3)} ${smallestUnit.unit}; dibulatkan menjadi ${targetStock} ` +
        `${smallestUnit.unit} (selisih ${(targetStock - exactStock).toFixed(3)}); ` +
        `penyesuaian otomatis ke unit terdekat${batchAdjusted ? ', batch FIFO diselaraskan' : ''}.`,
      adjusted_by: snapshot.generated_by || null,
      created_at: now,
    })
    adjustmentRows += 1
    convertedProducts += 1
  }

  const migratedSnapshot = convertedProducts === 0
    ? snapshot
    : {
        ...snapshot,
        generated_at: now,
        tables: {
          ...snapshot.tables,
          products,
          product_stock_batches: batches,
          stock_adjustments: adjustments,
        },
      }

  if (convertedProducts > 0) validateOperationalSnapshotIntegrity(migratedSnapshot)

  return {
    snapshot: migratedSnapshot,
    convertedProducts,
    roundedProducts,
    createdAdjustmentBatches,
    adjustmentRows,
  }
}
