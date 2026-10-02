import { create } from 'zustand'
import type { CartItem, Product, UnitType } from '@/types'
import { UNIT_FACTORS } from '@/types'
import { getStockConversion, getUnitConversion, getUnitCost } from '@/lib/productUnits'

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

function getAvailableQuantity(product: Product, unit: UnitType, items: CartItem[], currentItem?: CartItem) {
  const reservedBaseUnits = items
    .filter((item) => item.product.id === product.id && item !== currentItem)
    .reduce((sum, item) => sum + item.quantity * item.conversion, 0)
  const availableBaseUnits = Math.max(0, Number(product.stock) * getStockConversion(product) - reservedBaseUnits)
  return availableBaseUnits / getUnitConversion(product, unit)
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
      const availableQuantity = getAvailableQuantity(product, unit, state.items, existing)
      const safeQuantity = Math.min(quantity, availableQuantity)
      if (safeQuantity <= 0) return state
      if (existing) {
        const newQty = Math.min(existing.quantity + safeQuantity, existing.quantity + availableQuantity)
        return {
          items: state.items.map((i) =>
            i.product.id === product.id && i.unit === unit
              ? {
                  ...i,
                  quantity: newQty,
                  line_total: newQty * price,
                  line_cost: newQty * getUnitCost(product, unit),
                  line_profit: newQty * price - newQty * getUnitCost(product, unit),
                }
              : i
          ),
        }
      }
      const line_total_safe = safeQuantity * price
      const line_cost = safeQuantity * getUnitCost(product, unit)
      return {
        items: [
          ...state.items,
          {
            product,
            unit,
            quantity: safeQuantity,
            unit_price: price,
            conversion,
            line_total: line_total_safe,
            line_cost,
            line_profit: line_total_safe - line_cost,
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
          const safeQuantity = Math.min(quantity, getAvailableQuantity(i.product, i.unit, state.items, i))
          return {
            ...i,
            quantity: safeQuantity,
            line_total: safeQuantity * i.unit_price,
            line_cost: safeQuantity * getUnitCost(i.product, i.unit),
            line_profit: safeQuantity * i.unit_price - safeQuantity * getUnitCost(i.product, i.unit),
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
