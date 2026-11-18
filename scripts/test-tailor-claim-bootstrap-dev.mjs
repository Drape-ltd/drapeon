#!/usr/bin/env node

import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { createClient } = webRequire('@supabase/supabase-js')

const PROJECT_REF = 'pqptfuqogvrajozfsqzi'
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
if (!url?.includes(PROJECT_REF) || !serviceKey || !anonKey) {
  throw new Error('Load the development Supabase URL, service key, and anon key before running this proof.')
}
if (process.env.ALLOW_DEV_CLAIM_HMAC_ROTATION !== '1') {
  throw new Error('Set ALLOW_DEV_CLAIM_HMAC_ROTATION=1 to acknowledge that this dev proof invalidates pending dev claim-email codes.')
}

const linkedRef = readFileSync(new URL('../supabase/.temp/project-ref', import.meta.url), 'utf8').trim()
if (linkedRef !== PROJECT_REF) throw new Error(`Refusing non-development project ${linkedRef || '(unlinked)'}.`)

const hmacKey = randomBytes(48).toString('base64url')
const secretResult = spawnSync('supabase', ['secrets', 'set', `TAILOR_CLAIM_HMAC_KEY=${hmacKey}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
  encoding: 'utf8',
})
if (secretResult.status !== 0) throw new Error(`Could not rotate the development claim HMAC key: ${secretResult.stderr}`)

const serviceHeaders = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
}
const anonHeaders = { apikey: anonKey, 'Content-Type': 'application/json' }
const token = randomBytes(32).toString('base64url')
const tokenHash = createHash('sha256').update(token).digest('base64url')
const email = `claim-inert-${randomUUID()}@example.invalid`
const code = '246810'
const emailHash = createHmac('sha256', hmacKey).update(`email:${email}`).digest('base64url')
const codeHash = createHmac('sha256', hmacKey).update(`code:${tokenHash}:${emailHash}:${code}`).digest('base64url')
const userId = randomUUID()
const providerMode = process.env.CLAIM_BOOTSTRAP_MODE === 'provider'
let createdUser = false

async function request(path, init = {}) {
  const response = await fetch(`${url}${path}`, init)
  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { response, body }
}

async function rest(path, init = {}) {
  return request(`/rest/v1/${path}`, { ...init, headers: { ...serviceHeaders, ...(init.headers ?? {}) } })
}

try {
  const created = await request('/auth/v1/admin/users', {
    method: 'POST',
    headers: serviceHeaders,
    body: JSON.stringify({
      id: userId,
      email: `draft+${userId}@claim.drapeon.invalid`,
      email_confirm: false,
      ban_duration: '876000h',
      app_metadata: { role: 'TAILOR', account_origin: 'STAFF_DRAFT' },
      user_metadata: { role: 'TAILOR', account_origin: 'STAFF_DRAFT', display_name: 'Inert JWT proof' },
    }),
  })
  if (!created.response.ok) throw new Error(`Auth fixture failed (${created.response.status}).`)
  createdUser = true

  const principals = await rest('ops_workforce_principals?select=id&revoked_at=is.null&limit=1')
  const principalId = Array.isArray(principals.body) ? principals.body[0]?.id : null
  if (!principalId) throw new Error('No active development Ops principal is available for the invite fixture.')

  const profile = await rest('tailor_profiles?select=id', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      user_id: userId,
      display_name: 'Inert JWT proof',
      business_name: 'Inert JWT proof',
      bio: 'Development-only security proof profile that is never visible or live.',
      location: 'Development',
      languages: ['English'],
      specialty_tags: ['OTHER'],
      price_range_min: 1000,
      price_range_max: 2000,
      currency: 'USD',
      is_live: false,
      is_verified: false,
      lifecycle_state: 'OPENED',
    }),
  })
  const profileId = Array.isArray(profile.body) ? profile.body[0]?.id : null
  if (!profile.response.ok || !profileId) throw new Error(`Profile fixture failed (${profile.response.status}).`)

  const inviteId = randomUUID()
  const invite = await rest('tailor_claim_invites', {
    method: 'POST',
    body: JSON.stringify({
      id: inviteId,
      tailor_user_id: userId,
      tailor_profile_id: profileId,
      token_hash: tokenHash,
      status: 'OPENED',
      expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      created_by_principal: principalId,
      correlation_id: randomUUID(),
      opened_at: new Date().toISOString(),
    }),
  })
  if (!invite.response.ok) throw new Error(`Invite fixture failed (${invite.response.status}).`)

  const path = await rest('tailor_claim_email_paths', {
    method: 'POST',
    body: JSON.stringify({ invite_id: inviteId }),
  })
  if (!path.response.ok) throw new Error(`Email-path fixture failed (${path.response.status}).`)
  const verification = await rest('tailor_claim_email_codes', {
    method: 'POST',
    body: JSON.stringify({
      invite_id: inviteId,
      email_hash: emailHash,
      code_hash: codeHash,
      status: 'VERIFIED',
      attempts: 0,
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      verified_at: new Date().toISOString(),
    }),
  })
  if (!verification.response.ok) throw new Error(`Verification fixture failed (${verification.response.status}).`)

  const bootstrap = await request('/functions/v1/tailor-claim-action', {
    method: 'POST',
    headers: anonHeaders,
    body: JSON.stringify(providerMode
      ? { action: 'BOOTSTRAP_PROVIDER_SESSION', token, provider: 'google' }
      : { action: 'BOOTSTRAP_EMAIL_SESSION', token, email, code }),
  })
  const accessToken = bootstrap.body?.session?.accessToken
  const refreshToken = bootstrap.body?.session?.refreshToken
  const claimSessionId = bootstrap.body?.session?.claimSessionId
  if (!bootstrap.response.ok || bootstrap.body?.bootstrapped !== true || !accessToken || !refreshToken || !claimSessionId) {
    throw new Error(`Bootstrap action failed (${bootstrap.response.status}): ${JSON.stringify(bootstrap.body)}`)
  }

  const jwtHeaders = { apikey: anonKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
  const providerMismatch = providerMode
    ? await request('/functions/v1/tailor-claim-action', {
        method: 'POST', headers: jwtHeaders,
        body: JSON.stringify({ action: 'VERIFY_LINKED_PROVIDER', token, provider: 'google', identityId: randomUUID() }),
      })
    : null
  const customerTable = await request('/rest/v1/customer_profiles?select=id&limit=1', { headers: jwtHeaders })
  const tailorTable = await request('/rest/v1/tailor_profiles?select=id&limit=1', { headers: jwtHeaders })
  const pushRpc = await request('/rest/v1/rpc/register_push_token', {
    method: 'POST', headers: jwtHeaders,
    body: JSON.stringify({ p_token: `denied-${randomUUID()}`, p_platform: 'ios', p_device_id: `denied-${randomUUID()}` }),
  })
  const marketingRpc = await request('/rest/v1/rpc/set_my_marketing_topic_preference', {
    method: 'POST', headers: jwtHeaders,
    body: JSON.stringify({ p_topic_key: 'LAUNCH_EVENTS', p_channel: 'EMAIL', p_enabled: false, p_source: 'ACCOUNT_SETTINGS' }),
  })
  const view = await request('/rest/v1/drape_vision_ground_truth_comparison?select=*&limit=1', { headers: jwtHeaders })
  const graphQl = await request('/graphql/v1', {
    method: 'POST', headers: jwtHeaders,
    body: JSON.stringify({ query: 'query StaffDraftBoundaryProof { __typename }' }),
  })
  const storage = await request('/storage/v1/object/list/avatars', {
    method: 'POST', headers: jwtHeaders, body: JSON.stringify({ limit: 1, prefix: '' }),
  })
  const support = await request('/functions/v1/account-support-action', {
    method: 'POST', headers: jwtHeaders,
    body: JSON.stringify({ action: 'submit-support', category: 'GENERAL', subject: 'Denied proof', description: 'This request must be denied.' }),
  })
  const portfolio = await request('/functions/v1/portfolio-item-action', {
    method: 'POST', headers: jwtHeaders,
    body: JSON.stringify({ action: 'reorder-items', itemIds: [randomUUID()] }),
  })

  const realtimeClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  realtimeClient.realtime.setAuth(accessToken)
  const realtimeTopic = `private:tailor-claim-denial-${randomUUID()}`
  const realtimeChannel = realtimeClient.channel(realtimeTopic, { config: { private: true } })
  const realtimeStatus = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Realtime private-channel denial timed out.')), 12_000)
    realtimeChannel.subscribe((status) => {
      if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
        clearTimeout(timer)
        resolve(status)
      }
    })
  }).finally(async () => {
    await realtimeClient.removeChannel(realtimeChannel)
  })

  const customerDenied = customerTable.response.status === 403
  const tailorDenied = tailorTable.response.status === 403
  const pushRpcDenied = pushRpc.response.status === 403
  const marketingRpcDenied = marketingRpc.response.status === 403
  const viewDenied = view.response.status === 403
  const graphQlDenied = graphQl.response.status === 403
  const realtimeDenied = realtimeStatus === 'CHANNEL_ERROR'
  const providerMismatchDenied = !providerMismatch || providerMismatch.response.status === 409
  const storageDenied = storage.response.status === 400 || storage.response.status === 403 || (Array.isArray(storage.body) && storage.body.length === 0)
  const supportDenied = support.response.status === 401
  const portfolioDenied = portfolio.response.status === 401
  if (![customerDenied, tailorDenied, pushRpcDenied, marketingRpcDenied, viewDenied, graphQlDenied, realtimeDenied, providerMismatchDenied, storageDenied, supportDenied, portfolioDenied].every(Boolean)) {
    throw new Error(`Inert denial failed: ${JSON.stringify({
      customer: customerTable.response.status,
      customerRows: Array.isArray(customerTable.body) ? customerTable.body.length : null,
      tailor: tailorTable.response.status,
      pushRpc: pushRpc.response.status,
      marketingRpc: marketingRpc.response.status,
      view: view.response.status,
      graphQl: graphQl.response.status,
      realtime: realtimeStatus,
      providerMismatch: providerMismatch?.response.status ?? null,
      storage: storage.response.status,
      support: support.response.status,
      portfolio: portfolio.response.status,
    })}`)
  }

  const expired = await rest(`tailor_claim_bootstrap_sessions?id=eq.${claimSessionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ expires_at: new Date(Date.now() - 60_000).toISOString() }),
  })
  if (!expired.response.ok) throw new Error(`Could not expire bootstrap fixture (${expired.response.status}).`)
  const refreshedAfterExpiry = await request('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST', headers: anonHeaders, body: JSON.stringify({ refresh_token: refreshToken }),
  })
  const refreshedAccessToken = refreshedAfterExpiry.body?.access_token
  const refreshedRefreshToken = refreshedAfterExpiry.body?.refresh_token
  if (!refreshedAfterExpiry.response.ok || !refreshedAccessToken || !refreshedRefreshToken) {
    throw new Error(`Could not mint the expiry-boundary JWT fixture (${refreshedAfterExpiry.response.status}).`)
  }
  const expiredJwtClaimAction = await request('/functions/v1/tailor-claim-action', {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${refreshedAccessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'VERIFY_LINKED_PROVIDER', token, provider: 'google' }),
  })
  if (expiredJwtClaimAction.response.status !== 401
      || expiredJwtClaimAction.body?.error !== 'CLAIM_SESSION_EXPIRED') {
    throw new Error(`Refreshed JWT crossed the 10-minute claim boundary: ${JSON.stringify(expiredJwtClaimAction.body)}`)
  }
  const reaped = await rest('rpc/reap_expired_tailor_claim_bootstrap_sessions', {
    method: 'POST',
    body: JSON.stringify({ p_limit: 1 }),
  })
  const reapedRow = Array.isArray(reaped.body) ? reaped.body.find((row) => row.bootstrap_session_id === claimSessionId) : null
  if (!reaped.response.ok || !reapedRow || reapedRow.auth_sessions_revoked < 1) {
    throw new Error(`Expired bootstrap fixture was not reaped: ${JSON.stringify(reaped.body)}`)
  }
  const authUser = await request(`/auth/v1/admin/users/${userId}`, { headers: serviceHeaders })
  const bannedUntil = authUser.body?.banned_until ? Date.parse(authUser.body.banned_until) : 0
  const refresh = await request('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST', headers: anonHeaders, body: JSON.stringify({ refresh_token: refreshedRefreshToken }),
  })
  if (!authUser.response.ok || bannedUntil < Date.now() + 99 * 365 * 24 * 60 * 60_000 || refresh.response.ok) {
    throw new Error(`Expired bootstrap re-lock proof failed: ${JSON.stringify({ authStatus: authUser.response.status, bannedUntil: authUser.body?.banned_until, refreshStatus: refresh.response.status })}`)
  }

  console.log(JSON.stringify({
    result: providerMode ? 'tailor_claim_provider_bootstrap_passed' : 'tailor_claim_inert_jwt_passed',
    bootstrapSessionId: bootstrap.body?.session?.claimSessionId ?? null,
    denials: {
      customerTable: `PRE_REQUEST_DENIED_${customerTable.response.status}`,
      tailorTable: `PRE_REQUEST_DENIED_${tailorTable.response.status}`,
      securityDefinerRpcRegisterPushToken: `PRE_REQUEST_DENIED_${pushRpc.response.status}`,
      securityDefinerRpcMarketingPreference: `PRE_REQUEST_DENIED_${marketingRpc.response.status}`,
      view: `PRE_REQUEST_DENIED_${view.response.status}`,
      graphQl: `PRE_REQUEST_DENIED_${graphQl.response.status}`,
      realtimePrivateChannel: realtimeStatus,
      providerIdentityMismatch: providerMismatch ? `DENIED_${providerMismatch.response.status}` : 'NOT_RUN',
      storage: Array.isArray(storage.body) && storage.body.length === 0 ? 'RLS_EMPTY' : `DENIED_${storage.response.status}`,
      accountSupportAction: `DENIED_${support.response.status}`,
      portfolioItemAction: `DENIED_${portfolio.response.status}`,
    },
    expiredFixture: {
      bootstrapSessionId: claimSessionId,
      authSessionsRevoked: reapedRow.auth_sessions_revoked,
      placeholderRebanned: true,
      refreshTokenRevoked: true,
      refreshedJwtRejectedAfterExpiry: true,
    },
  }))
} finally {
  if (createdUser) {
    await request(`/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: serviceHeaders })
  }
}
