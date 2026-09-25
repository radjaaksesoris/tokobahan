import { create } from 'zustand'
import type { CartItem, Product, UnitType } from '@/types'
import { UNIT_FACTORS } from '@/types'

interface CartState {
  items: CartItem[]
  addItem: (product: Product, unit: UnitType, quantity?: number, unitPrice?: number) => void
  updateQuantity: (productId: string, unit: UnitType, quantity: number) => void
  removeItem: (productId: string, unit: UnitType) => void
  clearCart: () => void
  getTotals: () => { subtotal: number; totalCost: number; totalProfit: number; itemCount: number }
}

export function getPriceForUnit(product: Product, unit: UnitType): { price: number; conversion: number } {
  const found = product.prices?.find((p) => p.unit === unit)
  if (found) {
    return { price: found.price, conversion: found.conversion || UNIT_FACTORS[unit] || 1 }
  }
  // fallback: use satuan price * factor
  const satuan = product.prices?.find((p) => p.unit === 'satuan')
  const basePrice = satuan?.price ?? product.cost_price * 1.3
  const conversion = UNIT_FACTORS[unit] || 1
  return { price: Math.round(basePrice * conversion), conversion }
}

function getCostForUnit(product: Product) {
  return product.cost_price
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],

  addItem: (product, unit, quantity = 1, unitPrice) => {
    const { price: defaultPrice, conversion } = getPriceForUnit(product, unit)
    const price = unitPrice ?? defaultPrice
    set((state) => {
      const existing = state.items.find(
        (i) => i.product.id === product.id && i.unit === unit
      )
      if (existing) {
        const newQty = Math.min(existing.quantity + quantity, product.stock)
        return {
          items: state.items.map((i) =>
            i.product.id === product.id && i.unit === unit
              ? {
                  ...i,
                  quantity: newQty,
                  line_total: newQty * price,
                  line_cost: newQty * getCostForUnit(product),
                  line_profit: newQty * price - newQty * getCostForUnit(product),
                }
              : i
          ),
        }
      }
      const line_total = quantity * price
      const line_cost = quantity * getCostForUnit(product)
      return {
        items: [
          ...state.items,
          {
            product,
            unit,
            quantity,
            unit_price: price,
            conversion,
            line_total,
            line_cost,
            line_profit: line_total - line_cost,
          },
        ],
      }
    })
  },

  updateQuantity: (productId, unit, quantity) => {
    if (quantity <= 0) {
      get().removeItem(productId, unit)
      return
    }
    set((state) => ({
      items: state.items.map((i) => {
        if (i.product.id === productId && i.unit === unit) {
          const safeQuantity = Math.min(quantity, i.product.stock)
          return {
            ...i,
            quantity: safeQuantity,
            line_total: safeQuantity * i.unit_price,
            line_cost: safeQuantity * getCostForUnit(i.product),
            line_profit: safeQuantity * i.unit_price - safeQuantity * getCostForUnit(i.product),
          }
        }
        return i
      }),
    }))
  },

  removeItem: (productId, unit) => {
    set((state) => ({
      items: state.items.filter(
        (i) => !(i.product.id === productId && i.unit === unit)
      ),
    }))
  },

  clearCart: () => set({ items: [] }),

  getTotals: () => {
    const items = get().items
    return {
      subtotal: items.reduce((s, i) => s + i.line_total, 0),
      totalCost: items.reduce((s, i) => s + i.line_cost, 0),
      totalProfit: items.reduce((s, i) => s + i.line_profit, 0),
      itemCount: items.reduce((s, i) => s + i.quantity, 0),
    }
  },
}))
