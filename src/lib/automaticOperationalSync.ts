import { toast } from 'sonner'
import { readOperationalSnapshot } from '@/lib/offlineOperationalSnapshot'
import { syncOperationalSnapshot } from '@/lib/offlineOperationalSync'

const SLOT_GRACE_PERIOD_MS = 5 * 60 * 1000
const RETRY_HOUR = 16
const RETRY_MINUTE = 15

function localDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function isMobileDevice() {
  if (typeof navigator === 'undefined') return false
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function getNextAutomaticSyncAt(now = new Date()) {
  const todayAt15 = new Date(now)
  todayAt15.setHours(15, 0, 0, 0)
  if (now <= todayAt15) return todayAt15

  const todayRetry = new Date(now)
  todayRetry.setHours(RETRY_HOUR, RETRY_MINUTE, 0, 0)
  if (now <= todayRetry) return todayRetry

  const tomorrowAt15 = new Date(todayAt15)
  tomorrowAt15.setDate(tomorrowAt15.getDate() + 1)
  return tomorrowAt15
}

export function startAutomaticOperationalSync() {
  if (typeof window === 'undefined' || isMobileDevice()) return () => undefined

  let active = true
  let timer: number | undefined

  const scheduleNextAttempt = (afterSlot?: Date) => {
    if (!active) return

    const now = new Date()
    let scheduledAt = getNextAutomaticSyncAt(now)
    if (afterSlot?.getHours() === 15) {
      const retryAt = new Date(afterSlot)
      retryAt.setHours(RETRY_HOUR, RETRY_MINUTE, 0, 0)
      if (
        localDateKey(now) === localDateKey(afterSlot) &&
        now.getTime() <= retryAt.getTime() + SLOT_GRACE_PERIOD_MS
      ) {
        scheduledAt = retryAt
      }
    } else if (afterSlot && scheduledAt <= afterSlot) {
      scheduledAt = new Date(afterSlot)
      scheduledAt.setDate(scheduledAt.getDate() + 1)
      scheduledAt.setHours(15, 0, 0, 0)
    }
    timer = window.setTimeout(() => {
      void runAttempt(scheduledAt).finally(() => scheduleNextAttempt(scheduledAt))
    }, Math.max(0, scheduledAt.getTime() - now.getTime()))
  }

  const runAttempt = async (scheduledAt: Date) => {
    if (!active) return

    const now = new Date()
    if (
      localDateKey(now) !== localDateKey(scheduledAt) ||
      now.getTime() - scheduledAt.getTime() > SLOT_GRACE_PERIOD_MS
    ) return

    try {
      if (!navigator.onLine) throw new Error('Perangkat tidak terhubung ke internet')

      const snapshot = await readOperationalSnapshot()
      if (!snapshot) return
      if (!snapshot.synced_generated_at || snapshot.synced_generated_at === snapshot.generated_at) return

      const result = await syncOperationalSnapshot()
      toast.success(`Berhasil dikirim ke server (${result.rowCount} baris)`)
    } catch (error) {
      console.error('Sinkronisasi otomatis gagal:', error)
      toast.error(`Sinkronisasi otomatis gagal: ${error instanceof Error ? error.message : 'Kesalahan tidak diketahui'}`)
    }
  }

  scheduleNextAttempt()
  return () => {
    active = false
    if (timer !== undefined) window.clearTimeout(timer)
  }
}
