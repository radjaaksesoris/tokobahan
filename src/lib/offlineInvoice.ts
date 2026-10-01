export function createOfflineInvoice() {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const suffix: string[] = []

  while (suffix.length < 9) {
    const randomValues = crypto.getRandomValues(new Uint8Array(16))
    for (const value of randomValues) {
      if (value >= 252) continue
      suffix.push(alphabet[value % alphabet.length])
      if (suffix.length === 9) break
    }
  }

  return `RJA-${suffix.join('')}`
}
