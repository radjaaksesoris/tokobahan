export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          full_name: string
          role: 'admin' | 'cashier' | 'monitor'
          avatar_url: string | null
          created_at: string
        }
        Insert: {
          id: string
          full_name: string
          role?: 'admin' | 'cashier' | 'monitor'
          avatar_url?: string | null
        }
        Update: {
          full_name?: string
          role?: 'admin' | 'cashier' | 'monitor'
          avatar_url?: string | null
        }
        Relationships: []
      }
      categories: {
        Row: {
          id: string
          name: string
          created_at: string
        }
        Insert: {
          id?: string
          name: string
        }
        Update: {
          name?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          id: string
          name: string
          sku: string | null
          barcode: string | null
          category_id: string | null
          cost_price: number
          cost_unit: string
          cost_conversion: number
          stock: number
          min_stock: number
          unit_base: string
          prices: Json
          image_url: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          sku?: string | null
          barcode?: string | null
          category_id?: string | null
          cost_price?: number
          cost_unit?: string
          cost_conversion?: number
          stock?: number
          min_stock?: number
          unit_base?: string
          prices?: Json
          image_url?: string | null
          is_active?: boolean
        }
        Update: {
          name?: string
          sku?: string | null
          barcode?: string | null
          category_id?: string | null
          cost_price?: number
          cost_unit?: string
          cost_conversion?: number
          stock?: number
          min_stock?: number
          unit_base?: string
          prices?: Json
          image_url?: string | null
          is_active?: boolean
        }
        Relationships: []
      }
      sales: {
        Row: {
          id: string
          invoice_no: string
          total_amount: number
          total_cost: number
          total_profit: number
          payment_method: string
          notes: string | null
          cashier_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          invoice_no: string
          total_amount: number
          total_cost: number
          total_profit: number
          payment_method?: string
          notes?: string | null
          cashier_id?: string | null
        }
        Update: {
          notes?: string | null
        }
        Relationships: []
      }
      sale_items: {
        Row: {
          id: string
          sale_id: string
          product_id: string
          product_name: string
          unit: string
          quantity: number
          conversion: number
          unit_price: number
          line_total: number
          line_cost: number
          line_profit: number
        }
        Insert: {
          id?: string
          sale_id: string
          product_id: string
          product_name: string
          unit: string
          quantity: number
          conversion: number
          unit_price: number
          line_total: number
          line_cost: number
          line_profit: number
        }
        Update: Record<string, never>
        Relationships: []
      }
    }
    Views: {}
    Functions: {}
    Enums: {}
    CompositeTypes: {}
  }
}
