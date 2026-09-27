export interface CachedAuthSession<TUser extends { id: string }> {
  user: TUser
  expiresAt: number | null
}

export function isOfflineAuthSessionValid<TUser extends { id: string }>(
  cached: CachedAuthSession<TUser> | null,
  nowMs = Date.now(),
): boolean {
  return Boolean(
    cached?.user?.id
    && typeof cached.expiresAt === 'number'
    && Number.isFinite(cached.expiresAt)
    && cached.expiresAt * 1000 > nowMs,
  )
}
