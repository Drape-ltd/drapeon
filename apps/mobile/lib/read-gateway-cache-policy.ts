/** Never revive a marketplace response after its original safety freshness window. */
export function canUseCachedFallback(expiresAt: number, now: number): boolean {
  return Number.isFinite(expiresAt) && expiresAt > now
}
