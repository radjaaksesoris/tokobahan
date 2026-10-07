import { startOfDay, endOfDay } from 'date-fns'
import type { OperationalSnapshot } from '@/lib/offlineOperationalSnapshot'

export interface SalesSummary {
  total_revenue: number
  total_credit: number
  total_cost: number
  total_profit: number
  transaction_count: number
}

export interface DailySummaryRow extends SalesSummary {
  sale_date: string
}

export interface VendorPaymentRow {
  total_amount: number
  paid_date: string
}

export interface LowStockProduct {
  id: string
  name: string
  stock: number
  min_stock: number
}

export interface DashboardAnalytics {
  todaySales: number
  todayProfit: number
  todayOrders: number
  todayPaymentCounts: {
    cash: number
    credit: number
    transfer: number
    qris: number
  }
  totalProducts: number
  lowStock: number
  lowStockProducts: LowStockProduct[]
}

const jakartaDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function asRows(snapshot: OperationalSnapshot, table: keyof OperationalSnapshot['tables']) {
  return snapshot.tables[table] as Record<string, unknown>[]
}

function asNumber(value: unknown) {
  const number = Number(value ?? 0)
  if (!Number.isFinite(number)) throw new Error('Angka pada snapshot operasional lokal tidak valid')
  return number
}

function timestamp(value: unknown) {
  const result = typeof value === 'string' || value instanceof Date ? new Date(value).getTime() : NaN
  if (!Number.isFinite(result)) throw new Error('Tanggal pada snapshot operasional lokal tidak valid')
  return result
}

function dateInJakarta(value: unknown) {
  const parts = jakartaDateFormatter.formatToParts(new Date(timestamp(value)))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value
  const year = part('year')
  const month = part('month')
  const day = part('day')
  if (!year || !month || !day) throw new Error('Tanggal pada snapshot operasional lokal tidak valid')
  return `${year}-${month}-${day}`
}

function inRange(value: unknown, start: Date, end: Date) {
  const time = timestamp(value)
  return time >= start.getTime() && time <= end.getTime()
}

function emptySummary(): SalesSummary {
  return {
    total_revenue: 0,
    total_credit: 0,
    total_cost: 0,
    total_profit: 0,
    transaction_count: 0,
  }
}

function summarizeSales(
  snapshot: OperationalSnapshot,
  start: Date,
  end: Date,
) {
  const summary = emptySummary()
  const daily = new Map<string, DailySummaryRow>()
  const getDay = (date: string) => {
    let row = daily.get(date)
    if (!row) {
      row = { sale_date: date, ...emptySummary() }
      daily.set(date, row)
    }
    return row
  }

  for (const sale of asRows(snapshot, 'sales')) {
    if (!inRange(sale.created_at, start, end)) continue
    const date = dateInJakarta(sale.created_at)
    const amountPaid = asNumber(sale.amount_paid)
    const credit = sale.payment_method === 'credit' ? asNumber(sale.total_amount) : 0
    const cost = asNumber(sale.total_cost)
    const profit = asNumber(sale.total_profit)
    summary.total_revenue += amountPaid
    summary.total_credit += credit
    summary.total_cost += cost
    summary.total_profit += profit
    summary.transaction_count += 1
    const row = getDay(date)
    row.total_revenue += amountPaid
    row.total_credit += credit
    row.total_cost += cost
    row.total_profit += profit
    row.transaction_count += 1
  }

  for (const payment of asRows(snapshot, 'customer_debt_payments')) {
    if (!inRange(payment.paid_at, start, end)) continue
    const amount = asNumber(payment.amount)
    summary.total_revenue += amount
    getDay(dateInJakarta(payment.paid_at)).total_revenue += amount
  }

  for (const saleReturn of asRows(snapshot, 'sale_returns')) {
    if (!inRange(saleReturn.created_at, start, end)) continue
    const cashRefund = asNumber(saleReturn.cash_refund_amount)
    summary.total_revenue -= cashRefund
    getDay(dateInJakarta(saleReturn.created_at)).total_revenue -= cashRefund
  }

  return {
    summary,
    dailySummary: [...daily.values()].sort((left, right) => left.sale_date.localeCompare(right.sale_date)),
  }
}

export function getLocalReportAnalytics(
  snapshot: OperationalSnapshot,
  start: Date,
  end: Date,
) {
  const { summary, dailySummary } = summarizeSales(snapshot, start, end)
  const vendorPayments = new Map<string, number>()
  for (const payment of asRows(snapshot, 'vendor_debt_payments')) {
    if (!inRange(payment.paid_at, start, end)) continue
    const date = dateInJakarta(payment.paid_at)
    vendorPayments.set(date, (vendorPayments.get(date) || 0) + asNumber(payment.amount))
  }
  return {
    summary,
    dailySummary,
    vendorPayments: [...vendorPayments.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([paid_date, total_amount]) => ({ paid_date, total_amount })),
  }
}

export function getLocalDashboardAnalytics(
  snapshot: OperationalSnapshot,
  now = new Date(),
): DashboardAnalytics {
  const todayStart = startOfDay(now)
  const todayEnd = endOfDay(now)
  const { summary: todaySummary } = summarizeSales(snapshot, todayStart, todayEnd)
  const todayPaymentCounts = { cash: 0, credit: 0, transfer: 0, qris: 0 }
  for (const sale of asRows(snapshot, 'sales')) {
    if (!inRange(sale.created_at, todayStart, todayEnd)) continue
    const method = String(sale.payment_method || '').toLowerCase()
    if (method === 'cash') todayPaymentCounts.cash += 1
    else if (method === 'credit') todayPaymentCounts.credit += 1
    else if (method === 'transfer') todayPaymentCounts.transfer += 1
    else if (method === 'qris' || method === 'qr') todayPaymentCounts.qris += 1
  }
  const activeProducts = asRows(snapshot, 'products')
    .filter((product) => product.is_active === true)
  const lowStockProducts = activeProducts
    .filter((product) => asNumber(product.stock) <= asNumber(product.min_stock))
    .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')))
  const lowStock = lowStockProducts.length

  return {
    todaySales: todaySummary.total_revenue,
    todayProfit: todaySummary.total_profit,
    todayOrders: todaySummary.transaction_count,
    todayPaymentCounts,
    totalProducts: activeProducts.length,
    lowStock,
    lowStockProducts: lowStockProducts.slice(0, 100).map((product) => ({
      id: String(product.id),
      name: String(product.name || ''),
      stock: asNumber(product.stock),
      min_stock: asNumber(product.min_stock),
    })),
  }
}
