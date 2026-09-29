import { formatCurrency } from '@/lib/utils'

export interface LocalReceipt {
  title: string
  invoiceNo: string
  createdAt: string
  customerName: string | null
  items: Array<{
    name: string
    unit: string
    quantity: number
    unitPrice: number
    lineTotal: number
  }>
  total: number
  summaries: Array<{ label: string; value: string }>
}

const LOCAL_PRINTER_URL = 'http://127.0.0.1:17854'

interface LocalAddressRequestInit extends RequestInit {
  targetAddressSpace: 'local'
}

function paymentSummaries(paymentMethod: string, amountPaid: number, total: number, change = 0) {
  const labels: Record<string, string> = {
    cash: 'Tunai',
    qris: 'QRIS',
    credit: 'Hutang',
  }
  const summaries = [{ label: 'Pembayaran', value: labels[paymentMethod] || paymentMethod }]

  if (paymentMethod === 'cash') {
    summaries.push(
      { label: 'Dibayar', value: formatCurrency(amountPaid) },
      { label: 'Kembalian', value: formatCurrency(change) },
    )
  } else if (paymentMethod === 'credit' && amountPaid > 0) {
    summaries.push(
      { label: 'Dibayar sebagian', value: formatCurrency(amountPaid) },
      { label: 'Sisa hutang', value: formatCurrency(Math.max(0, total - amountPaid)) },
    )
  }

  return summaries
}

export function createSalesReceiptPrintData(receipt: {
  invoiceNo: string
  createdAt: string
  paymentMethod: string
  customerName: string | null
  amountPaid: number
  change?: number
  total: number
  items: LocalReceipt['items']
}): LocalReceipt {
  return {
    title: 'Struk Penjualan',
    invoiceNo: receipt.invoiceNo,
    createdAt: receipt.createdAt,
    customerName: receipt.customerName,
    items: receipt.items,
    total: receipt.total,
    summaries: paymentSummaries(receipt.paymentMethod, receipt.amountPaid, receipt.total, receipt.change),
  }
}

export function createSettlementReceiptPrintData(receipt: {
  invoiceNo: string
  createdAt: string
  customerName: string
  total: number
  payment: number
  remainingDebt: number
  pendingSync: boolean
  items: Array<{
    name: string
    unit: string
    quantity: number
    unitPrice: number
    subtotal: number
  }>
}): LocalReceipt {
  return {
    title: 'Struk Pembayaran Hutang',
    invoiceNo: receipt.invoiceNo,
    createdAt: receipt.createdAt,
    customerName: receipt.customerName,
    items: receipt.items.map(({ subtotal, ...item }) => ({ ...item, lineTotal: subtotal })),
    total: receipt.total,
    summaries: [
      { label: 'Bayar hutang', value: formatCurrency(receipt.payment) },
      { label: 'Sisa hutang', value: formatCurrency(receipt.remainingDebt) },
      ...(receipt.pendingSync ? [{ label: 'Status', value: 'Menunggu sinkronisasi' }] : []),
    ],
  }
}

export async function printReceiptLocally(receipt: LocalReceipt): Promise<void> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 15_000)

  try {
    const request: LocalAddressRequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(receipt),
      mode: 'cors',
      credentials: 'omit',
      signal: controller.signal,
      targetAddressSpace: 'local',
    }
    const response = await fetch(`${LOCAL_PRINTER_URL}/print`, request)

    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null
      throw new Error(body?.error || `Printer lokal menolak permintaan (${response.status})`)
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Waktu tunggu printer habis. Periksa program printer lokal dan POS58.')
    }
    if (error instanceof TypeError) {
      throw new Error('Browser memblokir koneksi printer lokal. Pastikan RAJA Local Printer versi terbaru berjalan di http://127.0.0.1:17854/health dan izinkan akses jaringan lokal untuk situs POS.')
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}
