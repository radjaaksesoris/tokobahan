import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  completeOperationalSnapshotSync,
  clearOperationalSnapshot,
  beginOperationalSnapshotSync,
  endOperationalSnapshotSync,
  initializeOperationalSnapshotIfMissing,
  OFFLINE_OPERATIONAL_SNAPSHOT_STORE,
  OPERATIONAL_SNAPSHOT_TABLES,
  readOperationalSnapshot,
  replaceOperationalSnapshotAfterRefresh,
  updateOperationalSnapshot,
  type OperationalSnapshot,
  validateOperationalSnapshot,
  writeOperationalSnapshot,
} from './offlineOperationalSnapshot'

function createSnapshot(overrides: Partial<OperationalSnapshot['tables']> = {}): OperationalSnapshot {
  const tables = Object.fromEntries(OPERATIONAL_SNAPSHOT_TABLES.map((table) => [table, []]))
  return {
    format: 'tokobahan-operational-backup',
    version: '3',
    generated_at: '2026-10-01T00:00:00.000Z',
    generated_by: 'admin-1',
    tables: { ...tables, ...overrides } as OperationalSnapshot['tables'],
  }
}

function deleteOfflineDatabase() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('konveksi-pos')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Offline database is still open'))
  })
}

async function writeSyncLock(lock: Record<string, unknown>) {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('konveksi-pos')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(OFFLINE_OPERATIONAL_SNAPSHOT_STORE, 'readwrite')
    transaction.objectStore(OFFLINE_OPERATIONAL_SNAPSHOT_STORE).put({ id: 'sync-lock', ...lock })
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  database.close()
}

describe('offline operational snapshot storage', () => {
  beforeEach(deleteOfflineDatabase)
  afterEach(async () => {
    vi.unstubAllGlobals()
    await deleteOfflineDatabase()
  })

  it('reads, replaces, and clears the single operational snapshot', async () => {
    const snapshot = createSnapshot({
      products: [{ id: 'product-1', name: 'Kain' }],
      product_stock_batches: [{ id: 'batch-1', quantity_remaining: 12 }],
    })

    await expect(readOperationalSnapshot()).resolves.toBeNull()
    await writeOperationalSnapshot(snapshot)
    await expect(readOperationalSnapshot()).resolves.toEqual(snapshot)

    const replacement = createSnapshot({
      products: [{ id: 'product-2', name: 'Benang' }],
    })
    await writeOperationalSnapshot(replacement)
    await expect(readOperationalSnapshot()).resolves.toEqual(replacement)

    await clearOperationalSnapshot()
    await expect(readOperationalSnapshot()).resolves.toBeNull()
  })

  it('does not replace a snapshot created by a concurrent bootstrap', async () => {
    const existing = createSnapshot({ products: [{ id: 'existing', name: 'Local' }] })
    const incoming = createSnapshot({ products: [{ id: 'incoming', name: 'Server' }] })
    await initializeOperationalSnapshotIfMissing(existing)

    await expect(initializeOperationalSnapshotIfMissing(incoming))
      .rejects.toThrow('Snapshot lokal sudah tersedia')
    await expect(readOperationalSnapshot()).resolves.toEqual(existing)
  })

  it('upgrades a version 2 database without losing its existing queues', async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('konveksi-pos', 2)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('offline-transactions', { keyPath: 'id' })
        request.result.createObjectStore('offline-settlements', { keyPath: 'id' })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction(
      ['offline-transactions', 'offline-settlements'],
      'readwrite',
    )
    transaction.objectStore('offline-transactions').put({ id: 'transaction-1' })
    transaction.objectStore('offline-settlements').put({ id: 'settlement-1' })
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()

    await expect(readOperationalSnapshot()).resolves.toBeNull()
    const upgraded = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('konveksi-pos', 3)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    expect(upgraded.objectStoreNames.contains(OFFLINE_OPERATIONAL_SNAPSHOT_STORE)).toBe(true)
    const queues = upgraded.transaction(
      ['offline-transactions', 'offline-settlements'],
      'readonly',
    )
    const transactionRows = await new Promise<unknown[]>((resolve, reject) => {
      const request = queues.objectStore('offline-transactions').getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const settlementRows = await new Promise<unknown[]>((resolve, reject) => {
      const request = queues.objectStore('offline-settlements').getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    upgraded.close()

    expect(transactionRows).toEqual([{ id: 'transaction-1' }])
    expect(settlementRows).toEqual([{ id: 'settlement-1' }])
  })

  it('rejects with an explicit error when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined)

    await expect(readOperationalSnapshot()).rejects.toThrow(
      'Penyimpanan offline tidak tersedia di browser ini',
    )
  })

  it('requires a complete supported backup payload before sync', () => {
    const snapshot = createSnapshot()
    const tables = snapshot.tables

    expect(validateOperationalSnapshot(snapshot)).toEqual(snapshot)
    expect(() => validateOperationalSnapshot({ ...snapshot, tables: { ...tables, sales: undefined } }))
      .toThrow('Data tabel sales tidak lengkap atau tidak valid')
    expect(() => validateOperationalSnapshot({ ...snapshot, version: '2' }))
      .toThrow('Format atau versi snapshot operasional tidak didukung')
    expect(() => validateOperationalSnapshot({
      ...snapshot,
      tables: { ...tables, products: [{ id: 'p1' }, null] },
    })).toThrow('Data tabel products tidak lengkap atau tidak valid')
  })

  it('updates a complete snapshot atomically and rejects an uninitialized store', async () => {
    await expect(updateOperationalSnapshot((current) => ({
      snapshot: current,
      result: true,
    }))).rejects.toThrow('Snapshot lokal belum diinisialisasi')

    await writeOperationalSnapshot(createSnapshot())
    await expect(updateOperationalSnapshot((current) => ({
      snapshot: {
        ...current,
        tables: {
          ...current.tables,
          products: [{ id: 'product-1', name: 'Benang', stock: 10 }],
        },
      },
      result: 'saved',
    }))).resolves.toBe('saved')
    await expect(readOperationalSnapshot()).resolves.toMatchObject({
      tables: { products: [{ id: 'product-1', name: 'Benang', stock: 10 }] },
    })
  })

  it('locks local writes while a snapshot is being synchronized', async () => {
    const snapshot = createSnapshot()
    await writeOperationalSnapshot(snapshot)

    const session = await beginOperationalSnapshotSync()
    expect(session.snapshot).toEqual(snapshot)
    await expect(beginOperationalSnapshotSync()).rejects.toThrow('Sinkronisasi snapshot sedang berjalan')
    await expect(updateOperationalSnapshot((current) => ({
      snapshot: current,
      result: undefined,
    }))).rejects.toThrow('Snapshot sedang disinkronkan dan tidak dapat diubah')
    await expect(clearOperationalSnapshot()).rejects.toThrow('Snapshot sedang disinkronkan dan belum dapat dihapus')

    await endOperationalSnapshotSync(session.lockToken)
    await expect(updateOperationalSnapshot((current) => ({
      snapshot: current,
      result: 'unlocked',
    }))).resolves.toBe('unlocked')
  })

  it('prevents snapshot replacement while a sync is in progress', async () => {
    const snapshot = createSnapshot()
    await writeOperationalSnapshot(snapshot)
    const session = await beginOperationalSnapshotSync()

    await expect(writeOperationalSnapshot(createSnapshot({
      products: [{ id: 'replacement', name: 'Produk' }],
    }))).rejects.toThrow('Snapshot sedang disinkronkan dan tidak dapat diganti')

    await endOperationalSnapshotSync(session.lockToken)
    await expect(readOperationalSnapshot()).resolves.toEqual(snapshot)
  })

  it('updates the server revision and releases the lock atomically after sync', async () => {
    await writeOperationalSnapshot(createSnapshot())
    const session = await beginOperationalSnapshotSync()
    await completeOperationalSnapshotSync('12', session.lockToken)

    await expect(readOperationalSnapshot()).resolves.toMatchObject({ server_revision: '12' })
    await expect(updateOperationalSnapshot((current) => ({
      snapshot: current,
      result: 'unlocked',
    }))).resolves.toBe('unlocked')
  })

  it('replaces a stale local snapshot only while holding the refresh lock', async () => {
    const current = createSnapshot()
    const refreshed = createSnapshot({
      products: [{ id: 'from-server', name: 'Produk', stock: 3 }],
    })
    await writeOperationalSnapshot(current)
    await expect(replaceOperationalSnapshotAfterRefresh(refreshed, 'no-lock'))
      .rejects.toThrow('Snapshot lokal tidak terkunci untuk penyegaran')

    const session = await beginOperationalSnapshotSync()
    await replaceOperationalSnapshotAfterRefresh(refreshed, session.lockToken)
    await expect(readOperationalSnapshot()).resolves.toEqual(refreshed)
    await expect(updateOperationalSnapshot((snapshot) => ({
      snapshot,
      result: 'unlocked',
    }))).resolves.toBe('unlocked')
  })

  it('recovers an expired or legacy sync lock without releasing a newer session', async () => {
    await writeOperationalSnapshot(createSnapshot())
    await writeSyncLock({
      locked: true,
      lockedAt: Date.now() - 16 * 60_000,
      token: 'expired-session',
    })

    const session = await beginOperationalSnapshotSync()
    expect(session.lockToken).not.toBe('expired-session')
    await expect(endOperationalSnapshotSync('expired-session'))
      .rejects.toThrow('Kunci sinkronisasi telah berubah')
    await expect(updateOperationalSnapshot((current) => ({
      snapshot: current,
      result: 'still-locked',
    }))).rejects.toThrow('Snapshot sedang disinkronkan dan tidak dapat diubah')
    await endOperationalSnapshotSync(session.lockToken)

    await writeSyncLock({ locked: true })
    const recoveredLegacySession = await beginOperationalSnapshotSync()
    expect(recoveredLegacySession.lockToken).toBeTruthy()
    await endOperationalSnapshotSync(recoveredLegacySession.lockToken)
  })

  it('does not let an expired owner complete a newer sync session', async () => {
    await writeOperationalSnapshot(createSnapshot())
    const oldSession = await beginOperationalSnapshotSync()
    await writeSyncLock({
      locked: true,
      lockedAt: Date.now(),
      token: 'new-session',
    })

    await expect(completeOperationalSnapshotSync('12', oldSession.lockToken))
      .rejects.toThrow('Status sinkronisasi snapshot lokal tidak valid')
    await expect(endOperationalSnapshotSync(oldSession.lockToken))
      .rejects.toThrow('Kunci sinkronisasi telah berubah')
  })
})
