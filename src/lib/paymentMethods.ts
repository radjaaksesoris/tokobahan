export type PaymentMethod = 'cash' | 'credit' | 'transfer' | 'qris'

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Tunai',
  credit: 'Kredit',
  transfer: 'Transfer',
  qris: 'QR',
}

export function getPaymentMethodLabel(method: string): string {
  const normalizedMethod = method.toLowerCase()
  return Object.hasOwn(PAYMENT_METHOD_LABELS, normalizedMethod)
    ? PAYMENT_METHOD_LABELS[normalizedMethod as PaymentMethod]
    : method
}
