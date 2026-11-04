import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))

import {
  assertRefreshCanReplaceLocalSnapshot,
  hasUnsyncedLocalChanges,
} from './offlineOperationalBootstrap'

describe('operational server refresh safety', () => {
  it('treats a server snapshot with no local sync marker as unchanged', () => {
    expect(hasUnsyncedLocalChanges({ generated_at: 'server-snapshot' })).toBe(false)
  })

  it('allows refreshing a snapshot that is already synchronized', () => {
    expect(hasUnsyncedLocalChanges({
      generated_at: 'snapshot-1',
      synced_generated_at: 'snapshot-1',
    })).toBe(false)
  })

  it('blocks refreshing while local changes are not synchronized', () => {
    expect(hasUnsyncedLocalChanges({
      generated_at: 'local-changes',
      synced_generated_at: 'previous-server-snapshot',
    })).toBe(true)
  })

  it('allows an explicitly confirmed refresh to replace unsynchronized data when its backup matches', () => {
    expect(() => assertRefreshCanReplaceLocalSnapshot({
      generated_at: 'local-changes',
      synced_generated_at: 'previous-server-snapshot',
    }, {
      replaceUnsyncedLocalChanges: true,
      expectedLocalGeneratedAt: 'local-changes',
    })).not.toThrow()
  })

  it('keeps unsynchronized local data when refresh was not explicitly authorized', () => {
    expect(() => assertRefreshCanReplaceLocalSnapshot({
      generated_at: 'local-changes',
      synced_generated_at: 'previous-server-snapshot',
    })).toThrow('Sinkronkan data lokal')
  })

  it('does not replace local data if it changed after the backup was downloaded', () => {
    expect(() => assertRefreshCanReplaceLocalSnapshot({
      generated_at: 'newer-local-changes',
      synced_generated_at: 'previous-server-snapshot',
    }, {
      replaceUnsyncedLocalChanges: true,
      expectedLocalGeneratedAt: 'backup-snapshot',
    })).toThrow('Data lokal berubah setelah backup dibuat')
  })
})
