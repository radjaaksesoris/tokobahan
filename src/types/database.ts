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
      vendors: {
        Row: {
          id: string
          name: string
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          created_at?: string
        }
        Update: {
          name?: string
        }
        Relationships: []
      }
      customers: {
        Row: { id: string; name: string; normalized_name: string; created_at: string }
        Insert: { id?: string; name: string; created_at?: string }
        Update: { name?: string }
        Relationships: []
      }
      custom_units: {
        Row: { id: string; name: string; factor: number; created_at: string }
        Insert: { id?: string; name: string; factor: number; created_at?: string }
        Update: { name?: string; factor?: number }
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
          stock_unit: string
          stock_conversion: number
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
          stock_unit?: string
          stock_conversion?: number
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
          stock_unit?: string
          stock_conversion?: number
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
          customer_id: string | null
          amount_paid: number
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
          customer_id?: string | null
          amount_paid?: number
        }
        Update: {
          notes?: string | null
          customer_id?: string | null
          amount_paid?: number
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
      vendor_debt_payments: {
        Row: { id: string; stock_batch_id: string; amount: number; paid_at: string; paid_by: string | null }
        Insert: { id?: string; stock_batch_id: string; amount: number; paid_at?: string; paid_by?: string | null }
        Update: { amount?: number }
        Relationships: []
      }
      customer_debt_payments: {
        Row: { id: string; sale_id: string; amount: number; paid_at: string; paid_by: string | null }
        Insert: { id?: string; sale_id: string; amount: number; paid_at?: string; paid_by?: string | null }
        Update: { amount?: number }
        Relationships: []
      }
      invoice_sequences: {
        Row: {
          id: number
          next_number: number
        }
        Insert: {
          id?: number
          next_number?: number
        }
        Update: {
          next_number?: number
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          id: string
          user_id: string
          endpoint: string
          p256dh: string
          auth: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id?: string
          endpoint: string
          p256dh: string
          auth: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          endpoint?: string
          p256dh?: string
          auth?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_stock_batches: {
        Row: {
          id: string
          product_id: string
          quantity_received: number
          quantity_remaining: number
          unit_cost: number
          vendor_id: string | null
          payment_status: 'kredit' | 'lunas'
          due_date: string | null
          received_at: string
          created_at: string
        }
        Insert: {
          id?: string
          product_id: string
          quantity_received: number
          quantity_remaining: number
          unit_cost: number
          vendor_id?: string | null
          payment_status?: 'kredit' | 'lunas'
          due_date?: string | null
          received_at?: string
          created_at?: string
        }
        Update: {
          quantity_remaining?: number
          payment_status?: 'kredit' | 'lunas'
        }
        Relationships: [
          {
            foreignKeyName: 'product_stock_batches_product_id_fkey'
            columns: ['product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['id']
          },
        ]
      }
      operational_backups: {
        Row: {
          id: string
          created_by: string
          created_at: string
          backup_version: string
          payload: Json
          product_count: number
          category_count: number
          sale_count: number
          sale_item_count: number
          stock_batch_count: number
        }
        Insert: never
        Update: never
        Relationships: []
      }
      stock_adjustments: {
        Row: { id: string; product_id: string; system_stock: number; physical_stock: number; difference: number; reason: string; adjusted_by: string | null; created_at: string }
        Insert: { id?: string; product_id: string; system_stock: number; physical_stock: number; difference: number; reason: string; adjusted_by?: string | null; created_at?: string }
        Update: Record<string, never>
        Relationships: []
      }
      sale_returns: {
        Row: { id: string; sale_id: string; sale_item_id: string; quantity: number; refund_amount: number; reason: string; returned_by: string | null; created_at: string }
        Insert: { id?: string; sale_id: string; sale_item_id: string; quantity: number; refund_amount: number; reason: string; returned_by?: string | null; created_at?: string }
        Update: Record<string, never>
        Relationships: []
      }
    }
    Views: {}
    Functions: {
      next_invoice_number: {
        Args: Record<string, never>
        Returns: string
      }
      checkout_sale: {
        Args: {
          p_invoice_no: string
          p_total_amount: number
          p_total_cost: number
          p_total_profit: number
          p_payment_method: string
          p_cashier_id: string | null
          p_items: Json
          p_customer_name?: string | null
          p_amount_paid?: number | null
        }
        Returns: string
      }
      sales_summary: {
        Args: {
          p_start: string
          p_end: string
        }
        Returns: {
          total_revenue: number
          total_cost: number
          total_profit: number
          transaction_count: number
        }[]
      }
      sales_daily_summary: {
        Args: {
          p_start: string
          p_end: string
        }
        Returns: {
          sale_date: string
          total_revenue: number
          total_cost: number
          total_profit: number
          transaction_count: number
        }[]
      }
      reset_operational_data: {
        Args: Record<string, never>
        Returns: undefined
      }
      receive_stock_batch: {
        Args: {
          p_product_id: string
          p_quantity: number
          p_unit_cost: number
          p_vendor_id?: string | null
          p_payment_status?: 'kredit' | 'lunas'
          p_due_date?: string | null
        }
        Returns: undefined
      }
      create_operational_backup: {
        Args: Record<string, never>
        Returns: Json
      }
      upload_operational_backup: {
        Args: { p_payload: Json }
        Returns: Json
      }
      adjust_stock: {
        Args: { p_product_id: string; p_physical_stock: number; p_reason: string }
        Returns: string
      }
      return_sale_item: {
        Args: { p_sale_item_id: string; p_quantity: number; p_reason: string }
        Returns: string
      }
      restore_operational_backup: {
        Args: { p_payload: Json }
        Returns: undefined
      }
      pay_vendor_debt: {
        Args: { p_allocations: Json }
        Returns: undefined
      }
      pay_customer_debt: {
        Args: { p_sale_id: string; p_amount: number }
        Returns: string
      }
    }
    Enums: {}
    CompositeTypes: {}
  }
}
