import type { Json } from './database'

export type UnitType = string

export function isUnitType(value: string): value is UnitType {
  return value.trim().length > 0
}

export const UNIT_LABELS: Record<string, string> = {
  satuan: 'Satuan',
  lusin: 'Lusin',
  kodi: 'Kodi',
  gross: 'Gross',
  meter: 'Meter',
  pack: 'Pack',
}

export const UNIT_FACTORS: Record<string, number> = {
  satuan: 1,
  lusin: 12,
  kodi: 20,
  gross: 144,
  meter: 1, // for length-based
  pack: 1,  // custom pack size stored per product
}

export interface ProductPrice {
  unit: UnitType
  price: number
  conversion: number // how many base units (pcs) in this unit
}

export function parseProductPrices(value: Json): ProductPrice[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return []
    const unit = entry.unit
    const price = entry.price
    const conversion = entry.conversion
    if (
      typeof unit !== 'string' ||
      !isUnitType(unit) ||
      typeof price !== 'number' ||
      typeof conversion !== 'number'
    ) return []
    return [{ unit, price, conversion }]
  })
}

export interface Product {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  category_id: string | null
  cost_price: number // per configured cost unit
  cost_unit: UnitType
  cost_conversion: number
  stock: number // in configured stock unit
  stock_unit: UnitType
  stock_conversion: number
  min_stock: number
  unit_base: 'pcs' | 'meter'
  prices: ProductPrice[]
  image_url: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface CartItem {
  product: Product
  unit: UnitType
  quantity: number // in selected unit
  unit_price: number
  conversion: number
  line_total: number
  line_cost: number
  line_profit: number
}

export type UserRole = 'admin' | 'cashier' | 'monitor'

export interface Profile {
  id: string
  full_name: string
  role: UserRole
  avatar_url: string | null
  created_at: string
}
