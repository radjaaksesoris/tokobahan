import {
  ensureOfflineOperationalStores,
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
} from '@/lib/offlineOperationalSnapshot'

export type SettlementKind = 'vendor' | 'customer'
export type QueuedSettlementStatus = 'pending' | 'syncing' | 'failed'

export interface VendorSettlementPayload {
  allocations: Array<{ stock_batch_id: string; amount: number }>
}
export interface CustomerSettlementPayload {
  sale_id: string
  amount: number
}
export interface QueuedSettlement {
  id: string
  userId?: string
  idempotencyKey?: string
  kind: SettlementKind
  payload: VendorSettlementPayload | CustomerSettlementPayload
  status: QueuedSettlementStatus
  attempts: number
  lastError: string | null
  createdAt: string
  syncStartedAt?: string
}

const STORE_NAME = 'offline-settlements'

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

export async function getQueuedSettlements(): Promise<QueuedSettlement[]> {
  const database = await openDatabase()
  try {
    return await new Promise<QueuedSettlement[]>((resolve, reject) => {
      const request = database
        .transaction(STORE_NAME, 'readonly')
        .objectStore(STORE_NAME)
        .getAll()
      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => reject(request.error || new Error('Gagal membaca antrean pelunasan lama'))
    })
  } finally {
    database.close()
  }
}
