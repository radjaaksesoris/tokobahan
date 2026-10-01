import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc },
}))

import {
  OPERATIONAL_SNAPSHOT_TABLES,
  readOperationalSnapshot,
  updateOperationalSnapshot,
  writeOperationalSnapshot,
  type OperationalSnapshot,
} from './offlineOperationalSnapshot'
import { syncOperationalSnapshot } from './offlineOperationalSync'

const snapshot: OperationalSnapshot = {
  format: 'tokobahan-operational-backup',
  version: '3',
  generated_at: '2026-10-01T00:00:00.000Z',
  generated_by: 'admin-1',
  server_revision: '0',
  tables: {
    categories: [],
    vendors: [],
    custom_units: [],
    products: [{
      id: 'product-1',
      name: 'Benang',
      stock: 5,
      cost_price: 10,
      category_id: null,
    }],
    product_stock_batches: [],
    customers: [],
    sales: [],
    sale_items: [],
    vendor_debt_payments: [],
    customer_debt_payments: [],
    stock_adjustments: [],
    sale_returns: [],
    settlement_idempotency: [],
  },
}

function deleteOfflineDatabase() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('konveksi-pos')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Offline database is still open'))
  })
}

describe('operational snapshot sync', () => {
  beforeEach(async () => {
    vi.stubGlobal('navigator', { onLine: true })
    await deleteOfflineDatabase()
    vi.clearAllMocks()
    rpc.mockResolvedValue({
      data: { id: 'backup-1', created_at: '2026-10-01T01:00:00.000Z', server_revision: '8' },
      error: null,
    })
    await writeOperationalSnapshot(snapshot)
  })

  afterEach(async () => {
    await deleteOfflineDatabase()
    vi.unstubAllGlobals()
  })

  it('uploads the complete local snapshot and unlocks local changes afterward', async () => {
    await expect(syncOperationalSnapshot()).resolves.toEqual({
      backupId: 'backup-1',
      backupCreatedAt: '2026-10-01T01:00:00.000Z',
      tableCount: OPERATIONAL_SNAPSHOT_TABLES.length,
      rowCount: 1,
    })
    expect(rpc).toHaveBeenCalledWith('sync_operational_snapshot', {
      p_payload: expect.objectContaining({
        format: 'tokobahan-operational-backup',
        server_revision: '0',
        tables: expect.objectContaining({
          products: [expect.objectContaining({ id: 'product-1', name: 'Benang', stock: 5 })],
        }),
      }),
    })
    await expect(updateOperationalSnapshot((current) => ({
      snapshot: current,
      result: 'unlocked',
    }))).resolves.toBe('unlocked')
    await expect(readOperationalSnapshot()).resolves.toMatchObject({ server_revision: '8' })
  })

  it('preserves local data and unlocks when the server rejects the snapshot', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'server rejected snapshot' } })

    await expect(syncOperationalSnapshot()).rejects.toThrow('server rejected snapshot')
    await expect(readOperationalSnapshot()).resolves.toEqual(snapshot)
    await expect(updateOperationalSnapshot((current) => ({
      snapshot: current,
      result: 'unlocked',
    }))).resolves.toBe('unlocked')
  })

  it('does not begin sync while the browser is offline', async () => {
    vi.stubGlobal('navigator', { onLine: false })

    await expect(syncOperationalSnapshot()).rejects.toThrow('Perangkat tidak terhubung ke internet')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('does not contact the server when the local snapshot is out of date', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'Data server berubah sejak snapshot lokal dibuat' },
    })

    await expect(syncOperationalSnapshot()).rejects.toThrow('Data server berubah')
    expect(rpc).toHaveBeenCalledTimes(1)
    await expect(readOperationalSnapshot()).resolves.toEqual(snapshot)
  })
})
