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

export function getSmallestConfiguredUnit(prices: ProductPrice[]) {
  return prices
    .filter((price) => Number.isFinite(price.conversion) && price.conversion > 0)
    .reduce<ProductPrice | null>((smallest, price) =>
      !smallest || price.conversion < smallest.conversion ? price : smallest,
    null)
}

export function formatMixedStockQuantity(
  product: Pick<Product, 'stock' | 'stock_unit' | 'stock_conversion' | 'prices'>,
) {
  const stockConversion = positiveNumber(product.stock_conversion)
  const prices = product.prices || []
  const baseUnit = getSmallestConfiguredUnit(prices)

  if (!stockConversion || !baseUnit) {
    return `${formatStockQuantity(product.stock)} ${UNIT_LABELS[product.stock_unit] || product.stock_unit}`
  }

  const packageUnit = prices
    .filter((price) =>
      price.conversion > baseUnit.conversion &&
      Number.isInteger(price.conversion / baseUnit.conversion),
    )
    .reduce<ProductPrice | null>((largest, price) =>
      !largest || price.conversion > largest.conversion ? price : largest,
    null)
  const stockUnitIsPackage = stockConversion > baseUnit.conversion &&
    Number.isInteger(stockConversion / baseUnit.conversion)
  const displayUnit = stockUnitIsPackage
    ? { unit: product.stock_unit, conversion: stockConversion }
    : packageUnit

  if (!displayUnit) {
    return `${formatStockQuantity(product.stock)} ${UNIT_LABELS[product.stock_unit] || product.stock_unit}`
  }

  const stockUnitsPerBaseUnit = displayUnit.conversion / baseUnit.conversion
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
  const stockLabel = UNIT_LABELS[displayUnit.unit] || displayUnit.unit
  const baseLabel = UNIT_LABELS[baseUnit.unit] || baseUnit.unit

  if (wholeStockQuantity === 0) return `${formatStockQuantity(roundedBaseQuantity)} ${baseLabel}`
  if (remainingBaseQuantity === 0) return `${formatStockQuantity(wholeStockQuantity)} ${stockLabel}`
  return `${formatStockQuantity(wholeStockQuantity)} ${stockLabel} + ${formatStockQuantity(remainingBaseQuantity)} ${baseLabel}`
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

export function formatAvailableStockInUnit(
  product: Pick<Product, 'prices' | 'stock_unit_mode'>,
  unit: UnitType,
  availableBaseUnits: number,
) {
  const unitLabel = UNIT_LABELS[unit] || unit
  const unitConversion = getUnitConversion(product, unit)
  const baseUnit = getSmallestConfiguredUnit(product.prices || [])

  if (
    product.stock_unit_mode === 'integer-base' &&
    baseUnit &&
    unitConversion > baseUnit.conversion &&
    Number.isInteger(unitConversion / baseUnit.conversion) &&
    Number.isFinite(availableBaseUnits) &&
    availableBaseUnits >= 0
  ) {
    const baseQuantity = availableBaseUnits / baseUnit.conversion
    const roundedBaseQuantity = Math.round(baseQuantity)
    if (Math.abs(baseQuantity - roundedBaseQuantity) <= 1e-8) {
      const baseUnitsPerSelectedUnit = unitConversion / baseUnit.conversion
      const wholeQuantity = Math.floor(roundedBaseQuantity / baseUnitsPerSelectedUnit)
      const remainder = roundedBaseQuantity % baseUnitsPerSelectedUnit
      const baseLabel = UNIT_LABELS[baseUnit.unit] || baseUnit.unit
      if (remainder === 0) return `${formatStockQuantity(wholeQuantity)} ${unitLabel}`
      if (wholeQuantity === 0) return `${formatStockQuantity(remainder)} ${baseLabel}`
      return `${formatStockQuantity(wholeQuantity)} ${unitLabel} + ${formatStockQuantity(remainder)} ${baseLabel}`
    }
  }

  return `${formatStockQuantity(availableBaseUnits / unitConversion)} ${unitLabel}`
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

export function getStockUnitsForSale(
  product: Pick<Product, 'prices' | 'stock_conversion' | 'stock_unit' | 'stock_unit_mode'>,
  unit: UnitType,
  quantity: number,
) {
  return getStockUnitsFromConversion(
    product,
    getUnitConversion(product, unit),
    quantity,
    unit,
  )
}

export function getStockUnitsFromConversion(
  product: {
    stock_conversion?: unknown
    stock_unit?: unknown
    stock_unit_mode?: unknown
  },
  saleUnitConversion: number,
  quantity: number,
  saleUnit = 'Satuan',
) {
  if (
    !Number.isFinite(saleUnitConversion) || saleUnitConversion <= 0 ||
    !Number.isFinite(quantity) || quantity < 0
  ) {
    throw new Error('Jumlah atau konversi stok tidak valid')
  }
  const stockQuantity = quantity * saleUnitConversion / getStockConversion(product)
  if (product.stock_unit_mode === 'integer-base') {
    const rounded = Math.round(stockQuantity)
    if (!Number.isFinite(stockQuantity) || Math.abs(stockQuantity - rounded) > 1e-8) {
      throw new Error(`Jumlah ${saleUnit} harus setara dengan bilangan bulat ${product.stock_unit}`)
    }
    return rounded
  }
  return roundStockQuantity(stockQuantity)
}

function getNormalizedStockQuantity(
  product: Pick<Product, 'prices' | 'stock_conversion' | 'stock_unit' | 'stock_unit_mode'>,
  unit: UnitType,
  quantity: number,
) {
  const stockQuantity = quantity * getUnitConversion(product, unit) / getStockConversion(product)
  if (!Number.isFinite(stockQuantity) || stockQuantity <= 0) return null
  if (product.stock_unit_mode === 'integer-base') {
    const rounded = Math.round(stockQuantity)
    return Math.abs(stockQuantity - rounded) <= 1e-8 ? rounded : null
  }
  return roundStockQuantity(stockQuantity)
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
  product: Pick<Product, 'id' | 'prices' | 'stock_conversion' | 'stock_unit' | 'stock_unit_mode'>,
  batches: Record<string, unknown>[],
  unit: UnitType,
  quantity: number,
): number | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return null
  const stockQuantity = getNormalizedStockQuantity(product, unit, quantity)
  if (stockQuantity === null) return null
  return consumeFifoStockBatches(batches, product.id, stockQuantity)?.cost ?? null
}

export function getUnitCost(product: Pick<Product, 'prices' | 'cost_conversion' | 'cost_unit' | 'cost_price'>, unit: UnitType) {
  return product.cost_price / getCostConversion(product) * getUnitConversion(product, unit)
}
