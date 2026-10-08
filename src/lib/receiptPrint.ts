export function printReceiptInFrame(receiptRoot: HTMLElement | null): void {
  if (!receiptRoot) {
    throw new Error('Konten struk tidak ditemukan')
  }

  const frame = document.createElement('iframe')
  frame.title = 'Cetak struk'
  frame.setAttribute('aria-hidden', 'true')
  frame.style.position = 'fixed'
  frame.style.left = '-10000px'
  frame.style.top = '0'
  frame.style.width = '58mm'
  frame.style.height = '1px'
  frame.style.border = '0'
  document.body.append(frame)

  try {
    const printDocument = frame.contentDocument
    if (!printDocument) {
      throw new Error('Jendela cetak struk tidak dapat dibuat')
    }

    printDocument.open()
    printDocument.write('<!doctype html><html><head></head><body></body></html>')
    printDocument.close()
    printDocument.documentElement.lang = document.documentElement.lang

    const base = printDocument.createElement('base')
    base.href = document.baseURI
    printDocument.head.append(base)
    Array.from(document.styleSheets).forEach((stylesheet) => {
      if (stylesheet.href && new URL(stylesheet.href, document.baseURI).origin !== window.location.origin) return

      const style = printDocument.createElement('style')
      style.media = stylesheet.media.mediaText
      style.textContent = Array.from(stylesheet.cssRules, (rule) => rule.cssText).join('\n')
      printDocument.head.append(style)
    })
    printDocument.body.append(receiptRoot.cloneNode(true))

    const printWindow = frame.contentWindow
    if (!printWindow) {
      throw new Error('Jendela cetak struk tidak dapat diakses')
    }
    printWindow.addEventListener('afterprint', () => frame.remove(), { once: true })
    printWindow.focus()
    printWindow.print()
  } catch (error) {
    frame.remove()
    throw error
  }
}
