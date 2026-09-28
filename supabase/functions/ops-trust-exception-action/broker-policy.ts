// Supabase's verify_jwt gateway verifies the signature before invocation.
// This additionally binds that verified credential to the exact project/role,
// matching the existing ops-trust-action broker contract across key rotation.
export function hasVerifiedProjectBroker(request: Request, projectRef: string, now = Math.floor(Date.now() / 1000)): boolean {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/iu, '').trim() ?? ''
  if (token !== request.headers.get('apikey')?.trim()) return false
  const [header, payload, signature, extra] = token.split('.')
  if (!header || !payload || !signature || extra) return false
  try {
    const normalized = payload.replaceAll('-', '+').replaceAll('_', '/')
    const claims = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')))
    return claims.role === 'service_role' && claims.ref === projectRef &&
      typeof claims.iat === 'number' && Number.isFinite(claims.iat) && claims.iat <= now + 30 &&
      typeof claims.exp === 'number' && Number.isFinite(claims.exp) && claims.exp > now
  } catch { return false }
}
