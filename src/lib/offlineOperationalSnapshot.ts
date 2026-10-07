import { roundStockQuantity } from './productUnits'

export const OFFLINE_DB_NAME = 'konveksi-pos'
export const OFFLINE_DB_VERSION = 5
export const OFFLINE_OPERATIONAL_SNAPSHOT_STORE = 'offline-operational-snapshot'
export const OFFLINE_INVOICE_SEQUENCE_STORE = 'offline-invoice-sequence'

const TRANSACTION_STORE = 'offline-transactions'
const SETTLEMENT_STORE = 'offline-settlements'
const SNAPSHOT_KEY = 'current'
const SYNC_LOCK_KEY = 'sync-lock'
const STOCK_PRECISION_MIGRATION_KEY = 'stock-precision-3'
export const OPERATIONAL_SNAPSHOT_FORMAT = 'tokobahan-operational-backup'
export const OPERATIONAL_SNAPSHOT_VERSION = '3'

export const OPERATIONAL_SNAPSHOT_TABLES = [
  'categories',
  'vendors',
  'custom_units',
  'products',
  'product_stock_batches',
  'customers',
  'sales',
  'sale_items',
  'vendor_debt_payments',
  'customer_debt_payments',
  'stock_adjustments',
  'sale_returns',
  'settlement_idempotency',
] as const

export type OperationalSnapshotTable = (typeof OPERATIONAL_SNAPSHOT_TABLES)[number]

export interface OperationalSnapshot extends Record<string, unknown> {
  format: typeof OPERATIONAL_SNAPSHOT_FORMAT
  version: typeof OPERATIONAL_SNAPSHOT_VERSION
  generated_at: string
  generated_by: string
  synced_generated_at?: string
  server_revision?: string
  tables: Record<OperationalSnapshotTable, Record<string, unknown>[]>
}

interface StoredSnapshot {
  id: typeof SNAPSHOT_KEY
  data: OperationalSnapshot
}

interface SyncLock {
  id: typeof SYNC_LOCK_KEY
  locked: boolean
  lockedAt?: number
  token?: string
}

const STALE_SYNC_LOCK_TIMEOUT_MS = 15 * 60_000

function isActiveSyncLock(lock: SyncLock | undefined, now = Date.now()) {
  if (
    !lock?.locked ||
    typeof lock.token !== 'string' ||
    typeof lock.lockedAt !== 'number' ||
    !Number.isFinite(lock.lockedAt)
  ) {
    return false
  }
  return now >= lock.lockedAt && now - lock.lockedAt < STALE_SYNC_LOCK_TIMEOUT_MS
}

function hasSyncLock(lock: SyncLock | undefined, token: string, now = Date.now()) {
  return isActiveSyncLock(lock, now) && lock?.token === token
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
  if (!database.objectStoreNames.contains(OFFLINE_INVOICE_SEQUENCE_STORE)) {
    database.createObjectStore(OFFLINE_INVOICE_SEQUENCE_STORE, { keyPath: 'id' })
  }
}

function normalizeSnapshotStockPrecision(snapshot: OperationalSnapshot): OperationalSnapshot {
  let changed = false
  const products = snapshot.tables.products.map((product) => {
    if (typeof product.stock !== 'number' || !Number.isFinite(product.stock)) return product
    const stock = roundStockQuantity(product.stock)
    if (stock === product.stock) return product
    changed = true
    return { ...product, stock }
  })
  const batches = snapshot.tables.product_stock_batches.map((batch) => {
    let normalized = batch
    for (const field of ['quantity_received', 'quantity_remaining'] as const) {
      const quantity = batch[field]
      if (typeof quantity !== 'number' || !Number.isFinite(quantity)) continue
      const value = roundStockQuantity(quantity)
      if (value !== quantity) {
        normalized = { ...normalized, [field]: value }
        changed = true
      }
    }
    return normalized
  })
  return changed
    ? { ...snapshot, tables: { ...snapshot.tables, products, product_stock_batches: batches } }
    : snapshot
}

function migrateStoredStockPrecision(database: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction
    try {
      transaction = database.transaction(OFFLINE_OPERATIONAL_SNAPSHOT_STORE, 'readwrite')
    } catch (error) {
      reject(new Error('Gagal memulai normalisasi presisi stok lokal', { cause: error }))
      return
    }

    const store = transaction.objectStore(OFFLINE_OPERATIONAL_SNAPSHOT_STORE)
    const migrationRequest = store.get(STOCK_PRECISION_MIGRATION_KEY)
    const lockRequest = store.get(SYNC_LOCK_KEY)
    const snapshotRequest = store.get(SNAPSHOT_KEY)
    let readyCount = 0
    const migrate = () => {
      readyCount += 1
      if (readyCount !== 3) return
      if (migrationRequest.result || isActiveSyncLock(lockRequest.result as SyncLock | undefined)) return

      const stored = snapshotRequest.result as StoredSnapshot | undefined
      const products = stored?.data?.tables?.products
      const batches = stored?.data?.tables?.product_stock_batches
      let changed = false

      for (const product of Array.isArray(products) ? products : []) {
        if (!product || typeof product !== 'object') continue
        if (typeof product.stock !== 'number' || !Number.isFinite(product.stock)) continue
        const normalizedStock = roundStockQuantity(product.stock)
        if (normalizedStock !== product.stock) {
          product.stock = normalizedStock
          changed = true
        }
      }
      for (const batch of Array.isArray(batches) ? batches : []) {
        if (!batch || typeof batch !== 'object') continue
        for (const field of ['quantity_received', 'quantity_remaining'] as const) {
          const quantity = batch[field]
          if (typeof quantity !== 'number' || !Number.isFinite(quantity)) continue
          const normalizedQuantity = roundStockQuantity(quantity)
          if (normalizedQuantity !== quantity) {
            batch[field] = normalizedQuantity
            changed = true
          }
        }
      }

      if (changed && stored) store.put(stored)
      store.put({ id: STOCK_PRECISION_MIGRATION_KEY, completed: true })
    }
    migrationRequest.onsuccess = migrate
    lockRequest.onsuccess = migrate
    snapshotRequest.onsuccess = migrate

    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(new Error(
      'Gagal menormalisasi presisi stok lokal',
      { cause: transaction.error },
    ))
    transaction.onabort = () => reject(new Error(
      'Normalisasi presisi stok lokal dibatalkan',
      { cause: transaction.error },
    ))
  })
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Penyimpanan offline tidak tersedia di browser ini'))
      return
    }

    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION)
    request.onupgradeneeded = () => ensureOfflineOperationalStores(request.result)
    request.onsuccess = () => {
      const database = request.result
      void migrateStoredStockPrecision(database).then(
        () => resolve(database),
        (error: unknown) => {
          database.close()
          reject(error)
        },
      )
    }
    request.onerror = () => reject(
      new Error('Gagal membuka penyimpanan snapshot operasional', { cause: request.error }),
    )
  })
}

async function withSnapshotStore<T>(
  mode: IDBTransactionMode,
  run: (
    store: IDBObjectStore,
    setResult: (result: T) => void,
    abortWithError: (error: unknown) => void,
  ) => void,
): Promise<T> {
  const database = await openDatabase()

  try {
    return await new Promise<T>((resolve, reject) => {
      let result!: T
      let settled = false
      let operationError: Error | null = null
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        reject(error)
      }

      let transaction: IDBTransaction
      try {
        transaction = database.transaction(OFFLINE_OPERATIONAL_SNAPSHOT_STORE, mode)
        transaction.onerror = () => fail(operationError || new Error(
          'Gagal mengakses snapshot operasional',
          { cause: transaction.error },
        ))
        transaction.onabort = () => fail(operationError || new Error(
          'Transaksi snapshot operasional dibatalkan',
          { cause: transaction.error },
        ))
        transaction.oncomplete = () => {
          if (settled) return
          settled = true
          resolve(result)
        }
        run(
          transaction.objectStore(OFFLINE_OPERATIONAL_SNAPSHOT_STORE),
          (value) => { result = value },
          (error) => {
            operationError = error instanceof Error
              ? error
              : new Error('Operasi snapshot operasional gagal', { cause: error })
            transaction.abort()
          },
        )
      } catch (error) {
        if (settled) return
        operationError = error instanceof Error
          ? error
          : new Error('Gagal mengakses snapshot operasional', { cause: error })
        try {
          transaction!.abort()
        } catch {
          fail(operationError)
        }
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
      setResult(record ? validateOperationalSnapshot(record.data) as TSnapshot : null)
    }
  })
}

export function writeOperationalSnapshot<TSnapshot extends OperationalSnapshot>(
  snapshot: TSnapshot,
): Promise<void> {
  const normalizedSnapshot = normalizeSnapshotStockPrecision(validateOperationalSnapshot(snapshot))
  return withSnapshotStore<void>('readwrite', (store, _setResult, abortWithError) => {
    const lockRequest = store.get(SYNC_LOCK_KEY)
    lockRequest.onsuccess = () => {
      if (isActiveSyncLock(lockRequest.result as SyncLock | undefined)) {
        abortWithError(new Error('Snapshot sedang disinkronkan dan tidak dapat diganti'))
        return
      }
      store.delete(SYNC_LOCK_KEY)
      store.put({ id: SNAPSHOT_KEY, data: normalizedSnapshot } satisfies StoredSnapshot)
    }
  })
}

export function initializeOperationalSnapshotIfMissing<TSnapshot extends OperationalSnapshot>(
  snapshot: TSnapshot,
): Promise<void> {
  const normalizedSnapshot = normalizeSnapshotStockPrecision(validateOperationalSnapshot(snapshot))
  return withSnapshotStore<void>('readwrite', (store, _setResult, abortWithError) => {
    const lockRequest = store.get(SYNC_LOCK_KEY)
    const snapshotRequest = store.get(SNAPSHOT_KEY)
    let readyCount = 0
    let existingSnapshot = false
    const initialize = () => {
      readyCount += 1
      if (readyCount !== 2) return
      if (isActiveSyncLock(lockRequest.result as SyncLock | undefined)) {
        abortWithError(new Error('Snapshot sedang disinkronkan dan tidak dapat diganti'))
      } else if (existingSnapshot) {
        abortWithError(new Error('Snapshot lokal sudah tersedia; inisialisasi tidak dijalankan'))
      } else {
        store.delete(SYNC_LOCK_KEY)
        store.add({ id: SNAPSHOT_KEY, data: normalizedSnapshot } satisfies StoredSnapshot)
      }
    }
    lockRequest.onsuccess = () => {
      initialize()
    }
    snapshotRequest.onsuccess = () => {
      existingSnapshot = Boolean(snapshotRequest.result)
      initialize()
    }
  })
}

export function clearOperationalSnapshot(): Promise<void> {
  return withSnapshotStore<void>('readwrite', (store, _setResult, abortWithError) => {
    const lockRequest = store.get(SYNC_LOCK_KEY)
    lockRequest.onsuccess = () => {
      if (isActiveSyncLock(lockRequest.result as SyncLock | undefined)) {
        abortWithError(new Error('Snapshot sedang disinkronkan dan belum dapat dihapus'))
        return
      }
      store.delete(SYNC_LOCK_KEY)
      store.delete(SNAPSHOT_KEY)
    }
  })
}

export interface OperationalSnapshotSyncSession {
  snapshot: OperationalSnapshot
  lockToken: string
}

export function beginOperationalSnapshotSync(): Promise<OperationalSnapshotSyncSession> {
  return withSnapshotStore<OperationalSnapshotSyncSession>('readwrite', (store, setResult, abortWithError) => {
    const snapshotRequest = store.get(SNAPSHOT_KEY)
    const lockRequest = store.get(SYNC_LOCK_KEY)
    let snapshotResult: StoredSnapshot | undefined
    let lockResult: SyncLock | undefined
    let readyCount = 0
    const tryLock = () => {
      readyCount += 1
      if (readyCount !== 2) return
      try {
        if (!snapshotResult) throw new Error('Snapshot lokal belum diinisialisasi')
        if (isActiveSyncLock(lockResult)) throw new Error('Sinkronisasi snapshot sedang berjalan')
        const snapshot = validateOperationalSnapshot(snapshotResult.data)
        const lockToken = crypto.randomUUID()
        store.put({ id: SYNC_LOCK_KEY, locked: true, lockedAt: Date.now(), token: lockToken } satisfies SyncLock)
        setResult({ snapshot, lockToken })
      } catch (error) {
        abortWithError(error)
      }
    }
    snapshotRequest.onsuccess = () => {
      snapshotResult = snapshotRequest.result as StoredSnapshot | undefined
      tryLock()
    }
    lockRequest.onsuccess = () => {
      lockResult = lockRequest.result as SyncLock | undefined
      tryLock()
    }
  })
}

export function endOperationalSnapshotSync(lockToken: string): Promise<void> {
  return withSnapshotStore<void>('readwrite', (store, _setResult, abortWithError) => {
    const lockRequest = store.get(SYNC_LOCK_KEY)
    lockRequest.onsuccess = () => {
      const lock = lockRequest.result as SyncLock | undefined
      if (lock?.token === lockToken) store.delete(SYNC_LOCK_KEY)
      else abortWithError(new Error('Kunci sinkronisasi telah berubah; tidak dapat membuka kunci operasi lain'))
    }
  })
}

export function completeOperationalSnapshotSync(serverRevision: string, lockToken: string): Promise<void> {
  return withSnapshotStore<void>('readwrite', (store, _setResult, abortWithError) => {
    const snapshotRequest = store.get(SNAPSHOT_KEY)
    const lockRequest = store.get(SYNC_LOCK_KEY)
    let snapshotResult: StoredSnapshot | undefined
    let lockResult: SyncLock | undefined
    let readyCount = 0
    const finish = () => {
      readyCount += 1
      if (readyCount !== 2) return
      if (!snapshotResult || !hasSyncLock(lockResult, lockToken)) {
        abortWithError(new Error('Status sinkronisasi snapshot lokal tidak valid'))
        return
      }
      store.put({
        ...snapshotResult,
        data: {
          ...snapshotResult.data,
          server_revision: serverRevision,
          synced_generated_at: snapshotResult.data.generated_at,
        },
      } satisfies StoredSnapshot)
      store.delete(SYNC_LOCK_KEY)
    }
    snapshotRequest.onsuccess = () => {
      snapshotResult = snapshotRequest.result as StoredSnapshot | undefined
      finish()
    }
    lockRequest.onsuccess = () => {
      lockResult = lockRequest.result as SyncLock | undefined
      finish()
    }
  })
}

export function replaceOperationalSnapshotAfterRefresh(
  snapshot: OperationalSnapshot,
  lockToken: string,
): Promise<void> {
  const normalizedSnapshot = normalizeSnapshotStockPrecision(validateOperationalSnapshot(snapshot))
  return withSnapshotStore<void>('readwrite', (store, _setResult, abortWithError) => {
    const lockRequest = store.get(SYNC_LOCK_KEY)
    lockRequest.onsuccess = () => {
      if (!hasSyncLock(lockRequest.result as SyncLock | undefined, lockToken)) {
        abortWithError(new Error('Snapshot lokal tidak terkunci untuk penyegaran'))
        return
      }
      store.put({ id: SNAPSHOT_KEY, data: normalizedSnapshot } satisfies StoredSnapshot)
      store.delete(SYNC_LOCK_KEY)
    }
  })
}

export function updateOperationalSnapshot<TResult>(
  update: (snapshot: OperationalSnapshot) => {
    snapshot: OperationalSnapshot
    result: TResult
  },
): Promise<TResult> {
  return withSnapshotStore<TResult>('readwrite', (store, setResult, abortWithError) => {
    const snapshotRequest = store.get(SNAPSHOT_KEY)
    const lockRequest = store.get(SYNC_LOCK_KEY)
    let snapshotResult: StoredSnapshot | undefined
    let lockResult: SyncLock | undefined
    let readyCount = 0
    const updateWhenReady = () => {
      readyCount += 1
      if (readyCount !== 2) return
      try {
        if (isActiveSyncLock(lockResult)) {
          throw new Error('Snapshot sedang disinkronkan dan tidak dapat diubah')
        }
        store.delete(SYNC_LOCK_KEY)
        const current = snapshotResult
        if (!current) throw new Error('Snapshot lokal belum diinisialisasi')

        const next = update(validateOperationalSnapshot(current.data))
        const normalizedSnapshot = normalizeSnapshotStockPrecision(
          validateOperationalSnapshot(next.snapshot),
        )
        const snapshot = normalizedSnapshot === current.data
          ? normalizedSnapshot
          : {
              ...normalizedSnapshot,
              generated_at: new Date().toISOString(),
              synced_generated_at: normalizedSnapshot.synced_generated_at ?? current.data.generated_at,
            }
        store.put({ id: SNAPSHOT_KEY, data: snapshot } satisfies StoredSnapshot)
        setResult(next.result)
      } catch (error) {
        abortWithError(error)
      }
    }
    snapshotRequest.onsuccess = () => {
      snapshotResult = snapshotRequest.result as StoredSnapshot | undefined
      updateWhenReady()
    }
    lockRequest.onsuccess = () => {
      lockResult = lockRequest.result as SyncLock | undefined
      updateWhenReady()
    }
  })
}

export function validateOperationalSnapshot(value: unknown): OperationalSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Snapshot operasional tidak valid')
  }

  const snapshot = value as Record<string, unknown>
  if (
    snapshot.format !== OPERATIONAL_SNAPSHOT_FORMAT ||
    snapshot.version !== OPERATIONAL_SNAPSHOT_VERSION ||
    typeof snapshot.generated_at !== 'string' ||
    typeof snapshot.generated_by !== 'string' ||
    !snapshot.tables ||
    typeof snapshot.tables !== 'object' ||
    Array.isArray(snapshot.tables)
  ) {
    throw new Error('Format atau versi snapshot operasional tidak didukung')
  }
  if (snapshot.server_revision !== undefined && (
    typeof snapshot.server_revision !== 'string' ||
    !/^\d+$/.test(snapshot.server_revision)
  )) {
    throw new Error('Versi dasar server pada snapshot lokal tidak valid')
  }

  const tables = snapshot.tables as Record<string, unknown>
  const validatedTables = {} as OperationalSnapshot['tables']
  for (const tableName of OPERATIONAL_SNAPSHOT_TABLES) {
    const rows = tables[tableName]
    if (
      !Array.isArray(rows) ||
      rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))
    ) {
      throw new Error(`Data tabel ${tableName} tidak lengkap atau tidak valid`)
    }
    validatedTables[tableName] = rows as Record<string, unknown>[]
  }

  return {
    ...snapshot,
    tables: validatedTables,
  } as OperationalSnapshot
}
