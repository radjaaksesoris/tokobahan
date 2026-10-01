import { supabase } from '@/lib/supabase'
import type { Json } from '@/types/database'
import {
  beginOperationalSnapshotSync,
  completeOperationalSnapshotSync,
  endOperationalSnapshotSync,
  OPERATIONAL_SNAPSHOT_TABLES,
} from '@/lib/offlineOperationalSnapshot'
import { validateOperationalSnapshotIntegrity } from '@/lib/validateOperationalSnapshotIntegrity'

interface SyncResult {
  backupId: string
  backupCreatedAt: string
  tableCount: number
  rowCount: number
}

function toJson(value: unknown): Json {
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(value)
  } catch (error) {
    throw new Error('Snapshot lokal tidak dapat disiapkan untuk sinkronisasi', { cause: error })
  }
  if (!serialized) throw new Error('Snapshot lokal kosong atau tidak dapat diserialisasi')
  return JSON.parse(serialized) as Json
}

export async function syncOperationalSnapshot(): Promise<SyncResult> {
  if (!navigator.onLine) throw new Error('Perangkat tidak terhubung ke internet')

  const snapshot = await beginOperationalSnapshotSync()
  try {
    if (!snapshot.server_revision || !/^\d+$/.test(snapshot.server_revision)) {
      throw new Error('Snapshot lokal belum memiliki versi dasar server. Salin ulang data server atau pulihkan backup lokal terlebih dahulu.')
    }
    validateOperationalSnapshotIntegrity(snapshot)
    const { data, error } = await supabase.rpc('sync_operational_snapshot', {
      p_payload: toJson(snapshot),
    })
    if (error) throw new Error(`Gagal mengirim snapshot operasional: ${error.message}`)
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Server tidak mengembalikan hasil sinkronisasi yang valid')
    }
    const result = data as Record<string, Json>
    if (typeof result.id !== 'string' || typeof result.created_at !== 'string') {
      throw new Error('Server tidak mengembalikan referensi backup yang valid')
    }
    if (typeof result.server_revision !== 'string' || !/^\d+$/.test(result.server_revision)) {
      throw new Error('Server tidak mengembalikan versi data yang valid')
    }
    const rowCount = OPERATIONAL_SNAPSHOT_TABLES.reduce(
      (total, table) => total + snapshot.tables[table].length,
      0,
    )
    await completeOperationalSnapshotSync(result.server_revision)
    return {
      backupId: result.id,
      backupCreatedAt: result.created_at,
      tableCount: OPERATIONAL_SNAPSHOT_TABLES.length,
      rowCount,
    }
  } catch (error) {
    try {
      await endOperationalSnapshotSync()
    } catch (unlockError) {
      throw new AggregateError(
        [error, unlockError],
        'Sinkronisasi gagal dan snapshot lokal tidak dapat dibuka kuncinya',
      )
    }
    throw error
  }
}
