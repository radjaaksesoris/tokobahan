export interface CachedAuthSession<TUser extends { id: string }> {
  user: TUser
  expiresAt: number | null
  offlineExpiresAt?: number | null
}

export function isOfflineAuthSessionValid<TUser extends { id: string }>(
  cached: CachedAuthSession<TUser> | null,
  nowMs = Date.now(),
): boolean {
  return Boolean(
    cached?.user?.id &&
    (() => {
      const expiresAt = typeof cached.offlineExpiresAt === 'number'
        ? cached.offlineExpiresAt
        : cached.expiresAt
      return typeof expiresAt === 'number' && Number.isFinite(expiresAt) && expiresAt * 1000 > nowMs
    })(),
  )
}
