import {
  updateOperationalSnapshot,
  type OperationalSnapshot,
} from '@/lib/offlineOperationalSnapshot'

export function getInactiveProductDeletionBlockReason(
  snapshot: OperationalSnapshot,
  productId: string,
) {
  const product = snapshot.tables.products.find((row) => row.id === productId)
  if (!product) return 'Produk tidak ditemukan di data lokal'
  if (product.is_active !== false) return 'Hanya produk nonaktif yang dapat dihapus permanen'
  if (typeof product.stock !== 'number' || !Number.isFinite(product.stock) || product.stock > 0) {
    return 'Stok produk masih tersedia'
  }
  if (snapshot.tables.sale_items.some((item) => item.product_id === productId)) {
    return 'Produk memiliki riwayat transaksi'
  }
  if (snapshot.tables.product_stock_batches.some((batch) => batch.product_id === productId)) {
    return 'Produk memiliki riwayat stok masuk'
  }
  if (snapshot.tables.stock_adjustments.some((adjustment) => adjustment.product_id === productId)) {
    return 'Produk memiliki riwayat penyesuaian stok'
  }
  return null
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
