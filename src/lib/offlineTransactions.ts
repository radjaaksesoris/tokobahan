import { supabase } from '@/lib/supabase'

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
}

const DB_NAME = 'konveksi-pos'
const STORE_NAME = 'offline-transactions'
const DB_VERSION = 1
const BATCH_SIZE = 5
let syncPromise: Promise<SyncResult> | null = null
const listeners = new Set<() => void>()

export interface SyncResult {
  synced: number
  failed: number
}

function notify() {
  listeners.forEach((listener) => listener())
}

export function subscribeOfflineTransactions(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('Penyimpanan offline tidak tersedia di browser ini'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
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
    request.onerror = () => reject(request.error || new Error('Gagal mengakses transaksi offline'))
  }).finally(() => database.close())
}

export async function getQueuedTransactions() {
  return (await withStore<QueuedTransaction[]>('readonly', (store) => store.getAll())) || []
}

export async function enqueueTransaction(
  transaction: Omit<QueuedTransaction, 'id' | 'status' | 'attempts' | 'lastError' | 'createdAt'>,
) {
  const record: QueuedTransaction = {
    ...transaction,
    id: crypto.randomUUID(),
    status: 'pending',
    attempts: 0,
    lastError: null,
    createdAt: new Date().toISOString(),
  }
  await withStore('readwrite', (store) => store.put(record))
  notify()
  return record
}

export async function removeQueuedTransaction(id: string) {
  await withStore('readwrite', (store) => store.delete(id))
  notify()
}

async function updateTransaction(id: string, patch: Partial<QueuedTransaction>) {
  const records = await getQueuedTransactions()
  const current = records.find((record) => record.id === id)
  if (!current) return
  await withStore('readwrite', (store) => store.put({ ...current, ...patch }))
  notify()
}

function isRetryableError(error: { message?: string } | null) {
  const message = error?.message?.toLowerCase() || ''
  return !navigator.onLine || message.includes('fetch') || message.includes('network') || message.includes('timeout')
}

async function syncOne(transaction: QueuedTransaction) {
  await updateTransaction(transaction.id, { status: 'syncing' })
  const { error } = await supabase.rpc('checkout_sale', {
    p_invoice_no: transaction.invoiceNo,
    p_total_amount: transaction.totalAmount,
    p_total_cost: transaction.totalCost,
    p_total_profit: transaction.totalProfit,
    p_payment_method: transaction.paymentMethod,
    p_cashier_id: transaction.cashierId,
    p_items: transaction.items,
    p_customer_name: transaction.customerName,
    p_amount_paid: transaction.amountPaid,
  })
  if (!error) {
    await withStore('readwrite', (store) => store.delete(transaction.id))
    notify()
    return true
  }
  await updateTransaction(transaction.id, {
    status: 'failed',
    attempts: transaction.attempts + 1,
    lastError: error.message,
  })
  return false
}

export async function syncQueuedTransactions(): Promise<SyncResult> {
  if (syncPromise) return syncPromise
  syncPromise = (async () => {
    if (!navigator.onLine) return { synced: 0, failed: 0 }
    const transactions = (await getQueuedTransactions())
      .filter((transaction) => transaction.status !== 'syncing')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, BATCH_SIZE)
    let synced = 0
    for (const transaction of transactions) {
      if (await syncOne(transaction)) synced += 1
      if (!navigator.onLine) break
    }
    const failed = (await getQueuedTransactions()).filter((transaction) => transaction.status === 'failed').length
    return { synced, failed }
  })().finally(() => {
    syncPromise = null
  })
  return syncPromise
}

export async function retryFailedTransactions() {
  const failed = (await getQueuedTransactions()).filter((transaction) => transaction.status === 'failed')
  await Promise.all(failed.map((transaction) => updateTransaction(transaction.id, { status: 'pending', lastError: null })))
  return syncQueuedTransactions()
}

export function createOfflineInvoice() {
  return `OFF-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
}

export function isOfflineError(error: { message?: string } | null) {
  return isRetryableError(error)
}
