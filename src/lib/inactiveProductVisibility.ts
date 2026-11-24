export const INACTIVE_PRODUCT_VISIBILITY_EVENT = 'tokobahan:inactive-product-visibility-change'

const INACTIVE_PRODUCT_VISIBILITY_KEY = 'tokobahan.showInactiveProducts'

export function getInactiveProductVisibility() {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(INACTIVE_PRODUCT_VISIBILITY_KEY) === 'true'
}

export function setInactiveProductVisibility(visible: boolean) {
  if (typeof window === 'undefined') {
    throw new Error('Pengaturan tampilan barang nonaktif tidak tersedia')
  }
  window.localStorage.setItem(INACTIVE_PRODUCT_VISIBILITY_KEY, String(visible))
  window.dispatchEvent(new Event(INACTIVE_PRODUCT_VISIBILITY_EVENT))
}
