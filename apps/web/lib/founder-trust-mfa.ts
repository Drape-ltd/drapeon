import 'server-only'

import { createClient } from '@supabase/supabase-js'
import type { OpsSession } from './ops-auth'
import { createServiceRoleClient } from './server-supabase'
import { PRODUCTION_SUPABASE_PROJECT_REF, getSupabaseProjectRef } from './supabase-environment'
import { getSupabasePublishableKey, getSupabaseUrl } from './supabase-config'

export const FOUNDER_TRUST_ACCESS_COOKIE = 'drape_ops_founder_trust_access'
export const FOUNDER_TRUST_REFRESH_COOKIE = 'drape_ops_founder_trust_refresh'
export const FOUNDER_TRUST_EMAIL = 'founders@drapeon.co'
export const FOUNDER_TRUST_MFA_MAX_AGE_SECONDS = 15 * 60

export type FounderTrustMfaProof = {
  authUserId: string
  authenticatedAt: number
  fallbackExpiresAt: number
}

type AmrEntry = { method?: unknown; timestamp?: unknown }

type FallbackBinding = {
  principal_id: string
  auth_user_id: string
  enabled_at: string
  expires_at: string
}

function decodePayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1]
    return part
      ? JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function newestTotpTimestamp(amr: unknown): number | null {
  if (!Array.isArray(amr)) return null
  const timestamps = amr
    .filter((entry): entry is AmrEntry => Boolean(entry) && typeof entry === 'object')
    .filter((entry) => String(entry.method ?? '').toLowerCase() === 'totp')
    .map((entry) => Number(entry.timestamp))
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0)
  return timestamps.length > 0 ? Math.max(...timestamps) : null
}

export function isFounderTrustMfaRuntime() {
  const productionRuntime = process.env.NODE_ENV === 'production'
    && (process.env.DRAPE_OPS_ENV ?? 'production').trim().toLowerCase() === 'production'
  return productionRuntime
    && getSupabaseProjectRef(getSupabaseUrl()) === PRODUCTION_SUPABASE_PROJECT_REF
}

function publicClient(accessToken?: string) {
  if (!isFounderTrustMfaRuntime()) return null
  const url = getSupabaseUrl()
  const key = getSupabasePublishableKey()
  if (!url || !key) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
  })
}

export function createFounderTrustAuthClient(accessToken?: string) {
  return publicClient(accessToken)
}

export async function getFounderTrustFallbackBinding(): Promise<FallbackBinding | null> {
  if (!isFounderTrustMfaRuntime()) return null
  const service = createServiceRoleClient()
  if (!service) return null
  const { data, error } = await service
    .from('ops_founder_trust_mfa_fallback')
    .select('principal_id,auth_user_id,enabled_at,expires_at')
    .eq('singleton', true)
    .eq('enabled', true)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  return error || !data ? null : data as FallbackBinding
}

export async function verifyFounderTrustMfaProof(
  workforceSession: OpsSession,
  accessToken: string | null | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<FounderTrustMfaProof | null> {
  if (
    !isFounderTrustMfaRuntime()
    || !accessToken
    || workforceSession.mode !== 'cloudflare-access'
    || workforceSession.role !== 'admin'
    || workforceSession.email !== FOUNDER_TRUST_EMAIL
    || !workforceSession.principalId
  ) return null

  const client = publicClient(accessToken)
  if (!client) return null
  const [{ data: userData, error: userError }, { data: aalData, error: aalError }, binding] = await Promise.all([
    client.auth.getUser(accessToken),
    client.auth.mfa.getAuthenticatorAssuranceLevel(accessToken),
    getFounderTrustFallbackBinding(),
  ])
  const user = userData.user
  if (
    userError
    || aalError
    || !user
    || !binding
    || aalData.currentLevel !== 'aal2'
    || user.email?.trim().toLowerCase() !== FOUNDER_TRUST_EMAIL
    || user.id !== binding.auth_user_id
    || workforceSession.principalId !== binding.principal_id
  ) return null

  // Decode claims only after Supabase validates the token and its AAL. The
  // signed subject is cross-checked against the exact bound Auth user.
  const payload = decodePayload(accessToken)
  if (!payload || payload.sub !== user.id || payload.aal !== 'aal2') return null
  const mfaAt = newestTotpTimestamp(payload.amr)
  const enabledAt = Math.floor(Date.parse(binding.enabled_at) / 1000)
  const fallbackExpiresAt = Math.floor(Date.parse(binding.expires_at) / 1000)
  if (
    mfaAt == null
    || !Number.isFinite(enabledAt)
    || !Number.isFinite(fallbackExpiresAt)
    || mfaAt < enabledAt
    || mfaAt > nowSeconds + 30
    || nowSeconds - mfaAt > FOUNDER_TRUST_MFA_MAX_AGE_SECONDS
    || fallbackExpiresAt <= nowSeconds
  ) return null

  return { authUserId: user.id, authenticatedAt: mfaAt, fallbackExpiresAt }
}

export async function recordFounderTrustMfaEvent(input: {
  workforceSession: OpsSession
  authUserId: string
  eventType: 'SIGN_IN_ATTEMPTED' | 'TOTP_ENROLLMENT_STARTED' | 'TOTP_VERIFICATION_ATTEMPTED' | 'TRUST_EVIDENCE_SERVED'
  outcome: 'SUCCEEDED' | 'FAILED'
  correlationId: string
  mfaAuthenticatedAt?: number | null
  issueId?: string | null
  reasonCode?: string | null
}) {
  const binding = await getFounderTrustFallbackBinding()
  const service = createServiceRoleClient()
  if (
    !binding
    || !service
    || input.workforceSession.principalId !== binding.principal_id
    || input.authUserId !== binding.auth_user_id
  ) return false
  const { error } = await service.from('ops_founder_trust_mfa_events').insert({
    principal_id: binding.principal_id,
    auth_user_id: binding.auth_user_id,
    issue_id: input.issueId ?? null,
    event_type: input.eventType,
    outcome: input.outcome,
    reason_code: input.reasonCode ?? null,
    correlation_id: input.correlationId,
    mfa_authenticated_at: input.mfaAuthenticatedAt
      ? new Date(input.mfaAuthenticatedAt * 1000).toISOString()
      : null,
    fallback_expires_at: binding.expires_at,
  })
  return !error
}
