import { supabase } from '@/lib/supabase'
import {
  readOperationalSnapshot,
  validateOperationalSnapshot,
  writeOperationalSnapshot,
} from '@/lib/offlineOperationalSnapshot'
import { getQueuedTransactions } from '@/lib/offlineTransactions'
import { getQueuedSettlements } from '@/lib/offlineSettlements'

function extractBackupPayload(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('payload' in value)) {
    throw new Error('Backup server tidak berisi snapshot operasional')
  }
  return validateOperationalSnapshot(value.payload)
}

export async function initializeOperationalSnapshot() {
  if (await readOperationalSnapshot()) {
    throw new Error('Snapshot lokal sudah tersedia; inisialisasi tidak dijalankan')
  }

  const [queuedTransactions, queuedSettlements] = await Promise.all([
    getQueuedTransactions(),
    getQueuedSettlements(),
  ])
  if (queuedTransactions.length > 0 || queuedSettlements.length > 0) {
    throw new Error('Sinkronkan antrean transaksi dan pelunasan yang ada sebelum inisialisasi lokal')
  }

  const { data, error } = await supabase.rpc('create_operational_backup')
  if (error) throw new Error(`Gagal mengambil snapshot awal dari server: ${error.message}`)

  const snapshot = extractBackupPayload(data)
  await writeOperationalSnapshot(snapshot)
  return {
    tables: Object.keys(snapshot.tables).length,
    rows: Object.values(snapshot.tables).reduce((total, rows) => total + rows.length, 0),
    generatedAt: snapshot.generated_at,
  }
}
