import { describe, expect, it } from 'vitest'
import {
  OPERATIONAL_SNAPSHOT_TABLES,
  type OperationalSnapshot,
} from './offlineOperationalSnapshot'
import {
  getLocalDashboardAnalytics,
  getLocalReportAnalytics,
} from './offlineOperationalAnalytics'

function createSnapshot(overrides: Partial<OperationalSnapshot['tables']> = {}): OperationalSnapshot {
  const tables = Object.fromEntries(OPERATIONAL_SNAPSHOT_TABLES.map((table) => [table, []]))
  return {
    format: 'tokobahan-operational-backup',
    version: '3',
    generated_at: '2026-10-01T00:00:00.000Z',
    generated_by: 'admin-1',
    tables: { ...tables, ...overrides } as OperationalSnapshot['tables'],
  }
}

describe('offline operational analytics', () => {
  it('matches report summaries, Jakarta daily buckets, and vendor payment totals', () => {
    const snapshot = createSnapshot({
      sales: [
        {
          id: 'sale-1',
          created_at: '2026-10-01T01:00:00.000Z',
          amount_paid: 50,
          total_amount: 100,
          total_cost: 30,
          total_profit: 70,
          payment_method: 'credit',
        },
        {
          id: 'sale-outside',
          created_at: '2026-09-30T16:59:59.000Z',
          amount_paid: 1000,
          total_amount: 1000,
          total_cost: 500,
          total_profit: 500,
          payment_method: 'cash',
        },
      ],
      customer_debt_payments: [
        { id: 'customer-payment-1', paid_at: '2026-10-01T03:00:00.000Z', amount: 25 },
      ],
      vendor_debt_payments: [
        { id: 'vendor-payment-1', paid_at: '2026-10-01T05:00:00.000Z', amount: 15 },
        { id: 'vendor-payment-2', paid_at: '2026-10-01T06:00:00.000Z', amount: 5 },
      ],
    })

    const analytics = getLocalReportAnalytics(
      snapshot,
      new Date('2026-10-01T00:00:00.000Z'),
      new Date('2026-10-01T23:59:59.999Z'),
    )

    expect(analytics.summary).toEqual({
      total_revenue: 75,
      total_credit: 100,
      total_cost: 30,
      total_profit: 70,
      transaction_count: 1,
    })
    expect(analytics.dailySummary).toEqual([{
      sale_date: '2026-10-01',
      total_revenue: 75,
      total_credit: 100,
      total_cost: 30,
      total_profit: 70,
      transaction_count: 1,
    }])
    expect(analytics.vendorPayments).toEqual([
      { paid_date: '2026-10-01', total_amount: 20 },
    ])
  })

  it('summarizes active products and low stock with dashboard cash and profit', () => {
    const snapshot = createSnapshot({
      sales: [{
        id: 'sale-today',
        created_at: '2026-10-01T04:00:00.000Z',
        amount_paid: 20,
        total_amount: 20,
        total_cost: 12,
        total_profit: 8,
        payment_method: 'cash',
      }],
      products: [
        { id: 'active-low', name: 'Benang', stock: 2, min_stock: 3, is_active: true },
        { id: 'active-ok', name: 'Kain', stock: 8, min_stock: 2, is_active: true },
        { id: 'inactive-low', name: 'Resleting', stock: 0, min_stock: 2, is_active: false },
      ],
    })

    const analytics = getLocalDashboardAnalytics(snapshot, new Date('2026-10-01T12:00:00.000Z'))

    expect(analytics).toMatchObject({
      todaySales: 20,
      todayProfit: 8,
      todayOrders: 1,
      totalProducts: 2,
      lowStock: 1,
      lowStockProducts: [{ id: 'active-low', name: 'Benang', stock: 2, min_stock: 3 }],
    })
    expect(analytics.weekData).toHaveLength(7)
    expect(analytics.weekData.at(-1)).toMatchObject({ sales: 20, profit: 8 })
  })
})
