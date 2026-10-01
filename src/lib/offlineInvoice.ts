import {
  ensureOfflineOperationalStores,
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  OFFLINE_INVOICE_SEQUENCE_STORE,
} from '@/lib/offlineOperationalSnapshot'

const INVOICE_SEQUENCE_KEY = 'current'
const MAX_INVOICE_NUMBER = Number.MAX_SAFE_INTEGER

export function createOfflineInvoice(): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      ensureOfflineOperationalStores(database)
    }
    request.onerror = () => reject(request.error || new Error('Gagal membuka penyimpanan nomor invoice'))
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction(OFFLINE_INVOICE_SEQUENCE_STORE, 'readwrite')
      const store = transaction.objectStore(OFFLINE_INVOICE_SEQUENCE_STORE)
      const readRequest = store.get(INVOICE_SEQUENCE_KEY)
      let invoiceNumber: number | null = null

      readRequest.onerror = () => {
        transaction.abort()
      }
      readRequest.onsuccess = () => {
        const current = Number(readRequest.result?.nextNumber || 1)
        if (!Number.isSafeInteger(current) || current < 1 || current > MAX_INVOICE_NUMBER - 1) {
          transaction.abort()
          return
        }
        invoiceNumber = current
        store.put({ id: INVOICE_SEQUENCE_KEY, nextNumber: current + 1 })
      }
      transaction.oncomplete = () => {
        database.close()
        if (invoiceNumber === null) {
          reject(new Error('Nomor invoice tidak dapat dibuat'))
          return
        }
        resolve(`RJA-${String(invoiceNumber).padStart(5, '0')}`)
      }
      transaction.onerror = () => {
        database.close()
        reject(transaction.error || new Error('Gagal menyimpan nomor invoice'))
      }
      transaction.onabort = () => {
        database.close()
        reject(new Error('Nomor invoice tidak dapat disimpan'))
      }
    }
  })
}

export function resetOfflineInvoiceSequence(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      ensureOfflineOperationalStores(database)
    }
    request.onerror = () => reject(request.error || new Error('Gagal membuka penyimpanan nomor invoice'))
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction(OFFLINE_INVOICE_SEQUENCE_STORE, 'readwrite')
      transaction.objectStore(OFFLINE_INVOICE_SEQUENCE_STORE).delete(INVOICE_SEQUENCE_KEY)
      transaction.oncomplete = () => {
        database.close()
        resolve()
      }
      transaction.onerror = () => {
        database.close()
        reject(transaction.error || new Error('Gagal mereset nomor invoice'))
      }
      transaction.onabort = () => {
        database.close()
        reject(new Error('Gagal mereset nomor invoice'))
      }
    }
  })
}
