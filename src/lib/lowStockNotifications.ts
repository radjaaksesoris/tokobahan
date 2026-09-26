export function getUnnotifiedProducts<T extends { id: string }>(
  products: T[],
  notifiedIds: string[],
) {
  const notified = new Set(notifiedIds)
  return products.filter((product) => !notified.has(product.id))
}
