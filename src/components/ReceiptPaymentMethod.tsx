import { getPaymentMethodLabel } from '@/lib/paymentMethods'

export function ReceiptPaymentMethod({ method }: { method: string }) {
  const normalizedMethod = method.toLowerCase()
  if (normalizedMethod !== 'transfer' && normalizedMethod !== 'qris') {
    return (
      <div className="receipt-summary">
        <span>Pembayaran</span>
        <span>{getPaymentMethodLabel(method)}</span>
      </div>
    )
  }

  const isQr = normalizedMethod === 'qris'
  const label = isQr ? 'QR' : 'TRANSFER'

  return (
    <div className={`receipt-payment-method receipt-payment-method-${normalizedMethod}`}>
      <span className="receipt-payment-code" aria-hidden="true">{isQr ? 'QR' : 'TF'}</span>
      <span className="receipt-payment-copy">
        <span className="receipt-payment-caption">Metode pembayaran</span>
        <strong>{label}</strong>
      </span>
    </div>
  )
}
