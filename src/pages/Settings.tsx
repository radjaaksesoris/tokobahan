import { useEffect, useState, type ChangeEvent } from 'react'
import { AlertTriangle, Bell, ChevronDown, ClipboardCheck, Database, Download, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { LoadingDots } from '@/components/ui/LoadingDots'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import {
  isStockSoundEnabled,
  notifyLowStockPush,
  playLowStockSound,
  registerPushSubscription,
  setStockSoundEnabled,
} from '@/lib/notifications'
import { useAuthStore } from '@/store/useAuthStore'
import { clearOfflineOperationalCache } from '@/lib/offlineCache'
import { clearOfflineOperationalData } from '@/lib/offlineOperationalData'
import { getQueuedTransactions } from '@/lib/offlineTransactions'
import { getQueuedSettlements } from '@/lib/offlineSettlements'
import {
  clearOperationalSnapshot,
  readOperationalSnapshot,
  updateOperationalSnapshot,
  validateOperationalSnapshot,
  writeOperationalSnapshot,
} from '@/lib/offlineOperationalSnapshot'
import { validateOperationalSnapshotIntegrity } from '@/lib/validateOperationalSnapshotIntegrity'
import {
  initializeOperationalSnapshot,
  refreshOperationalSnapshotFromServer,
} from '@/lib/offlineOperationalBootstrap'
import { syncOperationalSnapshot } from '@/lib/offlineOperationalSync'
import {
  deleteOperationalRows,
  readOperationalTable,
} from '@/lib/offlineOperationalRepository'
import { rememberCurrentResetGeneration } from '@/lib/offlineQueueReset'
import { resetOfflineInvoiceSequence } from '@/lib/offlineInvoice'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { UNIT_LABELS } from '@/types'
import type { Json } from '@/types/database'
import { toTitleCase } from '@/lib/utils'
import StockOpname from '@/pages/StockOpname'
import { chooseLocalBackupFolder, getLocalBackupStatus, saveLocalBackup } from '@/lib/localBackup'

const BUILT_IN_UNITS = Object.entries(UNIT_LABELS).map(([id, name]) => ({ id, name, builtIn: true }))
const BACKUP_BUCKET = 'operational-backups'

export default function Settings() {
  const user = useAuthStore((s) => s.user)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [resetting, setResetting] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [backupLoading, setBackupLoading] = useState(false)
  const [restoreLoading, setRestoreLoading] = useState(false)
  const [cloudBackupLoading, setCloudBackupLoading] = useState(false)
  const [localSnapshotStatus, setLocalSnapshotStatus] = useState<'loading' | 'available' | 'missing' | 'error'>('loading')
  const [localSnapshotSummary, setLocalSnapshotSummary] = useState<{ tableCount: number; rowCount: number } | null>(null)
  const [localSnapshotError, setLocalSnapshotError] = useState<string | null>(null)
  const [initializingLocalData, setInitializingLocalData] = useState(false)
  const [syncingLocalData, setSyncingLocalData] = useState(false)
  const [legacyQueueCounts, setLegacyQueueCounts] = useState({ transactions: 0, settlements: 0 })
  const [legacyQueueStatus, setLegacyQueueStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [legacyQueueExported, setLegacyQueueExported] = useState(false)
  const [legacyQueueActionLoading, setLegacyQueueActionLoading] = useState(false)
  const [cloudBackupError, setCloudBackupError] = useState<string | null>(null)
  const [cloudBackups, setCloudBackups] = useState<Array<{
    id: string
    created_at: string
    created_by: string
    backup_version: string
    payload: Json | null
    storage_bucket: string | null
    storage_object_path: string | null
    storage_size_bytes: number | null
    storage_content_type: string | null
    storage_uploaded_at: string | null
  }>>([])
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported',
  )
  const [soundEnabled, setSoundEnabled] = useState(isStockSoundEnabled)
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([])
  const [vendorName, setVendorName] = useState('')
  const [vendorLoading, setVendorLoading] = useState(false)
  const [units, setUnits] = useState<{ id: string; name: string }[]>([])
  const [unitName, setUnitName] = useState('')
  const [unitLoading, setUnitLoading] = useState(false)
  const [stockOpnameOpen, setStockOpnameOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'master' | 'stock' | 'backup' | 'notification'>('master')
  const [localBackupStatus, setLocalBackupStatus] = useState<{ supported: boolean; configured: boolean; folderName?: string }>({ supported: true, configured: false })
  const [localBackupLoading, setLocalBackupLoading] = useState(false)
  const renderTabNavigation = (className: string, isDesktop = false) => (
    <nav className={className} aria-label="Bagian pengaturan" role="tablist">
      {([
        ['master', 'Data dasar'],
        ['stock', 'Stok'],
        ['backup', 'Backup'],
        ['notification', 'Notifikasi'],
      ] as const).map(([tab, label]) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={activeTab === tab}
          onClick={() => setActiveTab(tab)}
          className={`rounded-lg py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            isDesktop
              ? 'w-full shrink-0 px-3 text-center'
              : 'w-full min-w-0 px-1 text-center text-[clamp(0.65rem,3.1vw,0.875rem)]'
          } ${
            activeTab === tab
              ? 'bg-surface text-ink shadow-sm'
              : isDesktop
                ? 'text-muted-foreground hover:bg-muted hover:text-ink'
                : 'text-stone-300 hover:bg-white/10 hover:text-white'
          }`}
        >
          {label}
        </button>
      ))}
    </nav>
  )

  async function loadVendors() {
    try {
      const snapshot = await readOperationalSnapshot()
      if (!snapshot) {
        setVendors([])
        toast.error('Data lokal belum disiapkan. Buka Backup dan pemulihan untuk mengambil data awal.')
        return
      }
      const rows = await readOperationalTable<{ id: string; name: string }>('vendors')
      setVendors(rows)
    } catch (error) {
      toast.error(`Gagal memuat vendor: ${error instanceof Error ? error.message : 'Kesalahan tidak diketahui'}`)
    }
  }

  useEffect(() => {
    void loadVendors()
  }, [])

  async function addVendor() {
    const name = vendorName.trim()
    if (!name) return
    setVendorLoading(true)
    try {
      const snapshot = await readOperationalSnapshot()
      if (!snapshot) throw new Error('Data lokal belum disiapkan. Buka Backup dan pemulihan untuk mengambil data awal.')
      await updateOperationalSnapshot((current) => {
        const duplicate = current.tables.vendors.some((vendor) =>
          String(vendor.name).trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
        )
        if (duplicate) throw new Error('Vendor tersebut sudah ada')
        return {
          snapshot: {
            ...current,
            tables: {
              ...current.tables,
              vendors: [...current.tables.vendors, {
                id: crypto.randomUUID(),
                name,
                created_at: new Date().toISOString(),
              }],
            },
          },
          result: undefined,
        }
      })
      toast.success('Vendor ditambahkan')
      setVendorName('')
      await loadVendors()
    } catch (error) {
      toast.error(`Gagal menambah vendor: ${error instanceof Error ? error.message : 'Kesalahan tidak diketahui'}`)
    }
    setVendorLoading(false)
  }

  async function removeVendor(id: string) {
    try {
      const snapshot = await readOperationalSnapshot()
      if (!snapshot) throw new Error('Data lokal belum disiapkan. Buka Backup dan pemulihan untuk mengambil data awal.')
      await updateOperationalSnapshot((current) => ({
        snapshot: {
          ...current,
          tables: {
            ...current.tables,
            vendors: current.tables.vendors.filter((vendor) => vendor.id !== id),
            product_stock_batches: current.tables.product_stock_batches.map((batch) =>
              batch.vendor_id === id ? { ...batch, vendor_id: null } : batch,
            ),
          },
        },
        result: undefined,
      }))
      toast.success('Vendor dihapus')
      await loadVendors()
    } catch (error) {
      toast.error(`Gagal menghapus vendor: ${error instanceof Error ? error.message : 'Kesalahan tidak diketahui'}`)
    }
  }

  async function loadUnits() {
    try {
      const snapshot = await readOperationalSnapshot()
      if (!snapshot) {
        setUnits([])
        toast.error('Data lokal belum disiapkan. Buka Backup dan pemulihan untuk mengambil data awal.')
        return
      }
      const rows = await readOperationalTable<{ id: string; name: string }>('custom_units')
      setUnits(rows)
    } catch (error) {
      toast.error(`Gagal memuat satuan: ${error instanceof Error ? error.message : 'Kesalahan tidak diketahui'}`)
    }
  }

  useEffect(() => {
    void loadUnits()
  }, [])

  async function loadCloudBackups() {
    setCloudBackupError(null)
    const { data, error } = await supabase
      .from('operational_backups')
      .select('id, created_at, created_by, backup_version, storage_bucket, storage_object_path, storage_size_bytes, storage_content_type, storage_uploaded_at')
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) {
      setCloudBackupError(error.message)
      return
    }
    setCloudBackups((data || []) as typeof cloudBackups)
  }

  async function loadLocalSnapshotStatus() {
    try {
      const snapshot = await readOperationalSnapshot()
      if (!snapshot) {
        setLocalSnapshotStatus('missing')
        setLocalSnapshotSummary(null)
        setLocalSnapshotError(null)
        return
      }
      setLocalSnapshotStatus('available')
      setLocalSnapshotSummary({
        tableCount: Object.keys(snapshot.tables).length,
        rowCount: Object.values(snapshot.tables).reduce((total, rows) => total + rows.length, 0),
      })
      setLocalSnapshotError(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kesalahan tidak diketahui'
      setLocalSnapshotStatus('error')
      setLocalSnapshotError(message)
      console.error('Gagal memeriksa snapshot operasional lokal:', error)
    }
  }

  async function loadLegacyQueueStatus() {
    try {
      const [transactions, settlements] = await Promise.all([
        getQueuedTransactions(),
        getQueuedSettlements(),
      ])
      setLegacyQueueCounts({ transactions: transactions.length, settlements: settlements.length })
      setLegacyQueueStatus('ready')
      setLegacyQueueExported(false)
    } catch (error) {
      setLegacyQueueStatus('error')
      toast.error(`Gagal memeriksa antrean lama: ${error instanceof Error ? error.message : 'Kesalahan tidak diketahui'}`)
    }
  }

  useEffect(() => {
    void loadCloudBackups()
    void loadLocalSnapshotStatus()
    void loadLegacyQueueStatus()
    void getLocalBackupStatus().then(setLocalBackupStatus).catch(() => undefined)
  }, [])

  async function configureLocalBackup() {
    setLocalBackupLoading(true)
    try {
      const folderName = await chooseLocalBackupFolder()
      setLocalBackupStatus({ supported: true, configured: true, folderName })
      toast.success(`Backup otomatis aktif di folder ${folderName}`)
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') toast.error(error instanceof Error ? error.message : 'Gagal memilih folder backup')
    } finally {
      setLocalBackupLoading(false)
    }
  }

  async function backupToLocalFolderNow() {
    setLocalBackupLoading(true)
    try {
      if (await saveLocalBackup({ archive: true })) toast.success('Backup penuh berhasil disimpan ke HDD')
      else toast.error('Folder backup belum dipilih atau data lokal belum tersedia')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Backup lokal gagal')
    } finally {
      setLocalBackupLoading(false)
    }
  }

  async function exportLegacyQueues() {
    setLegacyQueueActionLoading(true)
    try {
      const [transactions, settlements] = await Promise.all([
        getQueuedTransactions(),
        getQueuedSettlements(),
      ])
      if (transactions.length === 0 && settlements.length === 0) {
        setLegacyQueueCounts({ transactions: 0, settlements: 0 })
        setLegacyQueueExported(false)
        toast.info('Tidak ada antrean transaksi lama untuk diekspor')
        return
      }
      const payload = {
        format: 'tokobahan-legacy-offline-queues',
        exported_at: new Date().toISOString(),
        transactions,
        settlements,
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `tokobahan-antrean-lama-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setLegacyQueueCounts({ transactions: transactions.length, settlements: settlements.length })
      setLegacyQueueExported(true)
      toast.success('File antrean lama diunduh. Simpan file ini sebelum menghapus antrean.')
    } catch (error) {
      toast.error(`Gagal mengekspor antrean lama: ${error instanceof Error ? error.message : 'Kesalahan tidak diketahui'}`)
    } finally {
      setLegacyQueueActionLoading(false)
    }
  }

  async function discardLegacyQueues() {
    if (!legacyQueueExported) {
      toast.error('Ekspor antrean lama terlebih dahulu')
      return
    }
    if (!window.confirm(
      'Antrean lama tidak akan diproses otomatis. Pastikan file JSON hasil ekspor sudah tersimpan dan antrean tidak lagi diperlukan. Hapus antrean dari perangkat ini?',
    )) return
    setLegacyQueueActionLoading(true)
    try {
      await clearOfflineOperationalData()
      setLegacyQueueCounts({ transactions: 0, settlements: 0 })
      setLegacyQueueExported(false)
      toast.success('Antrean lama dihapus dari perangkat')
    } catch (error) {
      toast.error(`Gagal menghapus antrean lama: ${error instanceof Error ? error.message : 'Kesalahan tidak diketahui'}`)
    } finally {
      setLegacyQueueActionLoading(false)
      await loadLegacyQueueStatus()
    }
  }

  async function initializeLocalData() {
    setInitializingLocalData(true)
    try {
      const result = await initializeOperationalSnapshot()
      await loadLocalSnapshotStatus()
      toast.success(`Data awal tersimpan di perangkat (${result.rows} baris dari ${result.tables} tabel)`)
    } catch (error) {
      toast.error(`Gagal menyiapkan data lokal: ${error instanceof Error ? error.message : 'Kesalahan tidak diketahui'}`)
    } finally {
      setInitializingLocalData(false)
    }
  }

  async function refreshLocalDataFromServer() {
    if (!window.confirm(
      'Data lokal di perangkat ini akan diganti dengan data terbaru dari server. ' +
      'Perubahan lokal yang belum disinkronkan akan hilang. Lanjutkan?',
    )) return
    setInitializingLocalData(true)
    try {
      const result = await refreshOperationalSnapshotFromServer()
      await loadLocalSnapshotStatus()
      toast.success(`Data lokal diperbarui dari server (${result.rows} baris dari ${result.tables} tabel)`)
    } catch (error) {
      toast.error(`Gagal memperbarui data lokal: ${error instanceof Error ? error.message : 'Kesalahan tidak diketahui'}`)
    } finally {
      setInitializingLocalData(false)
    }
  }

  async function syncLocalData() {
    const snapshot = await readOperationalSnapshot()
    if (!snapshot) {
      toast.error('Data lokal belum disiapkan. Ambil data server ke perangkat terlebih dahulu.')
      return
    }
    if (!snapshot.server_revision) {
      toast.error('Snapshot lokal belum memiliki versi dasar server. Ambil ulang data server sebelum mengirim.')
      return
    }
    const rowCount = Object.values(snapshot.tables).reduce((total, rows) => total + rows.length, 0)
    if (!window.confirm(
      `PERINGATAN: seluruh data lokal (${rowCount} baris) akan dikirim ke Supabase dan dapat menggantikan data server. ` +
      'Pastikan data lokal ini lengkap dan merupakan sumber data yang benar. Lanjutkan?',
    )) return
    setSyncingLocalData(true)
    try {
      const result = await syncOperationalSnapshot()
      toast.success(`Snapshot lokal dikirim ke Supabase (${result.rowCount} baris). Aplikasi tetap memakai data lokal.`)
    } catch (error) {
      toast.error(`Sinkronisasi gagal: ${error instanceof Error ? error.message : 'Kesalahan tidak diketahui'}`)
    } finally {
      setSyncingLocalData(false)
    }
  }

  async function addUnit() {
    const name = unitName.trim()
    if (!name) return
    if (units.some((unit) => unit.name.toLowerCase() === name.toLowerCase())) {
      toast.error('Satuan tersebut sudah ada')
      return
    }
    setUnitLoading(true)
    try {
      const snapshot = await readOperationalSnapshot()
      if (!snapshot) throw new Error('Data lokal belum disiapkan. Buka Backup dan pemulihan untuk mengambil data awal.')
      await updateOperationalSnapshot((current) => {
        const duplicate = current.tables.custom_units.some((unit) =>
          String(unit.name).trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
        )
        if (duplicate) throw new Error('Satuan tersebut sudah ada')
        return {
          snapshot: {
            ...current,
            tables: {
              ...current.tables,
              custom_units: [...current.tables.custom_units, {
                id: crypto.randomUUID(),
                name,
                factor: 1,
                created_at: new Date().toISOString(),
              }],
            },
          },
          result: undefined,
        }
      })
      toast.success('Satuan ditambahkan')
      setUnitName('')
      await loadUnits()
    } catch (error) {
      toast.error(`Gagal menambah satuan: ${error instanceof Error ? error.message : 'Kesalahan tidak diketahui'}`)
    }
    setUnitLoading(false)
  }

  async function removeUnit(id: string) {
    try {
      const snapshot = await readOperationalSnapshot()
      if (!snapshot) throw new Error('Data lokal belum disiapkan. Buka Backup dan pemulihan untuk mengambil data awal.')
      await deleteOperationalRows('custom_units', [id])
      toast.success('Satuan dihapus')
      await loadUnits()
    } catch (error) {
      toast.error(`Gagal menghapus satuan: ${error instanceof Error ? error.message : 'Kesalahan tidak diketahui'}`)
    }
  }

  async function resetDatabase() {
    if (!user?.email) {
      toast.error('Sesi pengguna tidak ditemukan')
      return
    }

    if (!password) {
      toast.error('Masukkan password akun admin')
      return
    }
    if (confirmation !== 'RESET SEMUA') {
      toast.error('Ketik RESET SEMUA untuk mengonfirmasi')
      return
    }

    setResetting(true)
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password,
    })
    if (authError) {
      toast.error('Password admin salah')
      setResetting(false)
      return
    }

    const { error: resetError } = await supabase.rpc('reset_operational_data')
    if (resetError) {
      toast.error(`Reset database gagal: ${resetError.message}`)
      setResetting(false)
      return
    }

    try {
      await clearOfflineOperationalData()
      await clearOperationalSnapshot()
      await resetOfflineInvoiceSequence()
      clearOfflineOperationalCache()
    } catch (error) {
      console.error('Database reset succeeded, but local offline data could not be cleared:', error)
      toast.error('Data server sudah direset, tetapi data offline perangkat ini gagal dihapus. Jangan lanjutkan penggunaan data lokal sebelum masalah ini diperbaiki.')
      setResetting(false)
      return
    }

    try {
      await rememberCurrentResetGeneration()
    } catch (error) {
      console.error('Database reset succeeded, but the local reset generation could not be saved:', error)
      toast.warning('Data server dan antrean perangkat ini sudah direset, tetapi status reset belum tersimpan. Antrean lama tidak akan diproses otomatis; tinjau data lokal pada perangkat lain sebelum digunakan.')
    }

    toast.success('Data operasional dikosongkan. Backup, akun admin, dan pengaturan tetap tersimpan.')
    setPassword('')
    setConfirmation('')
    setResetting(false)
  }

  async function enableNotifications() {
    if (!('Notification' in window)) {
      setNotificationPermission('unsupported')
      toast.error('Browser ini tidak mendukung notifikasi')
      return
    }

    const permission = await Notification.requestPermission()
    setNotificationPermission(permission)
    if (permission === 'granted') {
      try {
        await registerPushSubscription()
        const result = await notifyLowStockPush({ force: true })
        if (result.removed) await registerPushSubscription({ force: true })
        toast.success(
          result.sent
            ? `Push notification aktif (${result.sent} notifikasi terkirim)`
            : 'Push notification stok diaktifkan',
        )
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Gagal mengaktifkan push notification')
      }
    } else if (permission === 'denied') {
      toast.error('Izin notifikasi ditolak oleh browser')
    }
  }

  async function createBackup() {
    setCloudBackupError(null)
    setBackupLoading(true)
    try {
      const localSnapshot = await readOperationalSnapshot()
      if (localSnapshot) {
        const payload = JSON.parse(JSON.stringify(localSnapshot)) as Json
        const { data, error } = await supabase.rpc('upload_operational_backup', { p_payload: payload })
        if (error) throw error
        const result = data as { id: string; created_at: string } | null
        if (!result?.id || !result.created_at) throw new Error('Respons backup lokal tidak valid')
        await uploadBackupObject(result.id, payload)
        downloadBackup(payload, result.created_at)
        await loadCloudBackups()
        const totalRecords = Object.values(localSnapshot.tables).reduce((total, rows) => total + rows.length, 0)
        toast.success(`Backup data lokal berhasil dibuat (${totalRecords} baris)`)
        return
      }

      const { data, error } = await supabase.rpc('create_operational_backup')
      if (error) throw error
      const result = data as { id: string; created_at: string; payload: Json; counts?: Record<string, number> } | null
      if (!result?.payload || !result.id) throw new Error('Respons backup tidak valid')
      await uploadBackupObject(result.id, result.payload)
      downloadBackup(result.payload, result.created_at)
      await loadCloudBackups()
      const totalRecords = Object.values(result.counts || {}).reduce((total, count) => total + Number(count || 0), 0)
      toast.success(`Backup berhasil dibuat${totalRecords ? ` (${totalRecords} data)` : ''}`)
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
          ? error.message
          : 'Gagal membuat backup'
      setCloudBackupError(message)
      toast.error(`Backup gagal: ${message}`)
    } finally {
      setBackupLoading(false)
    }
  }

  function downloadBackup(payload: Json, createdAt: string) {
    const filenameDate = new Date(createdAt).toISOString().replace(/[:.]/g, '-')
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `tokobahan-backup-${filenameDate}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function uploadBackupObject(backupId: string, payload: Json) {
    if (!user?.id) throw new Error('Sesi admin tidak ditemukan')
    const objectPath = `${user.id}/${backupId}.json`
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const { error: uploadError } = await supabase.storage
      .from(BACKUP_BUCKET)
      .upload(objectPath, blob, { contentType: 'application/json', cacheControl: '3600', upsert: false })
    if (uploadError) {
      throw new Error(`Upload ke Storage gagal: ${uploadError.message}`)
    }
    const { error: metadataError } = await supabase.rpc('finalize_operational_backup_storage', {
      p_backup_id: backupId,
      p_storage_object_path: objectPath,
      p_storage_size_bytes: blob.size,
      p_storage_content_type: 'application/json',
    })
    if (metadataError) {
      await supabase.storage.from(BACKUP_BUCKET).remove([objectPath])
      throw new Error(`Finalisasi metadata backup gagal: ${metadataError.message}`)
    }
  }

  async function readCloudBackup(backup: typeof cloudBackups[number]) {
    if (!backup.storage_object_path || backup.storage_bucket !== BACKUP_BUCKET) {
      if (backup.payload) return backup.payload
      const { data, error } = await supabase
        .from('operational_backups')
        .select('payload')
        .eq('id', backup.id)
        .single()
      if (error) throw error
      return data.payload as Json
    }
    const { data, error } = await supabase.storage.from(BACKUP_BUCKET).download(backup.storage_object_path)
    if (error) throw error
    return JSON.parse(await data.text()) as Json
  }

  async function uploadBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setCloudBackupLoading(true)
    setCloudBackupError(null)
    try {
      const payload = JSON.parse(await file.text()) as Record<string, unknown>
      if (payload.format !== 'tokobahan-operational-backup' || !payload.tables) {
        throw new Error('Format backup tidak valid')
      }
      const { data, error } = await supabase.rpc('upload_operational_backup', { p_payload: payload as Json })
      if (error) throw error
      const result = data as { id: string; created_at: string } | null
      if (!result?.id || !result.created_at) throw new Error('Respons upload backup tidak valid')
      await uploadBackupObject(result.id, payload as Json)
      await loadCloudBackups()
      toast.success('Backup berhasil diunggah ke cloud')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gagal mengunggah backup'
      setCloudBackupError(message)
      toast.error(`Upload backup gagal: ${message}`)
    } finally {
      setCloudBackupLoading(false)
    }
  }

  async function restoreCloudBackup(backup: typeof cloudBackups[number]) {
    if (!window.confirm('Restore akan mengganti seluruh data operasional saat ini. Lanjutkan?')) return
    setRestoreLoading(true)
    setCloudBackupError(null)
    try {
      const payload = await readCloudBackup(backup)
      const target = await applyOperationalBackup(payload)
      toast.success(target === 'local' ? 'Backup cloud dipulihkan ke data lokal' : 'Backup cloud berhasil dipulihkan')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gagal memulihkan backup'
      setCloudBackupError(message)
      toast.error(`Restore gagal: ${message}`)
    } finally {
      setRestoreLoading(false)
    }
  }

  async function restoreBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!window.confirm('Restore akan mengganti seluruh data operasional saat ini. Lanjutkan?')) return
    setRestoreLoading(true)
    try {
      const payload = JSON.parse(await file.text())
      const target = await applyOperationalBackup(payload)
      toast.success(target === 'local' ? 'Backup dipulihkan ke data lokal' : 'Backup berhasil dipulihkan')
    } catch (error) {
      toast.error(`Restore gagal: ${error instanceof Error ? error.message : 'Format backup tidak valid'}`)
    } finally {
      setRestoreLoading(false)
    }
  }

  async function applyOperationalBackup(payload: unknown): Promise<'local' | 'server'> {
    const localSnapshot = await readOperationalSnapshot()
    const snapshot = validateOperationalSnapshotIntegrity(validateOperationalSnapshot(payload))
    if (localSnapshot) {
      if (localSnapshot.synced_generated_at && localSnapshot.synced_generated_at !== localSnapshot.generated_at) {
        throw new Error('Restore dibatalkan karena ada perubahan lokal yang belum tersinkron. Sinkronkan data terlebih dahulu.')
      }
      if (navigator.onLine) {
        const { data: revision, error } = await supabase.rpc('get_operational_data_revision')
        if (error) throw new Error(`Gagal memeriksa versi data server: ${error.message}`)
        if (typeof revision !== 'string' || !/^\d+$/.test(revision)) {
          throw new Error('Server tidak mengembalikan versi data yang valid')
        }
        await writeOperationalSnapshot({ ...snapshot, server_revision: revision })
      } else {
        await writeOperationalSnapshot(snapshot)
      }
      await loadLocalSnapshotStatus()
      return 'local'
    }
    await writeOperationalSnapshot(snapshot)
    await loadLocalSnapshotStatus()
    return 'local'
  }

  async function syncNotifications() {
    try {
      await registerPushSubscription()
      const result = await notifyLowStockPush({ force: true })
      if (result.removed) await registerPushSubscription({ force: true })
      toast.success(
        result.sent
          ? `Notifikasi tersinkron (${result.sent} notifikasi terkirim)`
          : 'Notifikasi tersinkron. Belum ada stok menipis untuk dikirim.',
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal menyinkronkan push notification')
    }
  }

  function toggleStockSound() {
    const enabled = !soundEnabled
    setStockSoundEnabled(enabled)
    setSoundEnabled(enabled)
    if (enabled) {
      playLowStockSound()
      toast.success('Suara notifikasi stok diaktifkan')
    }
  }

  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <div className="page-header sticky top-[-1rem] z-30 flex flex-col justify-center -mx-4 -mt-4 bg-ink px-4 py-4 text-white shadow-[0_3px_0_rgba(32,42,46,0.2)] sm:top-[-1.25rem] sm:-mx-5 sm:-mt-5 sm:px-5 lg:top-[-2rem] lg:-mx-8 lg:-mt-8 lg:!mb-0 lg:px-8 lg:py-5">
        <h2 className="text-3xl font-bold tracking-tight text-white">Pengaturan</h2>
        <p className="mt-1 max-w-2xl text-sm text-accent">Kelola data dasar, stok, backup, dan notifikasi aplikasi.</p>
        {renderTabNavigation('mt-4 -mx-1 grid w-full grid-cols-4 gap-1 pb-1 lg:hidden')}
      </div>
      {renderTabNavigation('page-header-tabs hidden w-full grid-cols-4 gap-2 overflow-x-auto border-b border-border pb-1 lg:!mt-4 lg:sticky lg:z-20 lg:grid lg:bg-canvas', true)}

      {activeTab === 'master' && <section aria-labelledby="master-data-heading" className="space-y-3">
        <div>
          <h3 id="master-data-heading" className="text-lg font-bold tracking-tight text-ink">Data dasar dan akses admin</h3>
          <p className="mt-1 text-sm text-muted-foreground">Kelola data yang dipakai saat membuat produk, mencatat transaksi, dan menjaga aplikasi.</p>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-red-200">
          <CardHeader>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 text-left"
              aria-expanded={resetOpen}
              aria-controls="reset-database-content"
              onClick={() => setResetOpen((open) => !open)}
            >
              <CardTitle className="flex items-center gap-2 text-red-700">
                <Database className="h-5 w-5" />
                Reset data operasional
              </CardTitle>
              <ChevronDown
                className={`h-5 w-5 shrink-0 text-red-700 transition-transform ${resetOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>
          </CardHeader>
          {resetOpen && <CardContent id="reset-database-content" className="space-y-4">
            <div className="flex gap-3 rounded-lg bg-red-50 p-4 text-sm text-red-800">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <div className="min-w-0">
                <p>
                  Tindakan ini menghapus seluruh data operasional dan master, termasuk produk, kategori,
                  vendor, pelanggan, satuan khusus, transaksi, stok, hutang, retur, dan opname. Antrean
                  offline di perangkat ini juga dihapus. Akun admin, subscription notifikasi, pengaturan,
                  fungsi Edge, dan backup lama tetap tersimpan. Nomor invoice online kembali ke RJA-0001;
                  ID data memakai UUID dan tidak diurutkan ulang. Reset tidak dapat dibatalkan.
                </p>
                <p className="mt-2 text-xs text-red-700">
                  Ekspor dan tinjau antrean offline pada perangkat ini sebelum reset, atau pastikan
                  antrean tersebut tidak lagi diperlukan. Perangkat lain mungkin masih menyimpan
                  snapshot lokalnya dan harus ditinjau secara manual sebelum digunakan. Jangan
                  mencatat transaksi pada perangkat lain sebelum kondisi data lokalnya diperiksa.
                </p>
              </div>
            </div>
            <div>
              <label htmlFor="reset-password" className="mb-1 block text-sm font-medium">Password admin</label>
              <Input
                id="reset-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Masukkan password akun Anda"
                autoComplete="current-password"
              />
            </div>
            <div>
              <label htmlFor="reset-confirmation" className="mb-1 block text-sm font-medium">
                Ketik <strong>RESET SEMUA</strong>
              </label>
              <Input
                id="reset-confirmation"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder="RESET SEMUA"
                autoComplete="off"
              />
            </div>
            <Button
              variant="destructive"
              className="w-full"
              disabled={resetting || !password || confirmation !== 'RESET SEMUA'}
              onClick={resetDatabase}
            >
              {resetting && <LoadingDots className="text-current" dotClassName="h-1.5 w-1.5" />}
              {resetting ? 'Mereset database...' : 'Reset Semua Data'}
            </Button>
          </CardContent>}
        </Card>

        <Card>
        <CardHeader>
          <CardTitle className="text-base">Vendor</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Simpan nama pemasok yang sering dipilih pada produk.</p>
          <div className="flex gap-2">
            <Input
              aria-label="Nama vendor baru"
              value={vendorName}
              onChange={(event) => setVendorName(toTitleCase(event.target.value))}
              placeholder="Nama vendor baru"
              onKeyDown={(event) => { if (event.key === 'Enter') void addVendor() }}
            />
            <Button onClick={() => void addVendor()} disabled={vendorLoading || !vendorName.trim()}>Tambah</Button>
          </div>
          {vendors.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada vendor tersimpan.</p>
          ) : (
            <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-xl border border-border">
              {vendors.map((vendor) => (
                <li key={vendor.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span>{vendor.name}</span>
                  <button type="button" onClick={() => void removeVendor(vendor.id)} className="rounded-lg p-2 text-muted-foreground hover:bg-red-50 hover:text-red-600" aria-label={`Hapus vendor ${vendor.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Satuan produk</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">Tambahkan nama satuan yang akan muncul di dropdown Produk.</p>
            <div className="flex gap-2">
              <Input
                aria-label="Nama satuan baru"
                value={unitName}
                onChange={(event) => setUnitName(toTitleCase(event.target.value))}
                placeholder="Contoh: Roll, Kg, Dus"
                onKeyDown={(event) => { if (event.key === 'Enter') void addUnit() }}
              />
              <Button onClick={() => void addUnit()} disabled={unitLoading || !unitName.trim()}>Tambah</Button>
            </div>
            <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-xl border border-border">
              {[...BUILT_IN_UNITS, ...units.map((unit) => ({ ...unit, builtIn: false }))].map((unit) => (
                  <li key={unit.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span>{unit.name}</span>
                    {unit.builtIn ? (
                      <span className="text-xs text-muted-foreground">Bawaan</span>
                    ) : (
                      <button type="button" onClick={() => void removeUnit(unit.id)} className="rounded-lg p-2 text-muted-foreground hover:bg-red-50 hover:text-red-600" aria-label={`Hapus satuan ${unit.name}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
      </section>}

      {activeTab === 'stock' && <section aria-labelledby="stock-heading" className="space-y-3">
      <div>
        <h3 id="stock-heading" className="text-lg font-bold tracking-tight text-ink">Stok</h3>
        <p className="mt-1 text-sm text-muted-foreground">Periksa dan sesuaikan stok fisik dengan catatan di aplikasi.</p>
      </div>
      <Card className="border-sky-200 bg-sky-50/30">
        <CardHeader>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 text-left"
            aria-expanded={stockOpnameOpen}
            aria-controls="stock-opname-content"
            onClick={() => setStockOpnameOpen((open) => !open)}
          >
            <CardTitle className="flex items-center gap-2 text-sky-800">
              <ClipboardCheck className="h-5 w-5" />
              Stok Opname
            </CardTitle>
            <ChevronDown
              className={`h-5 w-5 shrink-0 text-sky-700 transition-transform ${stockOpnameOpen ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </button>
          <p className="mt-2 text-sm text-muted-foreground">
            Sesuaikan stok sistem berdasarkan hasil penghitungan fisik.
          </p>
        </CardHeader>
        {stockOpnameOpen && (
          <CardContent id="stock-opname-content" className="border-t border-sky-200 pt-5">
            <StockOpname />
          </CardContent>
        )}
      </Card>
      </section>}

      {activeTab === 'backup' && <section aria-labelledby="backup-heading" className="space-y-3">
      <div>
        <h3 id="backup-heading" className="text-lg font-bold tracking-tight text-ink">Backup dan pemulihan</h3>
        <p className="mt-1 text-sm text-muted-foreground">Simpan salinan data sebelum melakukan perubahan besar atau pindah perangkat.</p>
      </div>
      {legacyQueueStatus === 'error' ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Gagal memeriksa antrean transaksi lama. Inisialisasi data lokal mungkin tertahan sampai antrean dapat diperiksa.
          <Button className="ml-2" variant="outline" size="sm" onClick={() => void loadLegacyQueueStatus()}>
            Coba lagi
          </Button>
        </div>
      ) : (legacyQueueCounts.transactions > 0 || legacyQueueCounts.settlements > 0) && (
        <Card className="border-amber-300">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-amber-900">
              <AlertTriangle className="h-5 w-5" />
              Antrean dari versi lama
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-amber-900">
              Ditemukan {legacyQueueCounts.transactions} transaksi dan {legacyQueueCounts.settlements} pelunasan lama.
              Antrean ini tidak akan dikirim otomatis, dan harus ditinjau sebelum aplikasi dapat menyiapkan atau
              mengambil ulang snapshot lokal. Ekspor file JSON untuk ditinjau atau diarsipkan; penghapusan tidak
              memasukkan transaksi tersebut ke snapshot.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => void exportLegacyQueues()}
                disabled={legacyQueueActionLoading || legacyQueueStatus !== 'ready'}
              >
                <Download className="h-4 w-4" />
                {legacyQueueActionLoading ? 'Memproses...' : 'Ekspor antrean JSON'}
              </Button>
              <Button
                variant="outline"
                className="border-red-300 text-red-700 hover:bg-red-50"
                onClick={() => void discardLegacyQueues()}
                disabled={legacyQueueActionLoading || !legacyQueueExported}
              >
                <Trash2 className="h-4 w-4" />
                Hapus antrean setelah ekspor
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-5 w-5 text-primary" />
            Data lokal dan sinkronisasi
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            IndexedDB di perangkat ini adalah sumber data utama. Sinkronkan untuk mengirim seluruh snapshot
            lokal ke Supabase agar dapat dilihat dari aplikasi mobile; setelah selesai aplikasi tetap bekerja
            menggunakan data lokal. Jika data server berubah sejak snapshot diambil, sinkronisasi akan ditolak
            agar perubahan server tidak tertimpa.
          </p>
          {localSnapshotStatus === 'loading' ? (
            <p className="text-sm text-muted-foreground">Memeriksa data lokal...</p>
          ) : localSnapshotStatus === 'error' ? (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <p>Data lokal tidak dapat diperiksa: {localSnapshotError}</p>
              <Button className="mt-2" variant="outline" size="sm" onClick={() => void loadLocalSnapshotStatus()}>
                Coba lagi
              </Button>
            </div>
          ) : localSnapshotStatus === 'available' ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              Data lokal aktif · {localSnapshotSummary?.rowCount ?? 0} baris di {localSnapshotSummary?.tableCount ?? 0} tabel
            </div>
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Data lokal belum disiapkan. Inisialisasi akan menyalin snapshot operasional Supabase ke perangkat ini satu kali.
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {localSnapshotStatus === 'missing' && (
              <Button onClick={() => void initializeLocalData()} disabled={initializingLocalData || syncingLocalData}>
                {initializingLocalData
                  ? <LoadingDots className="text-current" dotClassName="h-1.5 w-1.5" />
                  : <Download className="h-4 w-4" />}
                {initializingLocalData ? 'Menyiapkan data lokal...' : 'Salin data server ke perangkat'}
              </Button>
            )}
            {localSnapshotStatus === 'available' && (
              <>
                <Button onClick={() => void syncLocalData()} disabled={syncingLocalData || initializingLocalData}>
                  {syncingLocalData
                    ? <LoadingDots className="text-current" dotClassName="h-1.5 w-1.5" />
                    : <Upload className="h-4 w-4" />}
                  {syncingLocalData ? 'Mengirim seluruh data aplikasi...' : 'Kirim seluruh data aplikasi ke Server'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void refreshLocalDataFromServer()}
                  disabled={syncingLocalData || initializingLocalData}
                >
                  {initializingLocalData
                    ? <LoadingDots className="text-current" dotClassName="h-1.5 w-1.5" />
                    : <Download className="h-4 w-4" />}
                  Ambil ulang data server
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
      <Card className="border-emerald-200 bg-emerald-50/30">
        <CardHeader>
          <CardTitle className="text-base">Backup otomatis ke HDD PC</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Pilih folder di HDD satu kali. Selama aplikasi terbuka, backup penuh dibuat otomatis setiap hari
            pukul 16.00 waktu komputer. File <strong>tokobahan-backup-latest.json</strong> selalu diperbarui,
            ditambah satu file bertimestamp sebagai arsip.
          </p>
          {!localBackupStatus.supported ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Browser ini tidak mendukung penulisan otomatis ke folder. Gunakan Chrome atau Edge di PC, atau gunakan
              tombol download backup JSON di bawah.
            </p>
          ) : (
            <>
              <p className={`rounded-xl p-3 text-sm ${localBackupStatus.configured ? 'border border-emerald-200 bg-emerald-100 text-emerald-800' : 'border border-amber-200 bg-amber-50 text-amber-800'}`}>
                {localBackupStatus.configured
                  ? `Aktif · folder: ${localBackupStatus.folderName}`
                  : 'Belum aktif. Pilih folder HDD untuk mengaktifkan backup otomatis.'}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void configureLocalBackup()} disabled={localBackupLoading}>
                  {localBackupLoading ? 'Memproses...' : localBackupStatus.configured ? 'Ganti folder backup' : 'Pilih folder HDD'}
                </Button>
                {localBackupStatus.configured && (
                  <Button variant="outline" onClick={() => void backupToLocalFolderNow()} disabled={localBackupLoading}>
                    Backup sekarang
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Cadangan data operasional
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-primary/15 bg-primary/5 p-4 text-sm text-muted-foreground">
            <p className="font-semibold text-ink">Backup lengkap dan aman</p>
            <p className="mt-1">
              Mencadangkan profil non-sensitif, kategori, produk, transaksi, detail transaksi,
              dan batch stok sebagai file JSON di private Supabase Storage, lalu mengunduh salinan ke perangkat ini.
              Password, token, dan data autentikasi tidak pernah ikut dicadangkan.
            </p>
          </div>
          <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            <p><strong className="text-ink">Format:</strong> JSON terstruktur</p>
            <p><strong className="text-ink">Akses:</strong> Admin saja</p>
            <p><strong className="text-ink">Penyimpanan:</strong> Storage private + perangkat</p>
            <p><strong className="text-ink">Identitas:</strong> ID backup tercatat</p>
          </div>
          <Button className="w-full sm:w-auto" onClick={createBackup} disabled={backupLoading}>
            {backupLoading ? (
              <LoadingDots className="text-current" dotClassName="h-1.5 w-1.5" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {backupLoading ? 'Membuat backup...' : 'Buat & Unduh Backup'}
          </Button>
          <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-xl border border-primary/30 px-4 py-2.5 text-sm font-semibold text-primary hover:bg-primary/5">
            <input type="file" accept="application/json,.json" className="sr-only" onChange={restoreBackup} disabled={restoreLoading} />
            {restoreLoading ? 'Memulihkan...' : 'Restore Backup JSON'}
          </label>
          <div className="border-t border-border pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-ink">Backup cloud</p>
                <p className="text-xs text-muted-foreground">File tersimpan di bucket private Supabase Storage; hanya admin yang login dapat mengaksesnya. Maksimal 7 backup terbaru per admin.</p>
              </div>
            </div>
            {cloudBackupError && (
              <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {cloudBackupError}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-primary/30 px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/5">
                <input type="file" accept="application/json,.json" className="sr-only" onChange={uploadBackup} disabled={cloudBackupLoading} />
                <Upload className="h-4 w-4" />
                {cloudBackupLoading ? 'Mengunggah...' : 'Upload JSON ke cloud'}
              </label>
            </div>
            {cloudBackups.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">Belum ada backup cloud.</p>
            ) : (
              <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
                {cloudBackups.map((backup) => (
                  <li key={backup.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 text-sm">
                    <div>
                      <p className="font-medium text-ink">{new Date(backup.created_at).toLocaleString('id-ID')}</p>
                      <p className="text-xs text-muted-foreground">ID {backup.id.slice(0, 8)} · v{backup.backup_version}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void readCloudBackup(backup).then((payload) => downloadBackup(payload, backup.created_at)).catch((error) => toast.error(`Unduh backup gagal: ${error instanceof Error ? error.message : 'Storage tidak tersedia'}`))}
                      >
                        <Download className="h-4 w-4" />
                        Unduh
                      </Button>
                      <Button size="sm" onClick={() => void restoreCloudBackup(backup)} disabled={restoreLoading}>
                        {restoreLoading ? 'Memulihkan...' : 'Restore'}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
      </section>}

      {activeTab === 'notification' && <section aria-labelledby="notification-heading" className="space-y-3">
      <div>
        <h3 id="notification-heading" className="text-lg font-bold tracking-tight text-ink">Notifikasi</h3>
        <p className="mt-1 text-sm text-muted-foreground">Pilih cara aplikasi memberi tahu admin saat stok perlu diperiksa.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-5 w-5 text-primary" />
            Notifikasi Stok
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-ink">
              {notificationPermission === 'granted'
                ? 'Notifikasi stok sudah aktif'
                : 'Aktifkan notifikasi stok menipis'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Terima pemberitahuan saat stok produk berada di bawah atau sama dengan minimum stok.
            </p>
          </div>
          {notificationPermission === 'unsupported' ? (
            <span className="text-xs text-muted-foreground">Browser tidak mendukung</span>
          ) : notificationPermission === 'granted' ? (
            <div className="flex items-center gap-2">
              <span className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                Aktif
              </span>
              <Button variant="outline" onClick={syncNotifications}>
                <Bell className="h-4 w-4" />
                Sinkronkan
              </Button>
            </div>
          ) : notificationPermission === 'denied' ? (
            <span className="max-w-48 text-right text-xs text-amber-700">
              Izin ditolak. Ubah izin notifikasi dari pengaturan browser.
            </span>
          ) : (
            <Button variant="outline" onClick={enableNotifications}>
              <Bell className="h-4 w-4" />
              Aktifkan notifikasi
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-5 w-5 text-primary" />
            Suara Notifikasi
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-ink">
              {soundEnabled ? 'Suara stok menipis aktif' : 'Aktifkan suara stok menipis'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Bunyi pendek akan diputar saat produk baru terdeteksi stoknya menipis.
            </p>
          </div>
          <Button
            variant={soundEnabled ? 'secondary' : 'outline'}
            onClick={toggleStockSound}
          >
            <Bell className="h-4 w-4" />
            {soundEnabled ? 'Suara aktif' : 'Aktifkan'}
          </Button>
        </CardContent>
      </Card>
      </div>
      </section>}

    </div>
  )
}
