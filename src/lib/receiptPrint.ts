export function invokeReceiptPrint(receiptRoot: HTMLElement | null): void {
  if (!receiptRoot?.isConnected) {
    throw new Error('Konten struk tidak ditemukan')
  }
  if (receiptRoot.parentElement !== document.body) {
    throw new Error('Konten struk tidak berada di dokumen utama')
  }

  window.print()
}
