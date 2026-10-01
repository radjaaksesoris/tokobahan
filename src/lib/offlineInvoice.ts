export function createOfflineInvoice() {
  const date = new Date().toISOString().replace(/\D/g, '').slice(2, 8)
  return `RJA-${date}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
}
