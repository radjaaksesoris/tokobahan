import {
  OPERATIONAL_SNAPSHOT_TABLES,
  type OperationalSnapshot,
} from '@/lib/offlineOperationalSnapshot'

type Row = Record<string, unknown>

function ids(rows: Row[], table: string) {
  const result = new Set<string>()
  for (const row of rows) {
    if (typeof row.id !== 'string' || !row.id) {
      throw new Error(`Snapshot tidak valid: baris ${table} tidak memiliki ID`)
    }
    if (result.has(row.id)) throw new Error(`Snapshot tidak valid: ID ${table} duplikat`)
    result.add(row.id)
  }
  return result
}

function requireReference(
  referencedIds: Set<string>,
  id: unknown,
  description: string,
  nullable = false,
) {
  if (nullable && (id === null || id === undefined)) return
  if (typeof id !== 'string' || !referencedIds.has(id)) {
    throw new Error(`Snapshot tidak valid: relasi ${description} tidak ditemukan`)
  }
}

function requireNumber(row: Row, field: string, description: string, minimum = 0) {
  const value = Number(row[field])
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(`Snapshot tidak valid: ${description} tidak valid`)
  }
}

export function validateOperationalSnapshotIntegrity(snapshot: OperationalSnapshot) {
  const tables = snapshot.tables
  const tableIds = Object.fromEntries(
    OPERATIONAL_SNAPSHOT_TABLES.map((table) => [table, ids(tables[table], table)]),
  ) as Record<(typeof OPERATIONAL_SNAPSHOT_TABLES)[number], Set<string>>

  for (const product of tables.products) {
    requireNumber(product, 'stock', 'stok produk')
    requireNumber(product, 'cost_price', 'harga modal')
    requireReference(tableIds.categories, product.category_id, 'kategori produk', true)
  }

  for (const batch of tables.product_stock_batches) {
    requireReference(tableIds.products, batch.product_id, 'produk batch stok')
    requireReference(tableIds.vendors, batch.vendor_id, 'vendor batch stok', true)
    requireNumber(batch, 'quantity_received', 'jumlah stok masuk', Number.EPSILON)
    requireNumber(batch, 'quantity_remaining', 'sisa batch stok')
    requireNumber(batch, 'unit_cost', 'HPP batch')
    if (Number(batch.quantity_remaining) > Number(batch.quantity_received)) {
      throw new Error('Snapshot tidak valid: sisa batch stok melebihi stok masuk')
    }
  }

  for (const sale of tables.sales) {
    requireReference(tableIds.customers, sale.customer_id, 'pelanggan transaksi', true)
    requireNumber(sale, 'total_amount', 'total transaksi')
    requireNumber(sale, 'amount_paid', 'pembayaran transaksi')
  }

  for (const item of tables.sale_items) {
    requireReference(tableIds.sales, item.sale_id, 'transaksi item')
    requireReference(tableIds.products, item.product_id, 'produk item')
    requireNumber(item, 'quantity', 'jumlah item', Number.EPSILON)
    requireNumber(item, 'unit_price', 'harga item')
  }

  for (const payment of tables.vendor_debt_payments) {
    requireReference(tableIds.product_stock_batches, payment.stock_batch_id, 'batch pembayaran vendor')
    requireNumber(payment, 'amount', 'pembayaran vendor', Number.EPSILON)
  }

  for (const payment of tables.customer_debt_payments) {
    requireReference(tableIds.sales, payment.sale_id, 'transaksi pembayaran pelanggan')
    requireNumber(payment, 'amount', 'pembayaran pelanggan', Number.EPSILON)
  }

  for (const adjustment of tables.stock_adjustments) {
    requireReference(tableIds.products, adjustment.product_id, 'produk stok opname')
    requireNumber(adjustment, 'physical_stock', 'stok fisik')
  }

  const saleItems = new Map(tables.sale_items.map((item) => [String(item.id), item]))
  const returnedQuantities = new Map<string, number>()
  for (const saleReturn of tables.sale_returns) {
    requireReference(tableIds.sales, saleReturn.sale_id, 'transaksi retur')
    const item = saleItems.get(String(saleReturn.sale_item_id))
    if (!item || item.sale_id !== saleReturn.sale_id) {
      throw new Error('Snapshot tidak valid: item transaksi retur tidak sesuai')
    }
    requireNumber(saleReturn, 'quantity', 'jumlah retur', Number.EPSILON)
    requireNumber(saleReturn, 'refund_amount', 'nilai retur')
    requireNumber(saleReturn, 'cash_refund_amount', 'pengembalian tunai')
    if (Number(saleReturn.cash_refund_amount) > Number(saleReturn.refund_amount)) {
      throw new Error('Snapshot tidak valid: pengembalian tunai melebihi nilai retur')
    }
    const returned = (returnedQuantities.get(String(saleReturn.sale_item_id)) || 0)
      + Number(saleReturn.quantity)
    if (returned > Number(item.quantity)) {
      throw new Error('Snapshot tidak valid: jumlah retur melebihi jumlah terjual')
    }
    returnedQuantities.set(String(saleReturn.sale_item_id), returned)
  }

  return snapshot
}
