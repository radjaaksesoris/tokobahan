import { describe, expect, it } from 'vitest'
import { formatStockQuantity } from './utils'

describe('formatStockQuantity', () => {
  it('formats stock with at most two decimal places', () => {
    expect(formatStockQuantity(3.9400000000000004)).toBe('3,94')
    expect(formatStockQuantity(0.8859999999999999)).toBe('0,89')
    expect(formatStockQuantity(24.333)).toBe('24,33')
    expect(formatStockQuantity(5)).toBe('5')
  })
})
