import { describe, expect, it } from 'vitest'
import { hasUnsyncedLocalChanges } from './offlineOperationalBootstrap'

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
})
