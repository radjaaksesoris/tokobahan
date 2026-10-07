import { describe, expect, it } from 'vitest'
import type { Product } from '@/types'
import { getStockUnitCostForSale, getStockUnitsForSale } from './productUnits'

describe('stock unit conversions', () => {
  const product: Pick<Product, 'stock_unit' | 'stock_conversion' | 'prices'> = {
    stock_unit: 'satuan',
    stock_conversion: 1,
    prices: [
      { unit: 'satuan', price: 10, conversion: 1 },
      { unit: 'pack', price: 30, conversion: 3 },
    ],
  }

  it('rounds converted sale stock to database precision', () => {
    expect(getStockUnitsForSale(product, 'pack', 0.1)).toBe(0.3)
    expect(getStockUnitsForSale({ ...product, stock_conversion: 3 }, 'satuan', 1)).toBe(0.333)
  })

  it('converts returned sale-unit cost back to cost per stock unit', () => {
    expect(getStockUnitCostForSale(product, 3, 30)).toBe(10)
    expect(getStockUnitCostForSale({ ...product, stock_conversion: 2 }, 3, 30)).toBe(20)
  })
})
