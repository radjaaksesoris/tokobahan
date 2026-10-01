import {
  ensureOfflineOperationalStores,
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
} from '@/lib/offlineOperationalSnapshot'

export type QueuedTransactionStatus = 'pending' | 'syncing' | 'failed'

export interface QueuedTransaction {
  id: string
  invoiceNo: string
  totalAmount: number
  totalCost: number
  totalProfit: number
  paymentMethod: string
  customerName: string | null
  amountPaid: number
  cashierId: string | null
  items: Array<Record<string, string | number>>
  status: QueuedTransactionStatus
  attempts: number
  lastError: string | null
  createdAt: string
  syncStartedAt?: string
}

const STORE_NAME = 'offline-transactions'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('Penyimpanan offline tidak tersedia di browser ini'))
      return
    }
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION)
    request.onupgradeneeded = () => ensureOfflineOperationalStores(request.result)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Gagal membuka penyimpanan offline'))
  })
}

export async function getQueuedTransactions(): Promise<QueuedTransaction[]> {
  const database = await openDatabase()
  try {
    return await new Promise<QueuedTransaction[]>((resolve, reject) => {
      const request = database
        .transaction(STORE_NAME, 'readonly')
        .objectStore(STORE_NAME)
        .getAll()
      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => reject(request.error || new Error('Gagal membaca antrean transaksi lama'))
    })
  } finally {
    database.close()
  }
}
