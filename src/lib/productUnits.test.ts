import { describe, expect, it } from 'vitest'
import { parseProductPrices, type Product } from '@/types'
import { formatAvailableStockInUnit, formatMixedStockQuantity, getFifoCostForSale, getStockUnitCostForSale, getStockUnitsForSale } from './productUnits'

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

  it('uses integer base units for roll and meter sales', () => {
    const meterStockProduct = {
      stock: 879,
      stock_unit: 'meter',
      stock_conversion: 1,
      stock_unit_mode: 'integer-base' as const,
      prices: [
        { unit: 'meter', price: 13000, conversion: 1 },
        { unit: 'roll', price: 525000, conversion: 44 },
      ],
    }

    expect(getStockUnitsForSale(meterStockProduct, 'roll', 20)).toBe(880)
    expect(getStockUnitsForSale(meterStockProduct, 'meter', 1)).toBe(1)
    expect(formatMixedStockQuantity(meterStockProduct)).toBe('19 roll + 43 Meter')
    expect(() => getStockUnitsForSale(meterStockProduct, 'meter', 0.5))
      .toThrow('Jumlah meter harus setara dengan bilangan bulat meter')
  })

  it('displays pack stock as whole packs and rolls without changing stored stock', () => {
    const packStockProduct = {
      stock: 43.498,
      stock_unit: 'pack',
      stock_conversion: 6,
      prices: [
        { unit: 'pack', price: 72000, conversion: 6 },
        { unit: 'Roll', price: 12000, conversion: 1 },
      ],
    }

    expect(formatMixedStockQuantity(packStockProduct)).toBe('43 Pack + 3 Roll')
    expect(formatMixedStockQuantity({
      ...packStockProduct,
      stock: 44 + 5 / 6,
    })).toBe('44 Pack + 5 Roll')
    expect(packStockProduct.stock).toBe(43.498)
  })

  it('shows leftover base units when displaying available stock in a larger unit', () => {
    const productWithPackStock = {
      stock_unit: 'pack',
      stock_conversion: 6,
      stock_unit_mode: 'integer-base' as const,
      prices: [
        { unit: 'pack', price: 60000, conversion: 6 },
        { unit: 'satuan', price: 10000, conversion: 1 },
      ],
    }

    expect(formatAvailableStockInUnit(productWithPackStock, 'pack', 641)).toBe('106 Pack + 5 Satuan')
    expect(formatAvailableStockInUnit(productWithPackStock, 'satuan', 641)).toBe('641 Satuan')
    expect(formatAvailableStockInUnit(productWithPackStock, 'pack', 636)).toBe('106 Pack')
  })

  it('converts returned sale-unit cost back to cost per stock unit', () => {
    expect(getStockUnitCostForSale(product, 3, 30)).toBe(10)
    expect(getStockUnitCostForSale({ ...product, stock_conversion: 2 }, 3, 30)).toBe(20)
  })

  it('converts modal cost per cost unit into cost per stock unit', () => {
    const dozenStockProduct = {
      ...product,
      stock_unit: 'lusin',
      stock_conversion: 12,
      cost_unit: 'satuan',
      cost_conversion: 1,
    }

    expect(getStockUnitCostForSale(dozenStockProduct, 1, 10)).toBe(120)
    expect(getStockUnitCostForSale({
      ...dozenStockProduct,
      stock_unit: 'satuan',
      stock_conversion: 1,
      cost_unit: 'lusin',
      cost_conversion: 12,
    }, 12, 120)).toBe(10)
  })

  it('estimates the same FIFO cost as checkout across stock batches', () => {
    const meterProduct = {
      id: 'product-1',
      stock_unit: 'roll',
      stock_conversion: 44,
      prices: [{ unit: 'meter', price: 13000, conversion: 1 }],
    }
    const batches = [
      { id: 'batch-1', product_id: 'product-1', quantity_remaining: 0.01, unit_cost: 44000, received_at: '2026-01-01' },
      { id: 'batch-2', product_id: 'product-1', quantity_remaining: 1, unit_cost: 48000, received_at: '2026-01-02' },
    ]

    expect(getFifoCostForSale(meterProduct, batches, 'meter', 1)).toBe(1064)
    expect(getFifoCostForSale(meterProduct, batches, 'meter', 2)).toBe(2120)
    expect(getFifoCostForSale(meterProduct, [
      { id: 'batch-1', product_id: 'product-1', quantity_remaining: 1, unit_cost: 48000, received_at: '2026-01-01' },
    ], 'meter', 1)).toBe(1104)
    expect(getFifoCostForSale(meterProduct, batches, 'meter', 100)).toBeNull()
  })

  it('accepts numeric strings from persisted price records', () => {
    const parsed = parseProductPrices([
      { unit: 'satuan', price: '10', conversion: '1' },
      { unit: 'pack', price: '30', conversion: '3' },
      { unit: 'meter', price: '12,5', conversion: '0.5' },
    ])

    expect(parsed).toEqual([
      { unit: 'satuan', price: 10, conversion: 1 },
      { unit: 'pack', price: 30, conversion: 3 },
      { unit: 'meter', price: 12.5, conversion: 0.5 },
    ])
  })
})
