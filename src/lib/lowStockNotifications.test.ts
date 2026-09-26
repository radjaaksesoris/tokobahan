import { describe, expect, it } from 'vitest'
import { getUnnotifiedProducts } from './lowStockNotifications'

describe('getUnnotifiedProducts', () => {
  it('returns only products that have not already been notified', () => {
    const products = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

    expect(getUnnotifiedProducts(products, ['b'])).toEqual([{ id: 'a' }, { id: 'c' }])
  })
})
