import 'server-only'

import { createClient, type User } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { localSupabaseMfaGate } from './local-supabase-mfa-policy.mjs'
import type { OpsSession } from './ops-auth'
import { createServiceRoleClient } from './server-supabase'
import { getSupabasePublishableKey, getSupabaseUrl } from './supabase-config'

export const OPS_SUPABASE_ACCESS_COOKIE = 'drape_ops_supabase_access'
export const OPS_SUPABASE_REFRESH_COOKIE = 'drape_ops_supabase_refresh'
const MFA_MAX_AGE_SECONDS = 15 * 60

type AmrEntry = { method?: unknown; timestamp?: unknown }

export function isLocalSupabaseMfaEnabled() {
  return localSupabaseMfaGate(process.env).allowed
}

function publicClient(accessToken?: string) {
  const url = getSupabaseUrl()
  const key = getSupabasePublishableKey()
  if (!url || !key) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
  })
}

export function newestTotpTimestamp(amr: unknown): number | null {
  if (!Array.isArray(amr)) return null
  const timestamps = amr
    .filter((entry): entry is AmrEntry => Boolean(entry) && typeof entry === 'object')
    .filter((entry) => String(entry.method ?? '').toLowerCase() === 'totp')
    .map((entry) => Number(entry.timestamp))
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0)
  return timestamps.length > 0 ? Math.max(...timestamps) : null
}

function decodePayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1]
    return part ? JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown> : null
  } catch {
    return null
  }
}

export async function verifyLocalSupabaseMfaSession(nowSeconds = Math.floor(Date.now() / 1000)): Promise<OpsSession | null> {
  if (!isLocalSupabaseMfaEnabled()) return null
  const cookieStore = await cookies()
  const accessToken = cookieStore.get(OPS_SUPABASE_ACCESS_COOKIE)?.value
  if (!accessToken) return null
  const client = publicClient(accessToken)
  if (!client) return null

  // getUser performs a server round-trip and validates the token with Supabase.
  const [{ data: userData, error: userError }, { data: aalData, error: aalError }] = await Promise.all([
    client.auth.getUser(accessToken),
    client.auth.mfa.getAuthenticatorAssuranceLevel(accessToken),
  ])
  const user = userData.user
  if (userError || aalError || !user || aalData.currentLevel !== 'aal2') return null

  // Claims are decoded only after getUser/AAL verification and are cross-checked
  // against the verified user. Client-supplied identity headers are never read.
  const payload = decodePayload(accessToken)
  if (!payload || payload.sub !== user.id || payload.aal !== 'aal2') return null
  const mfaAt = newestTotpTimestamp(payload.amr)
  if (mfaAt == null || mfaAt > nowSeconds + 30 || nowSeconds - mfaAt > MFA_MAX_AGE_SECONDS) return null

  const service = createServiceRoleClient()
  if (!service) return null
  const { data: principal, error } = await service
    .from('ops_workforce_principals')
    .select('id,email,roles,status,permitted_environments,access_review_due_at')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  if (error || !principal || principal.status !== 'ACTIVE') return null
  if (!Array.isArray(principal.permitted_environments) || !principal.permitted_environments.includes('development')) return null
  if (!principal.access_review_due_at || new Date(principal.access_review_due_at).getTime() <= Date.now()) return null
  const roles = new Set((principal.roles ?? []).map((value: string) => value.toLowerCase()))
  const role = ['admin', 'engineering', 'finance', 'trust', 'customer_success', 'ops'].find((value) => roles.has(value))
  if (!role) return null

  return {
    allowed: true,
    mode: 'local-supabase-mfa',
    role: role as OpsSession['role'],
    principalId: principal.id,
    authUserId: user.id,
    email: String(principal.email).toLowerCase(),
    subject: `supabase:${user.id}`,
    audiences: ['authenticated'],
    authenticationMethods: ['totp'],
    authenticatedAt: mfaAt,
    expiresAt: typeof payload.exp === 'number' ? payload.exp : null,
    mfaVerified: true,
    accessKeyState: 'not-applicable',
    accessKeyAgeMs: null,
  }
}

export function createLocalSupabaseAuthClient(accessToken?: string) {
  if (!isLocalSupabaseMfaEnabled()) return null
  return publicClient(accessToken)
}

export async function localSupabaseUser(accessToken: string): Promise<User | null> {
  const client = publicClient(accessToken)
  if (!client) return null
  const { data, error } = await client.auth.getUser(accessToken)
  return error ? null : data.user
}
