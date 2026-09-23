import { useEffect, useState, type ChangeEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { AlertTriangle, Bell, ChevronDown, Database, Download, ShieldCheck, Trash2 } from 'lucide-react'
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
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { UNIT_LABELS } from '@/types'

const BUILT_IN_UNITS = Object.entries(UNIT_LABELS).map(([id, name]) => ({ id, name, builtIn: true }))

export default function Settings() {
  const { user, isRole } = useAuthStore()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [resetting, setResetting] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [backupLoading, setBackupLoading] = useState(false)
  const [restoreLoading, setRestoreLoading] = useState(false)
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

  async function loadVendors() {
    const { data, error } = await supabase.from('vendors').select('id, name').order('name')
    if (error) toast.error(`Gagal memuat vendor: ${error.message}`)
    else setVendors(data || [])
  }

  useEffect(() => {
    void loadVendors()
  }, [])

  async function addVendor() {
    const name = vendorName.trim()
    if (!name) return
    setVendorLoading(true)
    const { error } = await supabase.from('vendors').insert({ name })
    if (error) toast.error(`Gagal menambah vendor: ${error.message}`)
    else {
      toast.success('Vendor ditambahkan')
      setVendorName('')
      await loadVendors()
    }
    setVendorLoading(false)
  }

  async function removeVendor(id: string) {
    const { error } = await supabase.from('vendors').delete().eq('id', id)
    if (error) toast.error(`Gagal menghapus vendor: ${error.message}`)
    else {
      toast.success('Vendor dihapus')
      await loadVendors()
    }
  }

  async function loadUnits() {
    const { data, error } = await supabase.from('custom_units').select('id, name').order('name')
    if (error) toast.error(`Gagal memuat satuan: ${error.message}`)
    else setUnits(data || [])
  }

  useEffect(() => {
    void loadUnits()
  }, [])

  async function addUnit() {
    const name = unitName.trim()
    if (!name) return
    if (units.some((unit) => unit.name.toLowerCase() === name.toLowerCase())) {
      toast.error('Satuan tersebut sudah ada')
      return
    }
    setUnitLoading(true)
    const { error } = await supabase.from('custom_units').insert({ name, factor: 1 })
    if (error) toast.error(`Gagal menambah satuan: ${error.message}`)
    else {
      toast.success('Satuan ditambahkan')
      setUnitName('')
      await loadUnits()
    }
    setUnitLoading(false)
  }

  async function removeUnit(id: string) {
    const { error } = await supabase.from('custom_units').delete().eq('id', id)
    if (error) toast.error(`Gagal menghapus satuan: ${error.message}`)
    else {
      toast.success('Satuan dihapus')
      await loadUnits()
    }
  }

  if (!isRole('admin')) return <Navigate to="/" replace />

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

    toast.success('Database operasional berhasil dikosongkan')
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
        const result = await notifyLowStockPush()
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
    setBackupLoading(true)
    const { data, error } = await supabase.rpc('create_operational_backup')
    if (error) {
      toast.error(`Backup gagal: ${error.message}`)
      setBackupLoading(false)
      return
    }

    const result = data as {
      id: string
      created_at: string
      payload: Record<string, unknown>
      counts: Record<string, number>
    } | null
    if (!result?.payload || !result.id) {
      toast.error('Backup gagal: respons backup tidak valid')
      setBackupLoading(false)
      return
    }

    const filenameDate = new Date(result.created_at).toISOString().replace(/[:.]/g, '-')
    const blob = new Blob([JSON.stringify(result.payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `tokobahan-backup-${filenameDate}.json`
    link.click()
    URL.revokeObjectURL(url)

    const totalRecords = Object.values(result.counts).reduce((total, count) => total + Number(count || 0), 0)
    toast.success(`Backup berhasil diunduh (${totalRecords} data, ID ${result.id.slice(0, 8)})`)
    setBackupLoading(false)
  }

  async function restoreBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!window.confirm('Restore akan mengganti seluruh data operasional saat ini. Lanjutkan?')) return
    setRestoreLoading(true)
    try {
      const payload = JSON.parse(await file.text())
      const { error } = await supabase.rpc('restore_operational_backup', { p_payload: payload })
      if (error) throw error
      toast.success('Backup berhasil dipulihkan')
    } catch (error) {
      toast.error(`Restore gagal: ${error instanceof Error ? error.message : 'Format backup tidak valid'}`)
    } finally {
      setRestoreLoading(false)
    }
  }

  async function syncNotifications() {
    try {
      await registerPushSubscription()
      const result = await notifyLowStockPush()
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
    <div className="mx-auto max-w-[1200px] space-y-6">
      <div className="border-b border-border pb-5">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-primary">Kontrol administrator</p>
        <h2 className="text-3xl font-bold tracking-tight text-ink">Pengaturan</h2>
        <p className="mt-1 text-sm text-muted-foreground">Pengaturan operasional khusus administrator.</p>
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
                Reset Database Operasional
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
              <p>
                Tindakan ini menghapus semua produk, kategori, transaksi, dan detail transaksi.
                Akun login dan profil admin tidak ikut dihapus. Tindakan ini tidak dapat dibatalkan.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Password admin</label>
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Masukkan password akun Anda"
                autoComplete="current-password"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Ketik <strong>RESET SEMUA</strong>
              </label>
              <Input
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
          <CardTitle className="text-base">Daftar Vendor</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={vendorName}
              onChange={(event) => setVendorName(event.target.value)}
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
            <CardTitle className="text-base">Master Satuan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">Tambahkan nama satuan yang akan muncul di dropdown Produk.</p>
            <div className="flex gap-2">
              <Input
                value={unitName}
                onChange={(event) => setUnitName(event.target.value)}
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Backup Data Operasional
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-primary/15 bg-primary/5 p-4 text-sm text-muted-foreground">
            <p className="font-semibold text-ink">Backup lengkap dan aman</p>
            <p className="mt-1">
              Mencadangkan profil non-sensitif, kategori, produk, transaksi, detail transaksi,
              dan batch stok ke Supabase lalu mengunduh salinan JSON ke perangkat ini.
              Password, token, dan data autentikasi tidak pernah ikut dicadangkan.
            </p>
          </div>
          <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            <p><strong className="text-ink">Format:</strong> JSON terstruktur</p>
            <p><strong className="text-ink">Akses:</strong> Admin saja</p>
            <p><strong className="text-ink">Penyimpanan:</strong> Supabase + perangkat</p>
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
        </CardContent>
      </Card>

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
            {soundEnabled ? 'Suara aktif' : 'Aktifkan suara'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
