import qz from 'qz-tray'

export interface QzReceipt {
  invoiceNo: string
  createdAt: string
  paymentMethod: 'cash' | 'qris' | 'credit'
  customerName: string | null
  amountPaid: number
  change: number
  total: number
  items: Array<{
    name: string
    unit: string
    quantity: number
    unitPrice: number
    lineTotal: number
  }>
}

const QZ_PRINTER_KEY = 'qz-printer'
let connectionPromise: Promise<void> | null = null

function formatAmount(amount: number) {
  return `Rp ${Math.round(amount).toLocaleString('id-ID')}`
}

function textReceipt(receipt: QzReceipt) {
  const lines = [
    '       RADJA AKSESORIS',
    '           Konveksi',
    '-------------------------------',
    `No. ${receipt.invoiceNo}`,
    new Date(receipt.createdAt).toLocaleString('id-ID'),
    ...(receipt.customerName ? [`Pelanggan: ${receipt.customerName}`] : []),
    '-------------------------------',
    ...receipt.items.flatMap((item) => [
      item.name,
      `${item.quantity} ${item.unit} x ${formatAmount(item.unitPrice)}`,
      `                         ${formatAmount(item.lineTotal)}`,
    ]),
    '-------------------------------',
    `TOTAL                    ${formatAmount(receipt.total)}`,
    `Pembayaran               ${paymentLabel(receipt.paymentMethod)}`,
    ...(receipt.paymentMethod === 'cash'
      ? [`Dibayar                 ${formatAmount(receipt.amountPaid)}`, `Kembalian              ${formatAmount(receipt.change)}`]
      : []),
    ...(receipt.paymentMethod === 'credit' && receipt.amountPaid > 0
      ? [`Dibayar sebagian        ${formatAmount(receipt.amountPaid)}`, `Sisa hutang            ${formatAmount(Math.max(0, receipt.total - receipt.amountPaid))}`]
      : []),
    '',
    '        Terima kasih',
    '',
    '',
  ]
  return `\x1B\x40${lines.join('\n')}\x1D\x56\x00`
}

function paymentLabel(method: QzReceipt['paymentMethod']) {
  return { cash: 'Tunai', qris: 'QRIS', credit: 'Hutang' }[method]
}

async function connectQz() {
  if (qz.websocket.isActive()) return
  if (!connectionPromise) {
    connectionPromise = qz.websocket.connect().finally(() => {
      connectionPromise = null
    })
  }
  await connectionPromise
}

export async function printReceiptWithQz(receipt: QzReceipt) {
  await connectQz()
  const savedPrinter = localStorage.getItem(QZ_PRINTER_KEY)
  const printer = savedPrinter || await qz.printers.find()
  if (!printer || typeof printer !== 'string') {
    throw new Error('Printer QZ Tray tidak ditemukan')
  }
  localStorage.setItem(QZ_PRINTER_KEY, printer)
  const config = qz.configs.create(printer, {
    margins: 0,
    scaleContent: false,
    copies: 1,
  })
  await qz.print(config, [{ type: 'raw', format: 'command', data: textReceipt(receipt) }])
}
