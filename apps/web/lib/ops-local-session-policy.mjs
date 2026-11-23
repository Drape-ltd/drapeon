export function localOpsSessionReason(accessMode, hasSession, dataAvailable) {
  if (accessMode !== 'local-supabase-mfa') return null
  if (!hasSession) return 'session-expired'
  if (!dataAvailable) return 'data-unavailable'
  return null
}
