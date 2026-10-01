export const OFFLINE_DB_NAME = 'konveksi-pos'
export const OFFLINE_DB_VERSION = 3
export const OFFLINE_OPERATIONAL_SNAPSHOT_STORE = 'offline-operational-snapshot'

const TRANSACTION_STORE = 'offline-transactions'
const SETTLEMENT_STORE = 'offline-settlements'
const SNAPSHOT_KEY = 'current'

export type OperationalSnapshot = Record<string, unknown>

interface StoredSnapshot {
  id: typeof SNAPSHOT_KEY
  data: OperationalSnapshot
}

export function ensureOfflineOperationalStores(database: IDBDatabase) {
  if (!database.objectStoreNames.contains(TRANSACTION_STORE)) {
    database.createObjectStore(TRANSACTION_STORE, { keyPath: 'id' })
  }
  if (!database.objectStoreNames.contains(SETTLEMENT_STORE)) {
    database.createObjectStore(SETTLEMENT_STORE, { keyPath: 'id' })
  }
  if (!database.objectStoreNames.contains(OFFLINE_OPERATIONAL_SNAPSHOT_STORE)) {
    database.createObjectStore(OFFLINE_OPERATIONAL_SNAPSHOT_STORE, { keyPath: 'id' })
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Penyimpanan offline tidak tersedia di browser ini'))
      return
    }

    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION)
    request.onupgradeneeded = () => ensureOfflineOperationalStores(request.result)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(
      new Error('Gagal membuka penyimpanan snapshot operasional', { cause: request.error }),
    )
  })
}

async function withSnapshotStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore, setResult: (result: T) => void) => void,
): Promise<T> {
  const database = await openDatabase()

  try {
    return await new Promise<T>((resolve, reject) => {
      let result!: T
      let settled = false
      const fail = (message: string, cause: DOMException | null) => {
        if (settled) return
        settled = true
        reject(new Error(message, { cause }))
      }

      let transaction: IDBTransaction
      try {
        transaction = database.transaction(OFFLINE_OPERATIONAL_SNAPSHOT_STORE, mode)
        transaction.onerror = () => fail(
          'Gagal mengakses snapshot operasional',
          transaction.error,
        )
        transaction.onabort = () => fail(
          'Transaksi snapshot operasional dibatalkan',
          transaction.error,
        )
        transaction.oncomplete = () => {
          if (settled) return
          settled = true
          resolve(result)
        }
        run(transaction.objectStore(OFFLINE_OPERATIONAL_SNAPSHOT_STORE), (value) => {
          result = value
        })
      } catch (error) {
        if (settled) return
        settled = true
        reject(new Error('Gagal mengakses snapshot operasional', { cause: error }))
      }
    })
  } finally {
    database.close()
  }
}

export function readOperationalSnapshot<
  TSnapshot extends OperationalSnapshot = OperationalSnapshot,
>(): Promise<TSnapshot | null> {
  return withSnapshotStore('readonly', (store, setResult) => {
    const request = store.get(SNAPSHOT_KEY)
    request.onsuccess = () => {
      const record = request.result as StoredSnapshot | undefined
      setResult((record?.data ?? null) as TSnapshot | null)
    }
  })
}

export function writeOperationalSnapshot<TSnapshot extends OperationalSnapshot>(
  snapshot: TSnapshot,
): Promise<void> {
  return withSnapshotStore<void>('readwrite', (store) => {
    store.put({ id: SNAPSHOT_KEY, data: snapshot } satisfies StoredSnapshot)
  })
}

export function clearOperationalSnapshot(): Promise<void> {
  return withSnapshotStore<void>('readwrite', (store) => {
    store.delete(SNAPSHOT_KEY)
  })
}
