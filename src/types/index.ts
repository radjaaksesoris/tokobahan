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

export function coerceFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed) return null

  const cleaned = trimmed.replace(/\s+/g, '').replace(/[$\u00A0]/g, '')
  if (!cleaned) return null

  if (cleaned.includes(',') && cleaned.includes('.')) {
    const lastComma = cleaned.lastIndexOf(',')
    const lastDot = cleaned.lastIndexOf('.')
    const decimalSeparator = lastComma > lastDot ? ',' : '.'
    const thousandSeparator = decimalSeparator === ',' ? '.' : ','
    const withoutThousands = cleaned.replace(new RegExp(`\\${thousandSeparator}`, 'g'), '')
    const normalized = withoutThousands.replace(decimalSeparator, '.')
    const numeric = Number(normalized)
    return Number.isFinite(numeric) ? numeric : null
  }

  if (cleaned.includes(',')) {
    const commaLast = cleaned.lastIndexOf(',')
    const fractionPart = cleaned.slice(commaLast + 1)
    if (fractionPart.length <= 2) {
      const numeric = Number(cleaned.replace(',', '.'))
      return Number.isFinite(numeric) ? numeric : null
    }

    const numeric = Number(cleaned.replace(/,/g, ''))
    return Number.isFinite(numeric) ? numeric : null
  }

  const numeric = Number(cleaned)
  return Number.isFinite(numeric) ? numeric : null
}

export interface ProductPrice {
  unit: UnitType
  price: number
  conversion: number // how many base units (pcs) in this unit
}

export function parseProductPrices(value: unknown): ProductPrice[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return []
    const priceRecord = entry as Record<string, unknown>
    const unit = priceRecord.unit
    const price = coerceFiniteNumber(priceRecord.price)
    const conversion = coerceFiniteNumber(priceRecord.conversion)
    if (typeof unit !== 'string' || !isUnitType(unit) || price === null || conversion === null) return []
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

export type UserRole = 'admin'

export interface Profile {
  id: string
  full_name: string
  role: UserRole
  avatar_url: string | null
  created_at: string
}
