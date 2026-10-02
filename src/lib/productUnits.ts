import type { Product, ProductPrice, UnitType } from '@/types'
import { UNIT_FACTORS } from '@/types'

function positiveNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
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

export function getCostConversion(product: Pick<Product, 'prices' | 'cost_conversion' | 'cost_unit'>) {
  return positiveNumber(product.cost_conversion) || getUnitConversion(product, product.cost_unit)
}

export function getStockUnitsForSale(product: Pick<Product, 'prices' | 'stock_conversion' | 'stock_unit'>, unit: UnitType, quantity: number) {
  return quantity * getUnitConversion(product, unit) / getStockConversion(product)
}

export function getUnitCost(product: Pick<Product, 'prices' | 'cost_conversion' | 'cost_unit' | 'cost_price'>, unit: UnitType) {
  return product.cost_price / getCostConversion(product) * getUnitConversion(product, unit)
}
