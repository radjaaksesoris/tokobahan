import { describe, expect, it } from 'vitest'
import { formatStockQuantity } from './utils'

describe('formatStockQuantity', () => {
  it('formats stock quantities without decimal places', () => {
    expect(formatStockQuantity(3.9400000000000004)).toBe('4')
    expect(formatStockQuantity(0.8859999999999999)).toBe('1')
    expect(formatStockQuantity(24.333)).toBe('24')
    expect(formatStockQuantity(5)).toBe('5')
  })
})
