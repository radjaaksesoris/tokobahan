import { readOperationalSnapshot } from '@/lib/offlineOperationalSnapshot'

const BACKUP_DB_NAME = 'konveksi-pos-local-backup'
const BACKUP_DB_VERSION = 1
const BACKUP_STORE = 'settings'
const BACKUP_HANDLE_KEY = 'directory'
export const LOCAL_BACKUP_LAST_GENERATED_KEY = 'tokobahan.local-backup-last-generated-at'
const TAURI_BACKUP_PATH_KEY = 'tokobahan.tauri-backup-folder'
const DAILY_BACKUP_HOUR = 17

type DirectoryHandle = {
  kind: 'directory'
  name: string
  queryPermission?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>
  requestPermission?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<{
    createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>
  }>
}

type BackupWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<DirectoryHandle>
}

function supportsDirectoryBackup() {
  return typeof window !== 'undefined' && typeof (window as BackupWindow).showDirectoryPicker === 'function'
}

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function readTauriBackupPath() {
  try {
    return window.localStorage.getItem(TAURI_BACKUP_PATH_KEY)
  } catch {
    return null
  }
}

function filePath(folder: string, filename: string) {
  const separator = folder.includes('\\') ? '\\' : '/'
  return `${folder.replace(/[\\/]$/, '')}${separator}${filename}`
}

async function saveTauriBackup(folder: string, snapshot: Awaited<ReturnType<typeof readOperationalSnapshot>>, archive: boolean) {
  if (!snapshot) return false
  const { writeTextFile } = await import('@tauri-apps/plugin-fs')
  const content = JSON.stringify(snapshot, null, 2)
  const filenames = archive
    ? ['tokobahan-backup-latest.json', `tokobahan-backup-${timestampForFilename(new Date())}.json`]
    : ['tokobahan-backup-latest.json']
  for (const filename of filenames) await writeTextFile(filePath(folder, filename), content)
  try {
    window.localStorage.setItem(LOCAL_BACKUP_LAST_GENERATED_KEY, snapshot.generated_at)
  } catch {
    // The files are already safely written; localStorage is only the close-warning marker.
  }
  return true
}

function openBackupDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BACKUP_DB_NAME, BACKUP_DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(BACKUP_STORE)) request.result.createObjectStore(BACKUP_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Gagal membuka pengaturan backup lokal'))
  })
}

async function saveDirectoryHandle(handle: DirectoryHandle) {
  const database = await openBackupDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(BACKUP_STORE, 'readwrite').objectStore(BACKUP_STORE).put(handle, BACKUP_HANDLE_KEY)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error || new Error('Gagal menyimpan folder backup'))
    })
  } finally {
    database.close()
  }
}

async function readDirectoryHandle() {
  const database = await openBackupDatabase()
  try {
    return await new Promise<DirectoryHandle | undefined>((resolve, reject) => {
      const request = database.transaction(BACKUP_STORE, 'readonly').objectStore(BACKUP_STORE).get(BACKUP_HANDLE_KEY)
      request.onsuccess = () => resolve(request.result as DirectoryHandle | undefined)
      request.onerror = () => reject(request.error || new Error('Gagal membaca folder backup'))
    })
  } finally {
    database.close()
  }
}

async function ensurePermission(handle: DirectoryHandle, request = false) {
  if (!handle.queryPermission) return true
  const options = { mode: 'readwrite' as const }
  const permission = await handle.queryPermission(options)
  if (permission === 'granted') return true
  if (!request || !handle.requestPermission) return false
  return (await handle.requestPermission(options)) === 'granted'
}

function timestampForFilename(date: Date) {
  return date.toISOString().replace(/[:.]/g, '-')
}

export async function chooseLocalBackupFolder() {
  if (isTauriRuntime()) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({ directory: true, multiple: false })
    if (typeof selected !== 'string') throw new DOMException('Pemilihan folder dibatalkan', 'AbortError')
    window.localStorage.setItem(TAURI_BACKUP_PATH_KEY, selected)
    return selected.split(/[\\/]/).filter(Boolean).pop() || selected
  }
  if (!supportsDirectoryBackup()) throw new Error('Browser ini belum mendukung penyimpanan langsung ke folder HDD. Gunakan Chrome atau Edge di PC.')
  const handle = await (window as BackupWindow).showDirectoryPicker?.({ mode: 'readwrite' })
  if (!handle || !(await ensurePermission(handle, true))) throw new Error('Izin ke folder backup ditolak')
  await saveDirectoryHandle(handle)
  return handle.name
}

export async function getLocalBackupStatus(): Promise<{ supported: boolean; configured: boolean; folderName?: string }> {
  if (isTauriRuntime()) {
    const folder = readTauriBackupPath()
    return { supported: true, configured: Boolean(folder), folderName: folder?.split(/[\\/]/).filter(Boolean).pop() }
  }
  if (!supportsDirectoryBackup()) return { supported: false, configured: false }
  const handle = await readDirectoryHandle()
  if (!handle) return { supported: true, configured: false }
  return { supported: true, configured: await ensurePermission(handle), folderName: handle.name }
}

export async function saveLocalBackup(options: { archive?: boolean } = {}) {
  const snapshot = await readOperationalSnapshot()
  if (isTauriRuntime()) {
    const folder = readTauriBackupPath()
    return folder ? saveTauriBackup(folder, snapshot, Boolean(options.archive)) : false
  }
  const handle = await readDirectoryHandle()
  if (!handle || !(await ensurePermission(handle))) return false
  if (!snapshot) return false
  const content = JSON.stringify(snapshot, null, 2)
  const filenames = options.archive
    ? ['tokobahan-backup-latest.json', `tokobahan-backup-${timestampForFilename(new Date())}.json`]
    : ['tokobahan-backup-latest.json']
  for (const filename of filenames) {
    const file = await handle.getFileHandle(filename, { create: true })
    const writable = await file.createWritable()
    await writable.write(content)
    await writable.close()
  }
  try {
    window.localStorage.setItem(LOCAL_BACKUP_LAST_GENERATED_KEY, snapshot.generated_at)
  } catch {
    // The files are already safely written; localStorage is only the close-warning marker.
  }
  return true
}

export async function startTauriCloseGuard() {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const currentWindow = getCurrentWindow()
    let closeAllowed = false
    const unlisten = await currentWindow.onCloseRequested(async (event) => {
      if (closeAllowed) return
      event.preventDefault()
      try {
        if (!await saveLocalBackup({ archive: true })) {
          window.alert('Pilih folder backup HDD terlebih dahulu sebelum menutup aplikasi.')
          return
        }
        closeAllowed = true
        await currentWindow.close()
      } catch (error) {
        window.alert(`Backup gagal. Aplikasi belum ditutup. ${error instanceof Error ? error.message : ''}`)
      }
    })
    return unlisten
  } catch {
    // Running as a normal PWA/browser: native close events are unavailable.
    return () => undefined
  }
}

export function startAutomaticLocalBackup() {
  if (typeof window === 'undefined') return () => undefined
  let active = true
  let dailyTimer: number | undefined
  const scheduleDailyBackup = () => {
    if (!active) return
    const now = new Date()
    const next = new Date(now)
    next.setHours(DAILY_BACKUP_HOUR, 0, 0, 0)
    if (next <= now) next.setDate(next.getDate() + 1)
    dailyTimer = window.setTimeout(() => {
      void saveLocalBackup({ archive: true }).catch((error) => console.warn('Backup penuh harian gagal:', error))
      scheduleDailyBackup()
    }, next.getTime() - now.getTime())
  }
  scheduleDailyBackup()
  return () => {
    active = false
    if (dailyTimer !== undefined) window.clearTimeout(dailyTimer)
  }
}
