import { describe, expect, it } from 'vitest'
import { isOfflineAuthSessionValid } from './offlineAuth'

const nowMs = 1_800_000_000_000

describe('offline auth session expiry', () => {
  it('accepts a cached session that has not expired', () => {
    expect(isOfflineAuthSessionValid({
      user: { id: 'admin-1' },
      expiresAt: nowMs / 1000 + 60,
    }, nowMs)).toBe(true)
  })

  it.each([
    ['missing cache', null],
    ['missing expiry', { user: { id: 'admin-1' }, expiresAt: null }],
    ['invalid expiry', { user: { id: 'admin-1' }, expiresAt: Number.NaN }],
    ['expired expiry', { user: { id: 'admin-1' }, expiresAt: nowMs / 1000 }],
  ])('rejects a cached session with %s', (_description, cached) => {
    expect(isOfflineAuthSessionValid(cached, nowMs)).toBe(false)
  })
})
