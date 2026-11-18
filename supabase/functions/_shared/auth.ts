import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getServiceRoleKey, getSupabaseUrl } from './env.ts'

function jwtStringClaim(token: string, name: string): string | null {
  try {
    const payload = token.split('.')[1]?.replaceAll('-', '+').replaceAll('_', '/') ?? ''
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=')
    const claims = JSON.parse(atob(padded)) as Record<string, unknown>
    return typeof claims[name] === 'string' ? claims[name] as string : null
  } catch {
    return null
  }
}

/**
 * Validates the caller's JWT from the Authorization header and returns
 * the authenticated user. Returns null if the token is absent or invalid.
 */
export async function getAuthUser(
  req: Request,
): Promise<{ id: string; email?: string } | null> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice('Bearer '.length).trim()
  if (!token) return null

  const supabase = createClient(getSupabaseUrl(), getServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user?.id) {
    console.error('[getAuthUser] auth API error:', error?.message ?? 'unknown')
    return null
  }

  // Placeholder identities may hold a short-lived session only so the claim
  // coordinator can attach a verified provider. They are deliberately inert
  // on every normal Edge action, even while Auth considers the JWT valid.
  if (data.user.app_metadata?.account_origin === 'STAFF_DRAFT') {
    console.warn('[getAuthUser] blocked STAFF_DRAFT claim session')
    return null
  }

  return { id: data.user.id, email: data.user.email }
}

export async function getActiveStaffDraftClaimSession(
  req: Request,
  options: { allowSessionRebind?: boolean } = {},
): Promise<{ userId: string; claimSessionId: string; authSessionId: string } | null> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice('Bearer '.length).trim()
  if (!token) return null

  const supabase = createClient(getSupabaseUrl(), getServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase.auth.getUser(token)
  const user = data.user
  const claimSessionId = typeof user?.app_metadata?.claim_session_id === 'string'
    ? user.app_metadata.claim_session_id
    : ''
  const authSessionId = jwtStringClaim(token, 'session_id')
  if (error || !user?.id || user.app_metadata?.account_origin !== 'STAFF_DRAFT'
      || !claimSessionId || !authSessionId) {
    return null
  }

  let { data: active, error: activeError } = await supabase
    .from('tailor_claim_bootstrap_sessions')
    .select('id,auth_session_id')
    .eq('id', claimSessionId)
    .eq('user_id', user.id)
    .eq('status', 'ACTIVE')
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  if (
    !activeError &&
    active?.id &&
    active.auth_session_id !== authSessionId &&
    options.allowSessionRebind === true
  ) {
    const rebound = await supabase
      .from('tailor_claim_bootstrap_sessions')
      .update({ auth_session_id: authSessionId, updated_at: new Date().toISOString() })
      .eq('id', claimSessionId)
      .eq('user_id', user.id)
      .eq('auth_session_id', active.auth_session_id)
      .eq('status', 'ACTIVE')
      .gt('expires_at', new Date().toISOString())
      .select('id,auth_session_id')
      .maybeSingle()
    active = rebound.data
    activeError = rebound.error
  }
  if (activeError || !active?.id || active.auth_session_id !== authSessionId) return null
  return { userId: user.id, claimSessionId, authSessionId }
}
