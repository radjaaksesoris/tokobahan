import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { readOperationalSnapshot, syncOperationalSnapshot, toast } = vi.hoisted(() => ({
  readOperationalSnapshot: vi.fn(),
  syncOperationalSnapshot: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('@/lib/offlineOperationalSnapshot', () => ({ readOperationalSnapshot }))
vi.mock('@/lib/offlineOperationalSync', () => ({ syncOperationalSnapshot }))
vi.mock('sonner', () => ({ toast }))

import { getNextAutomaticSyncAt, startAutomaticOperationalSync } from './automaticOperationalSync'

function createStorage() {
  const entries = new Map<string, string>()
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
    clear: () => entries.clear(),
    key: (index: number) => Array.from(entries.keys())[index] ?? null,
    get length() { return entries.size },
  }
}

describe('automatic operational sync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 30, 14, 59, 0))
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      localStorage: createStorage(),
    })
    vi.stubGlobal('navigator', { onLine: true })
    vi.clearAllMocks()
    readOperationalSnapshot.mockResolvedValue({
      generated_at: 'local-change',
      synced_generated_at: 'previous-sync',
    })
    syncOperationalSnapshot.mockResolvedValue({ rowCount: 4 })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('schedules today at 15:00, then 16:00, then tomorrow after both slots', () => {
    expect(getNextAutomaticSyncAt(new Date(2026, 9, 30, 14, 30))).toEqual(new Date(2026, 9, 30, 15, 0))
    expect(getNextAutomaticSyncAt(new Date(2026, 9, 30, 15, 30))).toEqual(new Date(2026, 9, 30, 16, 0))
    expect(getNextAutomaticSyncAt(new Date(2026, 9, 30, 16, 1))).toEqual(new Date(2026, 9, 31, 15, 0))
  })

  it('does not retry at 16:00 after the 15:00 sync succeeds', async () => {
    const stop = startAutomaticOperationalSync()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(syncOperationalSnapshot).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith('Berhasil dikirim ke server (4 baris)')

    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(syncOperationalSnapshot).toHaveBeenCalledTimes(1)

    stop()
  })

  it('retries a failed 15:00 sync at 16:00', async () => {
    syncOperationalSnapshot
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({ rowCount: 4 })
    const stop = startAutomaticOperationalSync()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(syncOperationalSnapshot).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(syncOperationalSnapshot).toHaveBeenCalledTimes(2)
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith('Berhasil dikirim ke server (4 baris)')

    stop()
  })

  it('tries again the next day after both daily attempts fail', async () => {
    syncOperationalSnapshot
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({ rowCount: 4 })
    const stop = startAutomaticOperationalSync()

    await vi.advanceTimersByTimeAsync(60_000)
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(syncOperationalSnapshot).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(23 * 60 * 60_000)
    expect(syncOperationalSnapshot).toHaveBeenCalledTimes(3)

    stop()
  })

  it('does not send a snapshot without unsynchronized local changes', async () => {
    readOperationalSnapshot.mockResolvedValue({
      generated_at: 'same-version',
      synced_generated_at: 'same-version',
    })
    const stop = startAutomaticOperationalSync()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(syncOperationalSnapshot).not.toHaveBeenCalled()

    stop()
  })

  it('does not schedule or send automatic sync on mobile devices', async () => {
    vi.stubGlobal('navigator', {
      onLine: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile',
      platform: 'iPhone',
      maxTouchPoints: 5,
    })
    const stop = startAutomaticOperationalSync()

    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000)
    expect(syncOperationalSnapshot).not.toHaveBeenCalled()

    stop()
  })
})
