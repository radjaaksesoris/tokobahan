import { supabase } from '@/lib/supabase'
import {
  beginOperationalSnapshotSync,
  endOperationalSnapshotSync,
  initializeOperationalSnapshotIfMissing,
  readOperationalSnapshot,
  replaceOperationalSnapshotAfterRefresh,
  validateOperationalSnapshot,
} from '@/lib/offlineOperationalSnapshot'
import { validateOperationalSnapshotIntegrity } from '@/lib/validateOperationalSnapshotIntegrity'
import { getQueuedTransactions } from '@/lib/offlineTransactions'
import { getQueuedSettlements } from '@/lib/offlineSettlements'

function extractBackupPayload(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('payload' in value)) {
    throw new Error('Backup server tidak berisi snapshot operasional')
  }
  const snapshot = validateOperationalSnapshot(value.payload)
  if (!snapshot.server_revision || !/^\d+$/.test(snapshot.server_revision)) {
    throw new Error('Snapshot server tidak memiliki versi data yang valid. Terapkan migrasi sinkronisasi terbaru.')
  }
  return validateOperationalSnapshotIntegrity(snapshot)
}

async function ensureNoQueuedTransactions() {
  const [queuedTransactions, queuedSettlements] = await Promise.all([
    getQueuedTransactions(),
    getQueuedSettlements(),
  ])
  if (queuedTransactions.length > 0 || queuedSettlements.length > 0) {
    throw new Error('Sinkronkan antrean transaksi dan pelunasan sebelum mengganti snapshot lokal')
  }
}

async function fetchServerSnapshot() {
  const { data, error } = await supabase.rpc('create_operational_backup')
  if (error) throw new Error(`Gagal mengambil snapshot awal dari server: ${error.message}`)
  return extractBackupPayload(data)
}

export async function initializeOperationalSnapshot() {
  if (await readOperationalSnapshot()) {
    throw new Error('Snapshot lokal sudah tersedia; inisialisasi tidak dijalankan')
  }
  await ensureNoQueuedTransactions()
  const snapshot = await fetchServerSnapshot()
  await initializeOperationalSnapshotIfMissing(snapshot)
  return {
    tables: Object.keys(snapshot.tables).length,
    rows: Object.values(snapshot.tables).reduce((total, rows) => total + rows.length, 0),
    generatedAt: snapshot.generated_at,
  }
}

export async function refreshOperationalSnapshotFromServer() {
  await ensureNoQueuedTransactions()
  await beginOperationalSnapshotSync()
  try {
    const snapshot = await fetchServerSnapshot()
    await replaceOperationalSnapshotAfterRefresh(snapshot)
    return {
      tables: Object.keys(snapshot.tables).length,
      rows: Object.values(snapshot.tables).reduce((total, rows) => total + rows.length, 0),
      generatedAt: snapshot.generated_at,
    }
  } catch (error) {
    try {
      await endOperationalSnapshotSync()
    } catch (unlockError) {
      throw new AggregateError(
        [error, unlockError],
        'Penyegaran snapshot gagal dan snapshot lokal tidak dapat dibuka kuncinya',
      )
    }
    throw error
  }
}
