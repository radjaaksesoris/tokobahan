import { supabase } from '@/lib/supabase'

export type SettlementKind = 'vendor' | 'customer'
export type QueuedSettlementStatus = 'pending' | 'syncing' | 'failed'

export interface VendorSettlementPayload { allocations: Array<{ stock_batch_id: string; amount: number }> }
export interface CustomerSettlementPayload { sale_id: string; amount: number }
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

const DB_NAME = 'konveksi-pos'
const STORE_NAME = 'offline-settlements'
const DB_VERSION = 2
const BATCH_SIZE = 5
const STALE_SYNC_TIMEOUT_MS = 5 * 60_000
const listeners = new Set<() => void>()
let syncPromise: Promise<SyncResult> | null = null
export interface SyncResult { synced: number; failed: number }

function notify() { listeners.forEach((listener) => listener()) }
export function subscribeOfflineSettlements(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) }

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) { reject(new Error('Penyimpanan offline tidak tersedia di browser ini')); return }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains('offline-transactions')) database.createObjectStore('offline-transactions', { keyPath: 'id' })
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Gagal membuka penyimpanan offline'))
  })
}

async function withStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openDatabase()
  return new Promise<T>((resolve, reject) => {
    const request = operation(database.transaction(STORE_NAME, mode).objectStore(STORE_NAME))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Gagal mengakses antrean pelunasan'))
  }).finally(() => database.close())
}

export async function getQueuedSettlements() { return (await withStore<QueuedSettlement[]>('readonly', (store) => store.getAll())) || [] }
export async function enqueueSettlement(
  kind: SettlementKind,
  payload: QueuedSettlement['payload'],
  userId: string,
  idempotencyKey = crypto.randomUUID(),
) {
  if (!userId) throw new Error('Akun administrator tidak ditemukan')
  const record: QueuedSettlement = {
    id: crypto.randomUUID(),
    userId,
    idempotencyKey,
    kind,
    payload,
    status: 'pending',
    attempts: 0,
    lastError: null,
    createdAt: new Date().toISOString(),
  }
  await withStore('readwrite', (store) => store.add(record))
  notify(); return record
}
export async function removeQueuedSettlement(id: string) {
  await withStore('readwrite', (store) => store.delete(id))
  notify()
}
async function updateSettlement(id: string, patch: Partial<QueuedSettlement>) {
  const current = (await getQueuedSettlements()).find((record) => record.id === id)
  if (!current) return
  await withStore('readwrite', (store) => store.put({ ...current, ...patch })); notify()
}
async function syncOne(record: QueuedSettlement) {
  await updateSettlement(record.id, { status: 'syncing', syncStartedAt: new Date().toISOString() })
  let result: { error: { message: string } | null }
  try {
    result = record.kind === 'vendor'
      ? await supabase.rpc('pay_vendor_debt', {
        p_allocations: (record.payload as VendorSettlementPayload).allocations,
        p_idempotency_key: record.idempotencyKey || record.id,
      })
      : await supabase.rpc('pay_customer_debt', {
        p_sale_id: (record.payload as CustomerSettlementPayload).sale_id,
        p_amount: (record.payload as CustomerSettlementPayload).amount,
        p_idempotency_key: record.idempotencyKey || record.id,
      })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal menyinkronkan pelunasan'
    await updateSettlement(record.id, {
      status: 'failed',
      attempts: record.attempts + 1,
      lastError: message,
      syncStartedAt: undefined,
    })
    return false
  }
  if (!result.error) { await withStore('readwrite', (store) => store.delete(record.id)); notify(); return true }
  await updateSettlement(record.id, {
    status: 'failed',
    attempts: record.attempts + 1,
    lastError: result.error.message,
    syncStartedAt: undefined,
  }); return false
}
async function recoverStaleSettlements() {
  const records = await getQueuedSettlements()
  const stale = records.filter((record) => {
    if (record.status !== 'syncing') return false
    const startedAt = Date.parse(record.syncStartedAt || record.createdAt)
    return !Number.isFinite(startedAt) || Date.now() - startedAt >= STALE_SYNC_TIMEOUT_MS
  })
  await Promise.all(stale.map((record) => updateSettlement(record.id, {
    status: 'pending',
    syncStartedAt: undefined,
  })))
}
export async function syncQueuedSettlements(userId: string): Promise<SyncResult> {
  if (!userId) throw new Error('Akun administrator tidak ditemukan')
  if (syncPromise) return syncPromise
  syncPromise = (async () => {
    await recoverStaleSettlements()
    if (!navigator.onLine) return { synced: 0, failed: 0 }
    const records = (await getQueuedSettlements())
      .filter((record) => record.status !== 'syncing' && record.userId === userId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, BATCH_SIZE)
    let synced = 0
    for (const record of records) { if (await syncOne(record)) synced += 1; if (!navigator.onLine) break }
    return {
      synced,
      failed: (await getQueuedSettlements()).filter((record) => record.userId === userId && record.status === 'failed').length,
    }
  })().finally(() => { syncPromise = null })
  return syncPromise
}
export async function retryFailedSettlements(userId: string) {
  if (!userId) throw new Error('Akun administrator tidak ditemukan')
  const failed = (await getQueuedSettlements())
    .filter((record) => record.userId === userId && record.status === 'failed')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, BATCH_SIZE)
  await Promise.all(failed.map((record) => updateSettlement(record.id, { status: 'pending', lastError: null })))
  return syncQueuedSettlements(userId)
}
