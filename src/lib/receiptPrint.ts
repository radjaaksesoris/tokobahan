export async function printReceiptInFrame(receiptRoot: HTMLElement | null): Promise<void> {
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

    const stylePromises = Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]'))
      .filter((stylesheet) => new URL(stylesheet.href, document.baseURI).origin === window.location.origin)
      .map((stylesheet) => new Promise<void>((resolve, reject) => {
        const clonedStylesheet = stylesheet.cloneNode(true) as HTMLLinkElement
        clonedStylesheet.addEventListener('load', () => resolve(), { once: true })
        clonedStylesheet.addEventListener('error', () => reject(new Error('Gagal memuat gaya cetak struk')), { once: true })
        printDocument.head.append(clonedStylesheet)
      }))

    document.head.querySelectorAll('style').forEach((style) => {
      printDocument.head.append(style.cloneNode(true))
    })
    printDocument.body.append(receiptRoot.cloneNode(true))
    await Promise.all(stylePromises)

    const printWindow = frame.contentWindow
    if (!printWindow) {
      throw new Error('Jendela cetak struk tidak dapat diakses')
    }
    printWindow.focus()
    printWindow.print()
  } finally {
    frame.remove()
  }
}
