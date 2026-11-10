import {
  updateOperationalSnapshot,
  type OperationalSnapshot,
} from '@/lib/offlineOperationalSnapshot'

export function createInactiveProductDeletionBlockReason(snapshot: OperationalSnapshot) {
  const products = new Map(snapshot.tables.products.map((product) => [String(product.id), product]))
  const productIdsWithSales = new Set(snapshot.tables.sale_items.map((item) => String(item.product_id)))
  const productIdsWithBatches = new Set(snapshot.tables.product_stock_batches.map((batch) => String(batch.product_id)))
  const productIdsWithAdjustments = new Set(snapshot.tables.stock_adjustments.map((adjustment) => String(adjustment.product_id)))

  return (productId: string) => {
    const product = products.get(productId)
    if (!product) return 'Produk tidak ditemukan di data lokal'
    if (product.is_active !== false) return 'Hanya produk nonaktif yang dapat dihapus permanen'
    if (typeof product.stock !== 'number' || !Number.isFinite(product.stock) || product.stock > 0) {
      return 'Stok produk masih tersedia'
    }
    if (productIdsWithSales.has(productId)) return 'Produk memiliki riwayat transaksi'
    if (productIdsWithBatches.has(productId)) return 'Produk memiliki riwayat stok masuk'
    if (productIdsWithAdjustments.has(productId)) return 'Produk memiliki riwayat penyesuaian stok'
    return null
  }
}

export function getInactiveProductDeletionBlockReason(
  snapshot: OperationalSnapshot,
  productId: string,
) {
  return createInactiveProductDeletionBlockReason(snapshot)(productId)
}

export async function permanentlyDeleteUnusedInactiveProduct(productId: string) {
  await updateOperationalSnapshot((snapshot) => {
    const blockReason = getInactiveProductDeletionBlockReason(snapshot, productId)
    if (blockReason) throw new Error(blockReason)

    return {
      snapshot: {
        ...snapshot,
        tables: {
          ...snapshot.tables,
          products: snapshot.tables.products.filter((product) => product.id !== productId),
        },
      },
      result: undefined,
    }
  })
}
