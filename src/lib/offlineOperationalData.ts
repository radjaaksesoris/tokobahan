const DB_NAME = 'konveksi-pos'
const TRANSACTION_STORE = 'offline-transactions'
const SETTLEMENT_STORE = 'offline-settlements'
const DB_VERSION = 2

export async function clearOfflineOperationalData() {
  if (!('indexedDB' in globalThis)) {
    throw new Error('Penyimpanan offline tidak tersedia di browser ini')
  }

  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(TRANSACTION_STORE)) {
        db.createObjectStore(TRANSACTION_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(SETTLEMENT_STORE)) {
        db.createObjectStore(SETTLEMENT_STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Gagal membuka antrean offline'))
  })

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        [TRANSACTION_STORE, SETTLEMENT_STORE],
        'readwrite',
      )
      transaction.objectStore(TRANSACTION_STORE).clear()
      transaction.objectStore(SETTLEMENT_STORE).clear()
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error || new Error('Gagal menghapus antrean offline'))
      transaction.onabort = () => reject(transaction.error || new Error('Penghapusan antrean offline dibatalkan'))
    })
  } finally {
    database.close()
  }
}
