export function assertCreditSaleCanChangePaymentMethod(
  sale: Record<string, unknown>,
  payments: Array<{ sale_id?: unknown; amount?: unknown }>,
): void {
  if (sale.payment_method !== 'credit') return

  const recordedPayments = payments.filter((payment) => payment.sale_id === sale.id)
  if (recordedPayments.length > 0) {
    throw new Error('Transaksi kredit yang sudah memiliki cicilan tidak dapat diubah menjadi metode pembayaran lain')
  }

  const total = Number(sale.total_amount)
  const amountPaid = Number(sale.amount_paid)
  if (!Number.isFinite(total) || !Number.isFinite(amountPaid) || amountPaid < 0 || amountPaid > total + 0.009) {
    throw new Error('Data pembayaran transaksi kredit tidak valid')
  }
  const outstanding = total - amountPaid
  if (outstanding > 0.009) {
    throw new Error('Sisa hutang belum lunas. Catat pelunasan sebelum mengubah metode pembayaran.')
  }
}
