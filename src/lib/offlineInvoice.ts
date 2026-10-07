import {
  ensureOfflineOperationalStores,
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  OFFLINE_INVOICE_SEQUENCE_STORE,
  OFFLINE_OPERATIONAL_SNAPSHOT_STORE,
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
      const transaction = database.transaction(
        [OFFLINE_INVOICE_SEQUENCE_STORE, OFFLINE_OPERATIONAL_SNAPSHOT_STORE],
        'readwrite',
      )
      const sequenceStore = transaction.objectStore(OFFLINE_INVOICE_SEQUENCE_STORE)
      const snapshotStore = transaction.objectStore(OFFLINE_OPERATIONAL_SNAPSHOT_STORE)
      const sequenceRequest = sequenceStore.get(INVOICE_SEQUENCE_KEY)
      const snapshotRequest = snapshotStore.get('current')
      let invoiceNumber: number | null = null
      let readyCount = 0

      const reserveInvoiceNumber = () => {
        readyCount += 1
        if (readyCount !== 2) return
        const current = Number(sequenceRequest.result?.nextNumber || 1)
        if (!Number.isSafeInteger(current) || current < 1) {
          transaction.abort()
          return
        }

        const snapshot = snapshotRequest.result?.data as {
          tables?: { sales?: Array<{ invoice_no?: unknown }> }
        } | undefined
        const highestExistingInvoice = (snapshot?.tables?.sales || []).reduce((highest, sale) => {
          if (typeof sale.invoice_no !== 'string') return highest
          const match = /^RJA-(\d+)$/.exec(sale.invoice_no)
          if (!match) return highest
          const number = Number(match[1])
          return Number.isSafeInteger(number) ? Math.max(highest, number) : highest
        }, 0)
        const nextNumber = Math.max(current, highestExistingInvoice + 1)
        if (nextNumber > MAX_INVOICE_NUMBER - 1) {
          transaction.abort()
          return
        }

        invoiceNumber = nextNumber
        sequenceStore.put({ id: INVOICE_SEQUENCE_KEY, nextNumber: nextNumber + 1 })
      }

      sequenceRequest.onerror = () => {
        transaction.abort()
      }
      sequenceRequest.onsuccess = reserveInvoiceNumber
      snapshotRequest.onerror = () => transaction.abort()
      snapshotRequest.onsuccess = reserveInvoiceNumber
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
