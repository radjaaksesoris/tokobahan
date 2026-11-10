const pageChunkImporters = {
  pos: () => import('@/pages/POS'),
  products: () => import('@/pages/Products'),
  stockHistory: () => import('@/pages/StockHistory'),
  stockOpname: () => import('@/pages/StockOpname'),
  reports: () => import('@/pages/Reports'),
  transactions: () => import('@/pages/TransactionHistory'),
  settings: () => import('@/pages/Settings'),
  settlements: () => import('@/pages/Settlements'),
  notFound: () => import('@/pages/NotFound'),
}

type PageChunk = keyof typeof pageChunkImporters

const routeChunks: Array<[string, PageChunk]> = [
  ['/products/stock-opname', 'stockOpname'],
  ['/products/history', 'stockHistory'],
  ['/transactions', 'transactions'],
  ['/settlements', 'settlements'],
  ['/products', 'products'],
  ['/reports', 'reports'],
  ['/settings', 'settings'],
  ['/pos', 'pos'],
]

export function getPageChunkImporter(page: PageChunk) {
  return pageChunkImporters[page]
}

export function preloadPageChunk(pathname: string) {
  const chunk = routeChunks.find(([route]) =>
    route === '/'
      ? pathname === route
      : pathname === route || pathname.startsWith(`${route}/`),
  )?.[1]
  if (!chunk) return

  void pageChunkImporters[chunk]().catch((error) => {
    console.warn(`Gagal memuat awal halaman ${chunk}:`, error)
  })
}
