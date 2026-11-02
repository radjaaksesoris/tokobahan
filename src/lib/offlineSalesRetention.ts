import type { OperationalSnapshot } from '@/lib/offlineOperationalSnapshot'

export const MAX_RETAINED_PAID_SALES = 500
const DEBT_BALANCE_TOLERANCE = 0.009

function outstandingBalance(
  sale: Record<string, unknown>,
  paymentTotals: Map<string, number>,
  invalidPaymentTotals: Set<string>,
) {
  const total = Number(sale.total_amount)
  const paid = Number(sale.amount_paid ?? 0)
  if (!Number.isFinite(total) || !Number.isFinite(paid)) return null
  const saleId = String(sale.id)
  if (invalidPaymentTotals.has(saleId)) return null
  return Math.max(total - paid - (paymentTotals.get(saleId) || 0), 0)
}

export function pruneOperationalSales(
  snapshot: OperationalSnapshot,
  limit = MAX_RETAINED_PAID_SALES,
): OperationalSnapshot {
  if (!Number.isInteger(limit) || limit < 0) {
    throw new RangeError('Batas riwayat transaksi harus berupa bilangan bulat nonnegatif')
  }

  const { sales, customer_debt_payments: payments, sale_items: items, sale_returns: returns } = snapshot.tables
  const paymentTotals = new Map<string, number>()
  const invalidPaymentTotals = new Set<string>()
  for (const payment of payments) {
    const saleId = String(payment.sale_id)
    const amount = Number(payment.amount)
    if (!Number.isFinite(amount)) {
      invalidPaymentTotals.add(saleId)
      continue
    }
    paymentTotals.set(saleId, (paymentTotals.get(saleId) || 0) + amount)
  }

  const unpaidSaleIds = new Set(
    sales
      .filter((sale) => sale.payment_method === 'credit')
      .filter((sale) => {
        const balance = outstandingBalance(sale, paymentTotals, invalidPaymentTotals)
        return balance === null || balance > DEBT_BALANCE_TOLERANCE
      })
      .map((sale) => String(sale.id)),
  )
  const eligibleSales = sales
    .filter((sale) => !unpaidSaleIds.has(String(sale.id)))
    .sort((left, right) => {
      const leftTime = Date.parse(String(left.created_at))
      const rightTime = Date.parse(String(right.created_at))
      const safeLeftTime = Number.isFinite(leftTime) ? leftTime : Number.POSITIVE_INFINITY
      const safeRightTime = Number.isFinite(rightTime) ? rightTime : Number.POSITIVE_INFINITY
      return safeRightTime - safeLeftTime || String(right.id).localeCompare(String(left.id))
    })
  const deletedSales = eligibleSales.slice(limit)
  if (deletedSales.length === 0) return snapshot

  const deletedSaleIds = new Set(deletedSales.map((sale) => String(sale.id)))
  const deletedItemIds = new Set(
    items
      .filter((item) => deletedSaleIds.has(String(item.sale_id)))
      .map((item) => String(item.id)),
  )

  return {
    ...snapshot,
    tables: {
      ...snapshot.tables,
      sales: sales.filter((sale) => !deletedSaleIds.has(String(sale.id))),
      sale_items: items.filter((item) => !deletedItemIds.has(String(item.id))),
      customer_debt_payments: payments.filter((payment) => !deletedSaleIds.has(String(payment.sale_id))),
      sale_returns: returns.filter((saleReturn) =>
        !deletedSaleIds.has(String(saleReturn.sale_id)) &&
        !deletedItemIds.has(String(saleReturn.sale_item_id)),
      ),
    },
  }
}
