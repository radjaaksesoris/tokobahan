import type { Product, ProductPrice, UnitType } from '@/types'
import { coerceFiniteNumber, UNIT_FACTORS, UNIT_LABELS } from '@/types'
import { formatStockQuantity } from '@/lib/utils'

function positiveNumber(value: unknown) {
  const number = coerceFiniteNumber(value)
  return number !== null && number > 0 ? number : null
}

export function roundStockQuantity(value: number) {
  return Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 1000) / 1000
}

export function formatMixedStockQuantity(
  product: Pick<Product, 'stock' | 'stock_unit' | 'stock_conversion' | 'prices'>,
) {
  const stockConversion = positiveNumber(product.stock_conversion)
  const baseUnit = (product.prices || [])
    .map((price) => ({ unit: price.unit, conversion: positiveNumber(price.conversion) }))
    .filter((price): price is { unit: UnitType; conversion: number } =>
      price.conversion !== null && stockConversion !== null && price.conversion < stockConversion,
    )
    .sort((a, b) => a.conversion - b.conversion)[0]

  if (!stockConversion || !baseUnit) {
    return `${formatStockQuantity(product.stock)} ${UNIT_LABELS[product.stock_unit] || product.stock_unit}`
  }

  const stockUnitsPerBaseUnit = stockConversion / baseUnit.conversion
  const baseQuantity = Number(product.stock) * stockConversion / baseUnit.conversion
  if (
    !Number.isInteger(stockUnitsPerBaseUnit) ||
    !Number.isFinite(baseQuantity) ||
    baseQuantity < 0
  ) {
    return `${formatStockQuantity(product.stock)} ${UNIT_LABELS[product.stock_unit] || product.stock_unit}`
  }

  const roundedBaseQuantity = Math.round(baseQuantity)
  const wholeStockQuantity = Math.floor(roundedBaseQuantity / stockUnitsPerBaseUnit)
  const remainingBaseQuantity = roundedBaseQuantity % stockUnitsPerBaseUnit
  const isApproximate = Math.abs(baseQuantity - roundedBaseQuantity) > 1e-8
  const prefix = isApproximate ? '≈ ' : ''
  const stockLabel = UNIT_LABELS[product.stock_unit] || product.stock_unit
  const baseLabel = UNIT_LABELS[baseUnit.unit] || baseUnit.unit

  if (remainingBaseQuantity === 0) return `${prefix}${formatStockQuantity(wholeStockQuantity)} ${stockLabel}`
  return `${prefix}${formatStockQuantity(wholeStockQuantity)} ${stockLabel} + ${formatStockQuantity(remainingBaseQuantity)} ${baseLabel}`
}

export function getConfiguredPrice(product: Pick<Product, 'prices'>, unit: UnitType): ProductPrice | undefined {
  return product.prices?.find((price) => price.unit === unit)
}

export function getPriceConversion(prices: ProductPrice[], unit: UnitType) {
  return positiveNumber(prices.find((price) => price.unit === unit)?.conversion) || positiveNumber(UNIT_FACTORS[unit]) || 1
}

export function getUnitConversion(product: Pick<Product, 'prices'>, unit: UnitType) {
  return getPriceConversion(product.prices || [], unit)
}

export function getStockConversion(product: { prices?: unknown; stock_conversion?: unknown; stock_unit?: unknown }) {
  const prices = Array.isArray(product.prices) ? product.prices as ProductPrice[] : []
  const stockUnit = typeof product.stock_unit === 'string' ? product.stock_unit : 'satuan'
  return positiveNumber(product.stock_conversion) || getPriceConversion(prices, stockUnit)
}

export function getCostConversion(product: { prices?: unknown; cost_conversion?: unknown; cost_unit?: unknown }) {
  const prices = Array.isArray(product.prices) ? product.prices as ProductPrice[] : []
  const costUnit = typeof product.cost_unit === 'string' ? product.cost_unit : 'satuan'
  return positiveNumber(product.cost_conversion) || getPriceConversion(prices, costUnit)
}

export function getStockUnitsForSale(product: Pick<Product, 'prices' | 'stock_conversion' | 'stock_unit'>, unit: UnitType, quantity: number) {
  return roundStockQuantity(quantity * getUnitConversion(product, unit) / getStockConversion(product))
}

export function getStockUnitCostForSale(
  product: {
    prices?: unknown
    stock_conversion?: unknown
    stock_unit?: unknown
    cost_conversion?: unknown
    cost_unit?: unknown
  },
  saleUnitConversion: number,
  saleUnitCost: number,
) {
  if (!Number.isFinite(saleUnitConversion) || saleUnitConversion <= 0 || !Number.isFinite(saleUnitCost) || saleUnitCost < 0) {
    throw new Error('Konversi atau HPP satuan penjualan tidak valid')
  }
  const stockUnitCost = saleUnitCost * getStockConversion(product) / saleUnitConversion
  return Math.round((stockUnitCost + Number.EPSILON) * 100) / 100
}

export function consumeFifoStockBatches(
  batches: Record<string, unknown>[],
  productId: string,
  stockQuantity: number,
): { cost: number; remainingByBatchId: Map<string, number> } | null {
  if (!Number.isFinite(stockQuantity) || stockQuantity <= 0) return null
  let remaining = roundStockQuantity(stockQuantity)
  let totalCost = 0
  const remainingByBatchId = new Map<string, number>()
  const fifoBatches = batches
    .filter((batch) =>
      batch.product_id === productId &&
      Number.isFinite(Number(batch.quantity_remaining)) &&
      Number(batch.quantity_remaining) > 0,
    )
    .sort((a, b) =>
      String(a.received_at).localeCompare(String(b.received_at)) ||
      String(a.id).localeCompare(String(b.id)),
    )

  for (const batch of fifoBatches) {
    if (remaining <= 0) break
    const available = Number(batch.quantity_remaining)
    const unitCost = Number(batch.unit_cost)
    if (!Number.isFinite(unitCost) || unitCost < 0) return null
    const consumed = roundStockQuantity(Math.min(remaining, available))
    totalCost += consumed * unitCost
    remaining = roundStockQuantity(remaining - consumed)
    remainingByBatchId.set(String(batch.id), roundStockQuantity(available - consumed))
  }

  if (remaining > 0) return null
  return {
    cost: Math.round((totalCost + Number.EPSILON) * 100) / 100,
    remainingByBatchId,
  }
}

export function getFifoCostForSale(
  product: Pick<Product, 'id' | 'prices' | 'stock_conversion' | 'stock_unit'>,
  batches: Record<string, unknown>[],
  unit: UnitType,
  quantity: number,
): number | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return null
  const stockQuantity = roundStockQuantity(
    quantity * getUnitConversion(product, unit) / getStockConversion(product),
  )
  return consumeFifoStockBatches(batches, product.id, stockQuantity)?.cost ?? null
}

export function getUnitCost(product: Pick<Product, 'prices' | 'cost_conversion' | 'cost_unit' | 'cost_price'>, unit: UnitType) {
  return product.cost_price / getCostConversion(product) * getUnitConversion(product, unit)
}
