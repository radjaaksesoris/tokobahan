export type UnitType = 'satuan' | 'lusin' | 'kodi' | 'gross' | 'meter' | 'pack'

export const UNIT_LABELS: Record<UnitType, string> = {
  satuan: 'Satuan',
  lusin: 'Lusin (12)',
  kodi: 'Kodi (20)',
  gross: 'Gross (144)',
  meter: 'Meter',
  pack: 'Pack',
}

export const UNIT_FACTORS: Record<UnitType, number> = {
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

export interface Product {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  category_id: string | null
  cost_price: number // per base unit (pcs/meter)
  cost_unit: UnitType
  cost_conversion: number
  stock: number // in base units
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

export interface Category {
  id: string
  name: string
  created_at: string
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

export interface Sale {
  id: string
  invoice_no: string
  total_amount: number
  total_cost: number
  total_profit: number
  payment_method: 'cash' | 'transfer' | 'qris' | 'credit'
  notes: string | null
  cashier_id: string | null
  created_at: string
}

export interface SaleItem {
  id: string
  sale_id: string
  product_id: string
  product_name: string
  unit: UnitType
  quantity: number
  conversion: number
  unit_price: number
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
