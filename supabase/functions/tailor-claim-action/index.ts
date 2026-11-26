import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseAnonKey, getSupabaseUrl } from '../_shared/env.ts'
import { getClientIp, rateLimit } from '../_shared/rateLimit.ts'
import { audit } from '../_shared/logger.ts'
import {
  normalizeDrapeonSender,
  renderDrapeonTransactionalEmail,
} from '../_shared/email-template.ts'
import { getActiveStaffDraftClaimSession, getAuthUser } from '../_shared/auth.ts'
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@6.1.2'
import {
  normalizePhoneForStorage,
  validatePhoneForProfile,
} from '../../../packages/shared/src/phone.ts'
import { validateTailorDraftFields } from '../_shared/tailor-draft-profile.ts'
import { claimPickupPostcodeValid } from '../../../packages/shared/src/claim-pickup-postcode.ts'
import { deviceTrustExpiry } from '../../../packages/shared/src/device-trust.ts'
import { verifiedProviderEmail } from './provider-email-proof.mjs'
import { publicClaimMediaObject, terminalFinalizeFailure } from './finalize-recovery.mjs'

const FN = 'tailor-claim-action'
const tokenPattern = /^[A-Za-z0-9_-]{40,60}$/u
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u
const codePattern = /^\d{6}$/u
const encoder = new TextEncoder()
const appleJwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'))
const googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))
const DEVELOPMENT_CLAIM_TEST_PROJECT_URL = 'https://pqptfuqogvrajozfsqzi.supabase.co'

/**
 * Opt-in interruption-test hook. A copied secret is inert outside the exact
 * Development project, so this can never delay a production finalize.
 */
function developmentFinalizeTestDelayMs() {
  if (getSupabaseUrl() !== DEVELOPMENT_CLAIM_TEST_PROJECT_URL) return 0
  const rawDelay = Deno.env.get('TAILOR_CLAIM_FINALIZE_TEST_DELAY_MS')
  if (!rawDelay || !/^\d+$/u.test(rawDelay)) return 0
  const requestedDelay = Number(rawDelay)
  if (!Number.isSafeInteger(requestedDelay) || requestedDelay <= 0) return 0
  return Math.min(requestedDelay, 30_000)
}

function base64url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')
}

async function tokenHash(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return base64url(new Uint8Array(digest))
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function randomNonce() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return base64url(bytes)
}

function claimCompletionFailure(error: { code?: string; hint?: string } | null) {
  const byCode: Record<string, string> = {
    P1001: 'PHONE_ALREADY_IN_USE',
    P1002: 'ACCOUNT_CONFLICT',
    P1003: 'CLAIM_STATE_CHANGED',
    P1004: 'CLAIM_RECEIPT_FAILED',
    P1005: 'CLAIM_RECEIPT_MISSING',
    P1006: 'CLAIM_EMAIL_INVALID',
    P1007: 'INVALID_PHONE',
  }
  const codeResult = error?.code ? byCode[error.code] : null
  if (codeResult) return codeResult
  return typeof error?.hint === 'string' && /^[A-Z][A-Z0-9_]{2,79}$/u.test(error.hint)
    ? error.hint
    : null
}

async function verifyProviderToken(provider: 'apple' | 'google', idToken: string, nonce: string) {
  const audiences =
    provider === 'apple'
      ? [Deno.env.get('APPLE_CLIENT_ID') ?? Deno.env.get('APPLE_SIGN_IN_CLIENT_ID')]
      : (Deno.env.get('GOOGLE_CLIENT_IDS') ?? Deno.env.get('GOOGLE_CLIENT_ID') ?? '').split(',')
  const audience = [...new Set(audiences.map((value) => value?.trim()).filter(Boolean))] as string[]
  if (audience.length === 0) throw new Error('PROVIDER_CONFIGURATION_MISSING')
  const nonceDigest = await sha256Hex(nonce)
  const { payload } = await jwtVerify(idToken, provider === 'apple' ? appleJwks : googleJwks, {
    audience,
    issuer:
      provider === 'apple'
        ? 'https://appleid.apple.com'
        : ['https://accounts.google.com', 'accounts.google.com'],
    clockTolerance: 30,
  })
  const now = Math.floor(Date.now() / 1000)
  if (
    payload.nonce !== nonceDigest ||
    typeof payload.sub !== 'string' ||
    !payload.sub ||
    typeof payload.iat !== 'number' ||
    payload.iat < now - 10 * 60 ||
    payload.iat > now + 30
  ) {
    throw new Error('PROVIDER_PROOF_INVALID')
  }
  const email = verifiedProviderEmail(payload)
  if (!email) throw new Error('PROVIDER_EMAIL_VERIFICATION_REQUIRED')
  return { subject: payload.sub, email, nonceDigest }
}

function getClaimHmacKey() {
  const key = Deno.env.get('TAILOR_CLAIM_HMAC_KEY')?.trim()
  if (!key || key.length < 32)
    throw new Error('TAILOR_CLAIM_HMAC_KEY must contain at least 32 characters.')
  return key
}

async function keyedHash(value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(getClaimHmacKey()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(value))
  return base64url(new Uint8Array(digest))
}

const emailHash = (email: string) => keyedHash(`email:${email}`)
const codeHash = (tokenDigest: string, emailDigest: string, code: string) =>
  keyedHash(`code:${tokenDigest}:${emailDigest}:${code}`)

function randomEmailCode() {
  const value = new Uint32Array(1)
  crypto.getRandomValues(value)
  return String(value[0] % 1_000_000).padStart(6, '0')
}

async function sendClaimEmailCode(email: string, code: string, jobId: string) {
  const apiKey = Deno.env.get('RESEND_API_KEY')?.trim()
  const claimWebOrigin = (
    Deno.env.get('NEXT_PUBLIC_CLAIM_WEB_ORIGIN') ?? Deno.env.get('WEB_APP_URL')
  )
    ?.trim()
    .replace(/\/$/u, '')
  if (!apiKey || !claimWebOrigin || !/^https?:\/\//u.test(claimWebOrigin))
    return { accepted: false as const, failureCode: 'EMAIL_PROVIDER_UNAVAILABLE' }
  const content = renderDrapeonTransactionalEmail({
    preheader: 'Use this code to continue claiming your Drapeon shop.',
    eyebrow: 'Private shop claim',
    headline: 'Confirm your email',
    body: 'Enter this code on the same claim screen. Drapeon will never ask you to send this code in a message.',
    verificationCode: code,
    verificationHint: 'This code expires in 10 minutes.',
    ctaLabel: 'Return to Drapeon',
    ctaUrl: claimWebOrigin,
  })
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `tailor-claim-code-${jobId}`,
    },
    signal: AbortSignal.timeout(12_000),
    body: JSON.stringify({
      from: normalizeDrapeonSender(Deno.env.get('RESEND_FROM'), 'Drapeon', 'noreply@drapeon.co'),
      to: [email],
      subject: `${code} is your Drapeon claim code`,
      html: content.html,
      text: content.text,
    }),
  })
  const result = (await response.json().catch(() => ({}))) as { id?: string }
  return response.ok
    ? { accepted: true as const, provider: 'RESEND', providerReference: result.id ?? null }
    : { accepted: false as const, failureCode: `RESEND_${response.status}` }
}

function jwtClaim(token: string, name: string) {
  try {
    const payload = token.split('.')[1]?.replaceAll('-', '+').replaceAll('_', '/') ?? ''
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=')
    const parsed = JSON.parse(atob(padded)) as Record<string, unknown>
    return typeof parsed[name] === 'string' ? (parsed[name] as string) : null
  } catch {
    return null
  }
}

function generatedLinkTokenHash(data: unknown) {
  const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  const properties =
    record.properties && typeof record.properties === 'object'
      ? (record.properties as Record<string, unknown>)
      : {}
  if (typeof properties.hashed_token === 'string') return properties.hashed_token
  const actionLink = typeof properties.action_link === 'string' ? properties.action_link : ''
  try {
    return new URL(actionLink).searchParams.get('token_hash')
  } catch {
    return null
  }
}

Deno.serve(async (request) => {
  const cors = getCorsHeaders(request)
  const json = (body: unknown, status = 200, retryAfter?: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'Cache-Control': 'private, no-store',
        'Referrer-Policy': 'no-referrer',
        ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}),
      },
    })

  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ actionable: false }, 405)

  const raw = await request.text()
  if (raw.length > 8_000) return json({ actionable: false }, 400)

  let body: {
    action?: unknown
    token?: unknown
    email?: unknown
    code?: unknown
    provider?: unknown
    proofId?: unknown
    nonce?: unknown
    idToken?: unknown
    password?: unknown
    phone?: unknown
    pickupAddress?: unknown
    pickupAddressLine1?: unknown
    pickupCity?: unknown
    pickupRegion?: unknown
    pickupPostalCode?: unknown
    pickupCountryCode?: unknown
    consentAccepted?: unknown
    consentTextVersion?: unknown
    consentMediaManifest?: unknown
    idempotencyKey?: unknown
    issueClaimedSession?: unknown
    claimDevicePlatform?: unknown
    displayName?: unknown
    businessName?: unknown
    bio?: unknown
    location?: unknown
    languages?: unknown
    specialties?: unknown
    currency?: unknown
    priceMin?: unknown
    priceMax?: unknown
    mediaId?: unknown
    receiptId?: unknown
  }
  try {
    body = JSON.parse(raw)
  } catch {
    return json({ actionable: false }, 400)
  }
  const action = typeof body.action === 'string' ? body.action : ''
  if (
    ![
      'RESOLVE',
      'REQUEST_EMAIL_CODE',
      'VERIFY_EMAIL_CODE',
      'BOOTSTRAP_EMAIL_SESSION',
      'PREPARE_PROVIDER_PROOF',
      'SUBMIT_PROVIDER_PROOF',
      'REPORT_PROVIDER_CONFLICT',
      'FAIL_PROVIDER_SESSION',
      'VERIFY_LINKED_PROVIDER',
      'GET_CLAIM_CONTEXT',
      'UPDATE_CLAIM_PROFILE',
      'REMOVE_CLAIM_MEDIA',
      'CLAIM',
      'FINALIZE',
      'GET_FINALIZE_RECEIPT',
    ].includes(action) ||
    (!['FINALIZE', 'GET_FINALIZE_RECEIPT'].includes(action) &&
      (typeof body.token !== 'string' || !tokenPattern.test(body.token)))
  )
    return json({ actionable: false })

  const client = createClient(getSupabaseUrl(), getServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const ip = getClientIp(request)
  const authenticatedAction = ['FINALIZE', 'GET_FINALIZE_RECEIPT'].includes(action)
  const hash = authenticatedAction ? '' : await tokenHash(body.token as string)
  const ipLimit = await rateLimit(client, ip, `${FN}:${action.toLowerCase()}:ip`, 30, 10 * 60_000, {
    ip,
  })
  if (!ipLimit.allowed) return json({ actionable: false }, 429, ipLimit.retryAfter)
  if (!authenticatedAction) {
    const tokenLimit = await rateLimit(
      client,
      hash,
      `${FN}:${action.toLowerCase()}:token`,
      20,
      10 * 60_000,
      { ip }
    )
    if (!tokenLimit.allowed) return json({ actionable: false }, 429, tokenLimit.retryAfter)
  }

  if (action === 'GET_FINALIZE_RECEIPT') {
    const caller = await getAuthUser(request)
    if (!caller) return json({ available: false, error: 'AUTH_REQUIRED' }, 401)
    const receiptId =
      typeof body.receiptId === 'string' && /^[0-9a-f-]{36}$/iu.test(body.receiptId)
        ? body.receiptId
        : null
    let query = client
      .from('tailor_claim_finalize_receipts')
      .select('id,outcome,response_payload,completed_at')
      .eq('user_id', caller.id)
      .eq('outcome', 'SUCCEEDED')
      .order('completed_at', { ascending: false })
      .limit(1)
    if (receiptId) query = query.eq('id', receiptId)
    const { data: receipt, error: receiptError } = await query.maybeSingle()
    if (receiptError) return json({ available: false, retryable: true }, 503)
    if (!receipt?.response_payload)
      return json({ available: false, error: 'RECEIPT_NOT_FOUND' }, 404)
    return json({
      available: true,
      receiptId: receipt.id,
      completedAt: receipt.completed_at,
      ...receipt.response_payload,
    })
  }

  if (action === 'FINALIZE') {
    const caller = await getAuthUser(request)
    if (!caller) return json({ finalized: false, error: 'AUTH_REQUIRED' }, 401)
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : ''
    if (idempotencyKey.length < 16 || idempotencyKey.length > 180)
      return json({ finalized: false, error: 'INVALID_FINALIZE' }, 400)
    const userLimit = await rateLimit(client, caller.id, `${FN}:finalize:user`, 10, 60 * 60_000, {
      ip,
    })
    if (!userLimit.allowed)
      return json({ finalized: false, error: 'RATE_LIMITED' }, 429, userLimit.retryAfter)
    const { data: prepared, error: prepareError } = await client
      .rpc('prepare_tailor_profile_finalize', {
        p_user_id: caller.id,
        p_idempotency_key: idempotencyKey,
      })
      .maybeSingle()
    if (prepareError || !prepared) return json({ finalized: false, retryable: true }, 503)
    const preparation = prepared as {
      result: string
      receipt_id: string | null
      profile_id: string | null
      source_manifest: Array<Record<string, unknown>> | null
      response: Record<string, unknown> | null
    }
    if (preparation.result === 'LIVE' && preparation.response) return json(preparation.response)
    const cleanupFailedFinalize = async (failureCode: string) => {
      if (!preparation.receipt_id || !preparation.profile_id ||
        !Array.isArray(preparation.source_manifest)) {
        return json({ finalized: false, retryable: true, error: 'FINALIZE_CLEANUP_RETRY' }, 503)
      }
      const { data: failureState, error: beginError } = await client.rpc(
        'begin_tailor_profile_finalize_failure',
        { p_receipt_id: preparation.receipt_id, p_user_id: caller.id,
          p_failure_code: failureCode === 'FINALIZE_RETRY_REQUIRED'
            ? 'FINALIZE_READINESS_CHANGED' : failureCode }
      )
      if (beginError || !failureState)
        return json({ finalized: false, retryable: true, error: 'FINALIZE_CLEANUP_RETRY' }, 503)
      if (failureState === 'LIVE') {
        const { data: live } = await client.from('tailor_claim_finalize_receipts')
          .select('response_payload').eq('id', preparation.receipt_id).maybeSingle()
        return live?.response_payload
          ? json(live.response_payload)
          : json({ finalized: false, retryable: true, error: 'FINALIZE_RECEIPT_RETRY' }, 503)
      }
      if (failureState !== 'CLEANING' && failureState !== 'FAILED')
        return json({ finalized: false, retryable: true, error: 'FINALIZE_CLEANUP_RETRY' }, 503)
      if (failureState === 'CLEANING') {
        for (const bucket of ['avatars', 'portfolio-photos']) {
          const paths = preparation.source_manifest
            .map((source) => publicClaimMediaObject(preparation.profile_id!, source))
            .filter((item) => item?.bucket === bucket)
            .map((item) => item!.objectPath)
          if (!paths.length) continue
          const { error: removeError } = await client.storage.from(bucket).remove(paths)
          if (removeError)
            return json({ finalized: false, retryable: true, error: 'FINALIZE_CLEANUP_RETRY' }, 503)
        }
        const { data: finished, error: finishError } = await client.rpc(
          'finish_tailor_profile_finalize_failure',
          { p_receipt_id: preparation.receipt_id, p_user_id: caller.id }
        )
        if (finishError || finished !== true)
          return json({ finalized: false, retryable: true, error: 'FINALIZE_CLEANUP_RETRY' }, 503)
      }
      return json({ finalized: false, error: failureCode }, 409)
    }
    if (preparation.result === 'CLEANUP_PENDING')
      return await cleanupFailedFinalize('FINALIZE_RETRY_REQUIRED')
    if (
      preparation.result !== 'PREPARED' ||
      !preparation.receipt_id ||
      !preparation.profile_id ||
      !Array.isArray(preparation.source_manifest)
    ) {
      return json({ finalized: false, error: preparation.result }, 409)
    }

    const testDelayMs = developmentFinalizeTestDelayMs()
    if (testDelayMs > 0) {
      console.log(JSON.stringify({
        event: 'finalize.test_delay_started',
        receiptId: preparation.receipt_id,
        delayMs: testDelayMs,
      }))
      await new Promise<void>((resolve) => setTimeout(resolve, testDelayMs))
    }

    const promoted: Array<{
      draftMediaId: string
      mediaAssetId: string
      publicUrl: string
    }> = []
    for (const source of preparation.source_manifest) {
      const media = publicClaimMediaObject(preparation.profile_id, source)
      if (!media) return await cleanupFailedFinalize('SOURCE_MANIFEST_INVALID')
      const { draftMediaId, sourcePath, kind, contentType, bucket, objectPath } = media
      const copied = await client.storage
        .from('tailor-draft-media')
        .copy(sourcePath, objectPath, { destinationBucket: bucket })
      if (copied.error && !/already exists|duplicate/iu.test(copied.error.message))
        return json({ finalized: false, retryable: true, error: 'MEDIA_PROMOTION_RETRY' }, 503)
      const publicUrl = client.storage.from(bucket).getPublicUrl(objectPath).data.publicUrl
      const assetValues = {
        bucket_id: bucket,
        object_path: objectPath,
        owner_user_id: caller.id,
        tailor_profile_id: preparation.profile_id,
        purpose: kind === 'AVATAR' ? 'AVATAR' : 'PORTFOLIO',
        mime_type: contentType,
        byte_size: source.byteSize,
        width: source.width,
        height: source.height,
        duration_ms: source.durationMs,
        checksum_sha256: source.sha256,
        public_url: publicUrl,
        status: 'ACTIVE',
        metadata: { source: 'TAILOR_CLAIM', draft_media_id: draftMediaId },
        moderation_status: 'APPROVED',
        media_kind: kind === 'VIDEO' ? 'VIDEO' : 'IMAGE',
        focal_x: source.focalX ?? 0.5,
        focal_y: source.focalY ?? 0.5,
        portfolio_position: kind === 'AVATAR' ? null : source.sortOrder,
        is_primary: kind !== 'AVATAR' && source.isCover === true,
        availability_state: 'AVAILABLE',
      }
      const { data: asset, error: assetError } = await client
        .from('media_assets')
        .upsert(assetValues, { onConflict: 'bucket_id,object_path' })
        .select('id')
        .single()
      if (assetError || !asset)
        return json({ finalized: false, retryable: true, error: 'MEDIA_RECORD_RETRY' }, 503)
      promoted.push({ draftMediaId, mediaAssetId: asset.id, publicUrl })
    }
    const { data: completed, error: completeError } = await client.rpc(
      'complete_tailor_profile_finalize',
      { p_receipt_id: preparation.receipt_id, p_user_id: caller.id, p_promoted_manifest: promoted }
    )
    if (completeError || !completed) {
      const failureCode = terminalFinalizeFailure(completeError)
      return failureCode
        ? await cleanupFailedFinalize(failureCode)
        : json({ finalized: false, retryable: true }, 503)
    }
    await audit(client, {
      event: 'tailor_claim.finalize_completed',
      actor_id: caller.id,
      actor_role: 'TAILOR',
      payload: { receipt_id: preparation.receipt_id, media_count: promoted.length },
    })
    return json(completed)
  }

  if (action === 'PREPARE_PROVIDER_PROOF') {
    const provider = body.provider === 'apple' || body.provider === 'google' ? body.provider : null
    if (!provider) return json({ prepared: false, error: 'INVALID_PROVIDER' }, 400)
    const proofId = crypto.randomUUID()
    const nonce = randomNonce()
    const nonceDigest = await sha256Hex(nonce)
    const { data: prepared, error: prepareError } = await client
      .rpc('prepare_tailor_claim_provider_proof', {
        p_token_hash: hash,
        p_provider: provider,
        p_nonce_hash: nonceDigest,
        p_session_id: proofId,
      })
      .maybeSingle()
    if (prepareError || !prepared) return json({ prepared: false, retryable: true }, 503)
    const preparation = prepared as {
      result: string
      invite_id: string | null
      user_id: string | null
      expires_at: string | null
      superseded_sessions: number | null
    }
    if (preparation.result !== 'PROOF_REQUIRED' || !preparation.user_id || !preparation.expires_at)
      return json({ prepared: false, error: preparation.result }, 400)
    return json({
      prepared: true,
      proofId,
      provider,
      nonce,
      expiresAt: preparation.expires_at,
      superseded: preparation.superseded_sessions ?? 0,
    })
  }

  if (action === 'SUBMIT_PROVIDER_PROOF') {
    const provider = body.provider === 'apple' || body.provider === 'google' ? body.provider : null
    const proofId =
      typeof body.proofId === 'string' && /^[0-9a-f-]{36}$/iu.test(body.proofId)
        ? body.proofId
        : null
    const nonce =
      typeof body.nonce === 'string' && /^[A-Za-z0-9_-]{40,60}$/u.test(body.nonce)
        ? body.nonce
        : null
    const idToken =
      typeof body.idToken === 'string' && body.idToken.length >= 200 && body.idToken.length <= 6_000
        ? body.idToken
        : null
    if (!provider || !proofId || !nonce || !idToken)
      return json({ bootstrapped: false, error: 'INVALID_PROVIDER_PROOF' }, 400)

    const nonceDigest = await sha256Hex(nonce)
    const { data: pending, error: pendingError } = await client
      .from('tailor_claim_bootstrap_sessions')
      .select('id,invite_id,user_id,provider,provider_nonce_hash,status,expires_at')
      .eq('id', proofId)
      .eq('provider', provider)
      .eq('provider_nonce_hash', nonceDigest)
      .eq('status', 'PREPARING')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()
    if (pendingError || !pending)
      return json({ bootstrapped: false, error: 'PROVIDER_PROOF_EXPIRED' }, 400)

    let subject: string
    try {
      subject = (await verifyProviderToken(provider, idToken, nonce)).subject
    } catch (error) {
      const failureCode =
        error instanceof Error && error.message === 'PROVIDER_EMAIL_VERIFICATION_REQUIRED'
          ? 'PROVIDER_EMAIL_VERIFICATION_REQUIRED'
          : 'PROVIDER_PROOF_INVALID'
      await client.rpc('fail_tailor_claim_provider_bootstrap_session', {
        p_session_id: proofId,
        p_failure_code: failureCode,
      })
      return json({ bootstrapped: false, error: failureCode }, 401)
    }

    const { data: recorded, error: recordError } = await client
      .rpc('record_tailor_claim_provider_proof', {
        p_session_id: proofId,
        p_provider: provider,
        p_provider_subject: subject,
      })
      .maybeSingle()
    if (recordError?.code === '23505') {
      await client.rpc('fail_tailor_claim_provider_bootstrap_session', {
        p_session_id: proofId,
        p_failure_code: 'ACCOUNT_CONFLICT',
      })
      return json({ bootstrapped: false, error: 'ACCOUNT_CONFLICT' }, 409)
    }
    if (recordError || !recorded)
      return json(
        { bootstrapped: false, error: 'PROVIDER_PROOF_RECORD_RETRY', retryable: true },
        503
      )
    const preparation = recorded as {
      result: string
      invite_id: string | null
      user_id: string | null
      placeholder_email: string | null
      expires_at: string | null
    }
    if (preparation.result === 'ACCOUNT_CONFLICT')
      return json({ bootstrapped: false, error: 'ACCOUNT_CONFLICT' }, 409)
    if (preparation.result !== 'VERIFIED' || !preparation.user_id || !preparation.placeholder_email)
      return json({ bootstrapped: false, error: preparation.result }, 400)

    const failClosed = async (failureCode: string) => {
      await client.rpc('fail_tailor_claim_provider_bootstrap_session', {
        p_session_id: proofId,
        p_failure_code: failureCode,
      })
    }

    try {
      const { data: current, error: userError } = await client.auth.admin.getUserById(
        preparation.user_id
      )
      if (userError || !current.user) throw new Error('PLACEHOLDER_LOOKUP_FAILED')
      const { error: unlockError } = await client.auth.admin.updateUserById(preparation.user_id, {
        ban_duration: 'none',
        app_metadata: {
          ...(current.user.app_metadata ?? {}),
          role: 'TAILOR',
          account_origin: 'STAFF_DRAFT',
          claim_session_id: proofId,
        },
      })
      if (unlockError) throw new Error('PLACEHOLDER_UNLOCK_FAILED')

      const { data: link, error: linkError } = await client.auth.admin.generateLink({
        type: 'magiclink',
        email: preparation.placeholder_email,
      })
      const linkTokenHash = generatedLinkTokenHash(link)
      if (linkError || !linkTokenHash) throw new Error('BOOTSTRAP_LINK_FAILED')
      const authClient = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      })
      const { data: verified, error: verifyError } = await authClient.auth.verifyOtp({
        token_hash: linkTokenHash,
        type: 'magiclink',
      })
      const session = verified.session
      const authSessionId = session?.access_token
        ? jwtClaim(session.access_token, 'session_id')
        : null
      if (
        verifyError ||
        !session?.access_token ||
        !session.refresh_token ||
        !authSessionId ||
        verified.user?.id !== preparation.user_id
      )
        throw new Error('BOOTSTRAP_SESSION_FAILED')
      const { data: activated, error: activateError } = await client.rpc(
        'activate_tailor_claim_bootstrap_session',
        { p_session_id: proofId, p_auth_session_id: authSessionId, p_user_id: preparation.user_id }
      )
      if (activateError || activated !== true) throw new Error('BOOTSTRAP_ACTIVATION_FAILED')
      await audit(client, {
        event: 'tailor_claim.provider_bootstrap_session_created',
        actor_id: preparation.user_id,
        actor_role: 'TAILOR',
        payload: { invite_id: preparation.invite_id, claim_session_id: proofId, provider },
      })
      return json({
        bootstrapped: true,
        provider,
        session: {
          claimSessionId: proofId,
          providerProofId: proofId,
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
          expiresAt: preparation.expires_at,
        },
      })
    } catch (cause) {
      await failClosed(cause instanceof Error ? cause.message : 'BOOTSTRAP_FAILED')
      return json(
        { bootstrapped: false, error: 'SECURE_SESSION_SETUP_RETRY', retryable: true },
        503
      )
    }
  }

  if (action === 'VERIFY_LINKED_PROVIDER') {
    const provider = body.provider === 'apple' || body.provider === 'google' ? body.provider : null
    if (!provider) return json({ verified: false, error: 'INVALID_PROVIDER_PROOF' }, 400)

    const claimSession = await getActiveStaffDraftClaimSession(request, {
      allowSessionRebind: true,
    })
    if (!claimSession) return json({ verified: false, error: 'CLAIM_SESSION_EXPIRED' }, 401)
    const { data: ledger, error: ledgerError } = await client
      .from('tailor_claim_bootstrap_sessions')
      .select(
        'invite_id,provider,provider_subject,provider_verified_at,tailor_claim_invites!inner(token_hash,status,expires_at)'
      )
      .eq('id', claimSession.claimSessionId)
      .eq('user_id', claimSession.userId)
      .maybeSingle()
    const invite = Array.isArray(ledger?.tailor_claim_invites)
      ? ledger.tailor_claim_invites[0]
      : ledger?.tailor_claim_invites
    if (
      ledgerError ||
      !ledger ||
      ledger.provider !== provider ||
      !ledger.provider_subject ||
      !ledger.provider_verified_at ||
      invite?.token_hash !== hash ||
      !['INVITED', 'OPENED'].includes(invite?.status ?? '') ||
      !invite?.expires_at ||
      new Date(invite.expires_at).getTime() <= Date.now()
    ) {
      return json({ verified: false, error: 'UNAVAILABLE' }, 404)
    }

    const { data: authUser, error: authUserError } = await client.auth.admin.getUserById(
      claimSession.userId
    )
    const nonEmailIdentities = (authUser.user?.identities ?? []).filter(
      (identity) => identity.provider !== 'email'
    )
    const linkedIdentity = nonEmailIdentities.find(
      (identity) =>
        identity.provider === provider &&
        identity.user_id === claimSession.userId &&
        identity.identity_data?.sub === ledger.provider_subject
    )
    if (authUserError || nonEmailIdentities.length !== 1 || !linkedIdentity) {
      await client.rpc('fail_tailor_claim_provider_bootstrap_session', {
        p_session_id: claimSession.claimSessionId,
        p_failure_code: 'PROVIDER_IDENTITY_MISMATCH',
      })
      return json({ verified: false, error: 'PROVIDER_IDENTITY_MISMATCH' }, 409)
    }

    await audit(client, {
      event: 'tailor_claim.provider_identity_verified',
      actor_id: claimSession.userId,
      actor_role: 'TAILOR',
      payload: {
        invite_id: ledger.invite_id,
        claim_session_id: claimSession.claimSessionId,
        provider,
      },
    })
    return json({ verified: true, provider })
  }

  if (action === 'REPORT_PROVIDER_CONFLICT') {
    const provider = body.provider === 'apple' || body.provider === 'google' ? body.provider : null
    if (!provider) return json({ recorded: false, error: 'INVALID_PROVIDER' }, 400)
    const claimSession = await getActiveStaffDraftClaimSession(request)
    if (!claimSession) return json({ recorded: false, error: 'CLAIM_SESSION_EXPIRED' }, 401)
    const { data: failed, error: failError } = await client.rpc(
      'fail_tailor_claim_provider_bootstrap_session',
      { p_session_id: claimSession.claimSessionId, p_failure_code: 'ACCOUNT_CONFLICT' }
    )
    if (failError || failed !== true)
      return json({ recorded: false, error: 'PROVIDER_SESSION_RECORD_RETRY', retryable: true }, 503)
    return json({ recorded: true, error: 'ACCOUNT_CONFLICT' }, 409)
  }

  if (action === 'FAIL_PROVIDER_SESSION') {
    const provider = body.provider === 'apple' || body.provider === 'google' ? body.provider : null
    if (!provider) return json({ recorded: false, error: 'INVALID_PROVIDER' }, 400)
    const claimSession = await getActiveStaffDraftClaimSession(request)
    if (!claimSession) return json({ recorded: false, error: 'CLAIM_SESSION_EXPIRED' }, 401)
    const { data: ledger } = await client
      .from('tailor_claim_bootstrap_sessions')
      .select('provider')
      .eq('id', claimSession.claimSessionId)
      .eq('user_id', claimSession.userId)
      .maybeSingle()
    if (ledger?.provider !== provider) return json({ recorded: false, error: 'UNAVAILABLE' }, 404)
    const { data: failed, error: failError } = await client.rpc(
      'fail_tailor_claim_provider_bootstrap_session',
      { p_session_id: claimSession.claimSessionId, p_failure_code: 'PROVIDER_LINK_FAILED' }
    )
    if (failError || failed !== true)
      return json({ recorded: false, error: 'PROVIDER_SESSION_RECORD_RETRY', retryable: true }, 503)
    return json({ recorded: true })
  }

  if (action === 'GET_CLAIM_CONTEXT') {
    const claimSession = await getActiveStaffDraftClaimSession(request)
    if (!claimSession) return json({ available: false, error: 'CLAIM_SESSION_EXPIRED' }, 401)
    const { data: ledger, error: ledgerError } = await client
      .from('tailor_claim_bootstrap_sessions')
      .select(
        'invite_id,status,provider,expires_at,tailor_claim_invites!inner(token_hash,status,expires_at,tailor_profile_id)'
      )
      .eq('id', claimSession.claimSessionId)
      .eq('user_id', claimSession.userId)
      .eq('auth_session_id', claimSession.authSessionId)
      .maybeSingle()
    const invite = Array.isArray(ledger?.tailor_claim_invites)
      ? ledger.tailor_claim_invites[0]
      : ledger?.tailor_claim_invites
    if (
      ledgerError ||
      !ledger ||
      ledger.status !== 'ACTIVE' ||
      new Date(ledger.expires_at).getTime() <= Date.now() ||
      invite?.token_hash !== hash ||
      !['INVITED', 'OPENED'].includes(invite?.status ?? '') ||
      !invite?.expires_at ||
      new Date(invite.expires_at).getTime() <= Date.now()
    ) {
      return json({ available: false, error: 'UNAVAILABLE' }, 404)
    }
    const { data: media, error: mediaError } = await client
      .from('tailor_draft_media')
      .select('id,media_kind,sort_order,is_cover,storage_path')
      .eq('invite_id', ledger.invite_id)
      .eq('moderation_status', 'APPROVED')
      .not('confirmed_at', 'is', null)
      .order('sort_order')
      .order('created_at')
    if (mediaError || !media || media.length < 2)
      return json({ available: false, error: 'NOT_READY' }, 409)
    const profileId = invite?.tailor_profile_id
    const [{ data: profile, error: profileError }, signedMedia] = await Promise.all([
      client
        .from('tailor_profiles')
        .select(
          'display_name,business_name,bio,location,languages,specialty_tags,price_range_min,price_range_max,currency'
        )
        .eq('id', profileId)
        .maybeSingle(),
      client.storage.from('tailor-draft-media').createSignedUrls(
        media.map((item) => item.storage_path),
        10 * 60
      ),
    ])
    if (profileError || !profile || signedMedia.error || !signedMedia.data)
      return json({ available: false, error: 'CLAIM_CONTEXT_RETRY', retryable: true }, 503)
    return json({
      available: true,
      provider: ledger.provider,
      consentTextVersion: 'tailor-imported-media-v1',
      profile: {
        displayName: profile.display_name,
        businessName: profile.business_name,
        bio: profile.bio,
        location: profile.location,
        languages: profile.languages,
        specialties: profile.specialty_tags,
        priceMin:
          typeof profile.price_range_min === 'number' ? profile.price_range_min / 100 : null,
        priceMax:
          typeof profile.price_range_max === 'number' ? profile.price_range_max / 100 : null,
        currency: profile.currency,
      },
      media: media.map((item, index) => ({
        id: item.id,
        kind: item.media_kind,
        label:
          item.media_kind === 'AVATAR'
            ? 'Profile photo'
            : `${item.media_kind === 'VIDEO' ? 'Video' : 'Portfolio photo'} ${index + 1}`,
        cover: item.is_cover,
        previewUrl: signedMedia.data[index]?.signedUrl ?? null,
      })),
    })
  }

  if (action === 'UPDATE_CLAIM_PROFILE' || action === 'REMOVE_CLAIM_MEDIA') {
    const claimSession = await getActiveStaffDraftClaimSession(request)
    if (!claimSession) return json({ updated: false, error: 'CLAIM_SESSION_EXPIRED' }, 401)
    const { data: ledger, error: ledgerError } = await client
      .from('tailor_claim_bootstrap_sessions')
      .select(
        'invite_id,status,expires_at,tailor_claim_invites!inner(status,expires_at,token_hash,tailor_profile_id)'
      )
      .eq('id', claimSession.claimSessionId)
      .eq('user_id', claimSession.userId)
      .eq('auth_session_id', claimSession.authSessionId)
      .maybeSingle()
    const invite = Array.isArray(ledger?.tailor_claim_invites)
      ? ledger.tailor_claim_invites[0]
      : ledger?.tailor_claim_invites
    if (
      ledgerError ||
      !ledger ||
      ledger.status !== 'ACTIVE' ||
      new Date(ledger.expires_at).getTime() <= Date.now() ||
      invite?.token_hash !== hash ||
      !['INVITED', 'OPENED'].includes(invite?.status ?? '') ||
      !invite?.expires_at ||
      new Date(invite.expires_at).getTime() <= Date.now()
    ) {
      return json({ updated: false, error: 'UNAVAILABLE' }, 404)
    }

    if (action === 'UPDATE_CLAIM_PROFILE') {
      const validated = validateTailorDraftFields(body as Record<string, unknown>)
      if (!validated.value)
        return json({ updated: false, error: 'PROFILE_INVALID', detail: validated.error }, 400)
      const fields = validated.value
      const { data: updated, error: updateError } = await client
        .from('tailor_profiles')
        .update({
          display_name: fields.displayName,
          business_name: fields.businessName,
          bio: fields.bio,
          location: fields.location,
          languages: fields.languages,
          specialty_tags: fields.specialties,
          currency: fields.currency,
          price_range_min: fields.priceMin * 100,
          price_range_max: fields.priceMax * 100,
          updated_at: new Date().toISOString(),
        })
        .eq('id', invite.tailor_profile_id)
        .select('id')
        .maybeSingle()
      if (updateError || !updated)
        return json({ updated: false, error: 'PROFILE_UPDATE_RETRY', retryable: true }, 503)
      await audit(client, {
        event: 'tailor_claim.profile_edited',
        actor_id: claimSession.userId,
        actor_role: 'TAILOR',
        payload: { invite_id: ledger.invite_id, bootstrap_session_id: claimSession.claimSessionId },
      })
      return json({ updated: true })
    }

    const mediaId = typeof body.mediaId === 'string' ? body.mediaId : ''
    if (!/^[0-9a-f-]{36}$/iu.test(mediaId))
      return json({ removed: false, error: 'MEDIA_NOT_FOUND' }, 404)
    const { data: media, error: mediaError } = await client
      .from('tailor_draft_media')
      .select('id,media_kind,is_cover')
      .eq('invite_id', ledger.invite_id)
      .eq('moderation_status', 'APPROVED')
      .not('confirmed_at', 'is', null)
    if (mediaError || !media)
      return json({ removed: false, error: 'MEDIA_UPDATE_RETRY', retryable: true }, 503)
    const target = media.find((item) => item.id === mediaId)
    if (!target) return json({ removed: false, error: 'MEDIA_NOT_FOUND' }, 404)
    if (target.media_kind === 'AVATAR')
      return json({ removed: false, error: 'AVATAR_REQUIRED' }, 409)
    if (target.is_cover) return json({ removed: false, error: 'COVER_REQUIRED' }, 409)
    const remainingPhotos = media.filter(
      (item) => item.id !== mediaId && item.media_kind === 'PHOTO'
    ).length
    if (target.media_kind === 'PHOTO' && remainingPhotos < 1)
      return json({ removed: false, error: 'PHOTO_REQUIRED' }, 409)
    const { data: removed, error: removeError } = await client
      .from('tailor_draft_media')
      .update({
        moderation_status: 'BLOCKED',
        is_cover: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', mediaId)
      .eq('invite_id', ledger.invite_id)
      .eq('moderation_status', 'APPROVED')
      .select('id')
      .maybeSingle()
    if (removeError || !removed)
      return json({ removed: false, error: 'MEDIA_UPDATE_RETRY', retryable: true }, 503)
    await audit(client, {
      event: 'tailor_claim.media_removed',
      actor_id: claimSession.userId,
      actor_role: 'TAILOR',
      payload: {
        invite_id: ledger.invite_id,
        bootstrap_session_id: claimSession.claimSessionId,
        media_id: mediaId,
      },
    })
    return json({ removed: true, mediaId })
  }

  if (action === 'CLAIM') {
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : ''
    const claimSession = await getActiveStaffDraftClaimSession(request)
    if (!claimSession) {
      const claimedCaller = await getAuthUser(request)
      if (!claimedCaller) return json({ claimed: false, error: 'CLAIM_SESSION_EXPIRED' }, 401)
      const { data: replayInvite } = await client
        .from('tailor_claim_invites')
        .select('id,token_hash,status')
        .eq('tailor_user_id', claimedCaller.id)
        .eq('token_hash', hash)
        .eq('status', 'CLAIMING')
        .maybeSingle()
      if (!replayInvite) return json({ claimed: false, error: 'CLAIM_SESSION_EXPIRED' }, 401)
      const { data: interrupted } = await client
        .from('tailor_claim_transition_receipts')
        .select('id,outcome,auth_handover_at')
        .eq('invite_id', replayInvite.id)
        .eq('user_id', claimedCaller.id)
        .eq('outcome', 'IN_PROGRESS')
        .not('auth_handover_at', 'is', null)
        .maybeSingle()
      if (!interrupted || !interrupted.auth_handover_at || !claimedCaller.email)
        return json({ claimed: false, error: 'CLAIM_SESSION_EXPIRED' }, 401)
      if (typeof body.phone === 'string') {
        const correctedPhone = normalizePhoneForStorage(body.phone)
        const correctedPhoneError = validatePhoneForProfile(correctedPhone)
        if (correctedPhoneError) return json({ claimed: false, error: 'INVALID_PHONE' }, 400)
        const { data: phoneResult, error: phoneUpdateError } = await client.rpc(
          'update_tailor_profile_claim_phone',
          {
            p_receipt_id: interrupted.id,
            p_user_id: claimedCaller.id,
            p_phone: correctedPhone,
          }
        )
        if (phoneUpdateError)
          return json({ claimed: false, error: 'CLAIM_COMPLETION_RETRY', retryable: true }, 503)
        if (phoneResult !== 'PHONE_UPDATED')
          return json({ claimed: false, error: phoneResult ?? 'CLAIM_COMPLETION_RETRY' }, 409)
      }
      const { data: completed, error: completeError } = await client.rpc(
        'complete_tailor_profile_claim',
        {
          p_receipt_id: interrupted.id,
          p_user_id: claimedCaller.id,
          p_email: claimedCaller.email,
        }
      )
      if (completeError || !completed) {
        const failure = claimCompletionFailure(completeError)
        return json(
          {
            claimed: false,
            error: failure ?? 'CLAIM_COMPLETION_RETRY',
            retryable: !failure,
            recovery: failure === 'PHONE_ALREADY_IN_USE' ? 'CORRECT_PHONE' : undefined,
          },
          failure ? 409 : 503
        )
      }
      return json(completed)
    }
    const rawPhone = typeof body.phone === 'string' ? body.phone : ''
    const phone = normalizePhoneForStorage(rawPhone)
    const phoneError = validatePhoneForProfile(phone)
    const pickupAddress = typeof body.pickupAddress === 'string' ? body.pickupAddress.trim() : ''
    const pickupAddressLine1 =
      typeof body.pickupAddressLine1 === 'string' ? body.pickupAddressLine1.trim() : ''
    const pickupCity = typeof body.pickupCity === 'string' ? body.pickupCity.trim() : ''
    const pickupRegion = typeof body.pickupRegion === 'string' ? body.pickupRegion.trim() : ''
    const pickupPostalCode =
      typeof body.pickupPostalCode === 'string' ? body.pickupPostalCode.trim() : ''
    const pickupCountryCode =
      typeof body.pickupCountryCode === 'string' ? body.pickupCountryCode.trim().toUpperCase() : ''
    const consentTextVersion =
      typeof body.consentTextVersion === 'string' ? body.consentTextVersion.trim() : ''
    const consentMediaManifest = Array.isArray(body.consentMediaManifest)
      ? body.consentMediaManifest
      : null
    if (
      idempotencyKey.length < 16 ||
      idempotencyKey.length > 180 ||
      phoneError ||
      pickupAddress.length < 8 ||
      pickupAddress.length > 500 ||
      pickupAddressLine1.length < 3 ||
      pickupAddressLine1.length > 200 ||
      pickupCity.length < 2 ||
      pickupCity.length > 120 ||
      pickupRegion.length < 2 ||
      pickupRegion.length > 120 ||
      !claimPickupPostcodeValid(pickupCountryCode, pickupPostalCode) ||
      !/^[A-Z]{2}$/u.test(pickupCountryCode) ||
      body.consentAccepted !== true ||
      consentTextVersion.length < 3 ||
      consentTextVersion.length > 80 ||
      !consentMediaManifest ||
      consentMediaManifest.some(
        (value) => typeof value !== 'string' || !/^[0-9a-f-]{36}$/iu.test(value)
      )
    ) {
      return json({ claimed: false, error: phoneError ? 'INVALID_PHONE' : 'INVALID_CLAIM' }, 400)
    }

    const { data: bootstrap, error: bootstrapError } = await client
      .from('tailor_claim_bootstrap_sessions')
      .select('provider,provider_subject')
      .eq('id', claimSession.claimSessionId)
      .eq('user_id', claimSession.userId)
      .maybeSingle()
    const { data: current, error: currentError } = await client.auth.admin.getUserById(
      claimSession.userId
    )
    if (bootstrapError || !bootstrap || currentError || !current.user)
      return json({ claimed: false, retryable: true }, 503)

    let email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    let emailDigest: string | null = null
    let password: string | undefined
    const nonEmailIdentities = (current.user.identities ?? []).filter(
      (identity) => identity.provider !== 'email'
    )
    if (bootstrap.provider === 'apple' || bootstrap.provider === 'google') {
      const identity = nonEmailIdentities.find(
        (item) =>
          item.provider === bootstrap.provider &&
          item.identity_data?.sub === bootstrap.provider_subject
      )
      const identityEmail =
        typeof identity?.identity_data?.email === 'string'
          ? identity.identity_data.email.trim().toLowerCase()
          : ''
      if (nonEmailIdentities.length !== 1 || !identity || !emailPattern.test(identityEmail))
        return json({ claimed: false, error: 'PROVIDER_EMAIL_REQUIRED' }, 409)
      email = identityEmail
    } else {
      if (nonEmailIdentities.length !== 0)
        return json({ claimed: false, error: 'PROVIDER_IDENTITY_MISMATCH' }, 409)
      password = typeof body.password === 'string' ? body.password : undefined
      if (!emailPattern.test(email) || !password || password.length < 10 || password.length > 72)
        return json({ claimed: false, error: 'EMAIL_CREDENTIALS_REQUIRED' }, 400)
      emailDigest = await emailHash(email)
    }

    const { data: prepared, error: prepareError } = await client
      .rpc('prepare_tailor_profile_claim', {
        p_token_hash: hash,
        p_bootstrap_session_id: claimSession.claimSessionId,
        p_user_id: claimSession.userId,
        p_auth_session_id: claimSession.authSessionId,
        p_idempotency_key: idempotencyKey,
        p_email: email,
        p_email_hash: emailDigest,
        p_phone: phone,
        p_pickup_address: pickupAddress,
        p_pickup_address_line1: pickupAddressLine1,
        p_pickup_city: pickupCity,
        p_pickup_region: pickupRegion,
        p_pickup_postal_code: pickupPostalCode,
        p_pickup_country_code: pickupCountryCode,
        p_consent_text_version: consentTextVersion,
        p_consent_media_manifest: consentMediaManifest,
      })
      .maybeSingle()
    if (prepareError || !prepared)
      return json({ claimed: false, error: 'CLAIM_PREPARE_RETRY', retryable: true }, 503)
    const preparation = prepared as {
      result: string
      receipt_id: string | null
      response: Record<string, unknown> | null
    }
    if (preparation.result === 'ACCOUNT_CONFLICT')
      return json({ claimed: false, error: 'ACCOUNT_CONFLICT' }, 409)
    if (preparation.result === 'PHONE_ALREADY_IN_USE')
      return json({ claimed: false, error: 'PHONE_ALREADY_IN_USE' }, 409)
    if (!['PREPARED', 'CLAIMED'].includes(preparation.result) || !preparation.receipt_id)
      return json({ claimed: false, error: preparation.result }, 400)

    const claimedAppMetadata = {
      ...(current.user.app_metadata ?? {}),
      role: 'TAILOR',
      account_origin: 'CLAIMED',
      claim_session_id: null,
    } as Record<string, unknown>

    if (preparation.result !== 'CLAIMED') {
      const { error: identityUpdateError } = await client.auth.admin.updateUserById(
        claimSession.userId,
        {
          email,
          email_confirm: true,
          ...(password ? { password } : {}),
          ban_duration: 'none',
          user_metadata: {
            ...(current.user.user_metadata ?? {}),
            role: 'TAILOR',
            phone,
          },
          app_metadata: claimedAppMetadata,
        }
      )
      if (identityUpdateError) {
        const conflict = identityUpdateError.code === 'email_exists'
        if (conflict) {
          await client.rpc('fail_tailor_profile_claim_conflict', {
            p_receipt_id: preparation.receipt_id,
            p_user_id: claimSession.userId,
          })
        }
        return json(
          { claimed: false, error: conflict ? 'ACCOUNT_CONFLICT' : 'AUTH_HANDOVER_RETRY' },
          conflict ? 409 : 503
        )
      }
      const { data: handoverReceipt, error: handoverRecordError } = await client
        .from('tailor_claim_transition_receipts')
        .update({ auth_handover_at: new Date().toISOString() })
        .eq('id', preparation.receipt_id)
        .eq('user_id', claimSession.userId)
        .eq('outcome', 'IN_PROGRESS')
        .select('id')
        .maybeSingle()
      if (handoverRecordError || handoverReceipt?.id !== preparation.receipt_id)
        return json({ claimed: false, error: 'AUTH_HANDOVER_RETRY', retryable: true }, 503)
      const { data: completed, error: completeError } = await client.rpc(
        'complete_tailor_profile_claim',
        { p_receipt_id: preparation.receipt_id, p_user_id: claimSession.userId, p_email: email }
      )
      if (completeError || !completed) {
        const failure = claimCompletionFailure(completeError)
        return json(
          {
            claimed: false,
            error: failure ?? 'CLAIM_COMPLETION_RETRY',
            retryable: !failure,
            recovery: failure === 'PHONE_ALREADY_IN_USE' ? 'CORRECT_PHONE' : undefined,
          },
          failure ? 409 : 503
        )
      }
    }
    await audit(client, {
      event: 'tailor_claim.identity_handover_completed',
      actor_id: claimSession.userId,
      actor_role: 'TAILOR',
      payload: {
        receipt_id: preparation.receipt_id,
        bootstrap_session_id: claimSession.claimSessionId,
      },
    })
    const claimResponse = {
      claimed: true,
      receiptId: preparation.receipt_id,
      state: 'CLAIMED_AWAITING_EMAIL',
      next: 'VERIFY_PHONE',
    }
    // Web hands off to the phone and does not install a mobile session. Avoid
    // creating a live Auth session that no client will ever receive.
    if (body.issueClaimedSession !== true) return json(claimResponse)
    // Updating the password ends the bootstrap Auth session. Issue a normal
    // tailor session only after the claim receipt succeeds and only to the
    // caller who proved this active bootstrap session and claimed this user.
    let claimedSession: { accessToken: string; refreshToken: string } | null = null
    try {
      const { data: link, error: linkError } = await client.auth.admin.generateLink({
        type: 'magiclink',
        email,
      })
      const linkTokenHash = generatedLinkTokenHash(link)
      if (linkError || !linkTokenHash) throw new Error('CLAIMED_SESSION_LINK_FAILED')
      const authClient = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      })
      const { data: verified, error: verifyError } = await authClient.auth.verifyOtp({
        token_hash: linkTokenHash,
        type: 'magiclink',
      })
      if (
        verifyError ||
        !verified.session?.access_token ||
        !verified.session.refresh_token ||
        verified.user?.id !== claimSession.userId ||
        verified.user.app_metadata?.account_origin !== 'CLAIMED' ||
        verified.user.app_metadata?.claim_session_id
      ) {
        throw new Error('CLAIMED_SESSION_VERIFICATION_FAILED')
      }
      claimedSession = {
        accessToken: verified.session.access_token,
        refreshToken: verified.session.refresh_token,
      }
    } catch (cause) {
      await audit(client, {
        event: 'tailor_claim.claimed_session_issue_failed',
        actor_id: claimSession.userId,
        actor_role: 'TAILOR',
        payload: {
          receipt_id: preparation.receipt_id,
          reason: cause instanceof Error ? cause.message : 'UNKNOWN',
        },
      })
    }
    // The email claim itself proved control of this address with a claim-owned
    // code. Trust this same mobile device before it enters setup; otherwise a
    // cold start rejects the new session and strands a completed claim.
    let deviceTrustToken: string | null = null
    const claimDevicePlatform = body.claimDevicePlatform
    if (
      claimedSession &&
      bootstrap.provider == null &&
      (claimDevicePlatform === 'IOS' || claimDevicePlatform === 'ANDROID')
    ) {
      const token = randomNonce()
      const { data: trustedDevice, error: trustError } = await client
        .from('auth_trusted_devices')
        .insert({
          user_id: claimSession.userId,
          token_hash: await sha256Hex(token),
          label: claimDevicePlatform === 'IOS' ? 'Drapeon on iPhone or iPad' : 'Drapeon on Android',
          platform: claimDevicePlatform,
          remembered: true,
          expires_at: deviceTrustExpiry(true).toISOString(),
        })
        .select('id')
        .single()
      if (!trustError && trustedDevice?.id) {
        deviceTrustToken = token
        await audit(client, {
          event: 'auth.device_verified_from_claim',
          actor_id: claimSession.userId,
          actor_role: 'TAILOR',
          payload: { receipt_id: preparation.receipt_id, device_id: trustedDevice.id, platform: claimDevicePlatform },
        })
      } else {
        await audit(client, {
          event: 'auth.claim_device_trust_failed',
          actor_id: claimSession.userId,
          actor_role: 'TAILOR',
          payload: { receipt_id: preparation.receipt_id, database_code: trustError?.code ?? 'UNKNOWN' },
        })
      }
    }
    return json({ ...claimResponse, session: claimedSession, deviceTrustToken })
  }

  if (action === 'REQUEST_EMAIL_CODE') {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!emailPattern.test(email) || email.length > 320)
      return json({ sent: false, error: 'INVALID_EMAIL' }, 400)
    const emailDigest = await emailHash(email)
    const code = randomEmailCode()
    const codeDigest = await codeHash(hash, emailDigest, code)
    const { data: issued, error: issueError } = await client
      .rpc('issue_tailor_claim_email_code', {
        p_token_hash: hash,
        p_email_hash: emailDigest,
        p_code_hash: codeDigest,
      })
      .maybeSingle()
    if (issueError || !issued) return json({ sent: false, retryable: true }, 503)
    const issue = issued as { result: string; invite_id: string | null; job_id: string | null }
    if (issue.result === 'EMAIL_LOCKED') return json({ sent: false, error: 'EMAIL_LOCKED' }, 429)
    if (issue.result !== 'ISSUED' || !issue.invite_id || !issue.job_id)
      return json({ sent: false, error: 'UNAVAILABLE' }, 404)

    let outcome: Awaited<ReturnType<typeof sendClaimEmailCode>>
    try {
      outcome = await sendClaimEmailCode(email, code, issue.job_id)
    } catch {
      outcome = { accepted: false, failureCode: 'EMAIL_PROVIDER_ERROR' }
    }
    const { data: recorded, error: recordError } = await client.rpc(
      'record_tailor_claim_email_job_outcome',
      {
        p_job_id: issue.job_id,
        p_accepted: outcome.accepted,
        p_provider: outcome.accepted ? outcome.provider : null,
        p_provider_reference: outcome.accepted ? outcome.providerReference : null,
        p_failure_code: outcome.accepted ? null : outcome.failureCode,
      }
    )
    if (recordError || recorded !== true) return json({ sent: false, retryable: true }, 503)
    if (!outcome.accepted) return json({ sent: false, retryable: true }, 503)
    await audit(client, {
      event: 'tailor_claim.email_code_sent',
      actor_role: 'SYSTEM',
      payload: { invite_id: issue.invite_id, job_id: issue.job_id },
    })
    return json({ sent: true, expiresInSeconds: 600 })
  }

  if (action === 'VERIFY_EMAIL_CODE') {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const code = typeof body.code === 'string' ? body.code.trim() : ''
    if (!emailPattern.test(email) || email.length > 320 || !codePattern.test(code))
      return json({ verified: false, error: 'INVALID_CODE' }, 400)
    const emailDigest = await emailHash(email)
    const codeDigest = await codeHash(hash, emailDigest, code)
    const { data: verified, error: verifyError } = await client
      .rpc('verify_tailor_claim_email_code', {
        p_token_hash: hash,
        p_email: email,
        p_email_hash: emailDigest,
        p_code_hash: codeDigest,
      })
      .maybeSingle()
    if (verifyError || !verified) return json({ verified: false, retryable: true }, 503)
    const verification = verified as { result: string; invite_id: string | null }
    if (verification.result === 'EMAIL_LOCKED')
      return json({ verified: false, error: 'EMAIL_LOCKED' }, 429)
    if (verification.result === 'ACCOUNT_CONFLICT')
      return json({ verified: false, error: 'ACCOUNT_CONFLICT' }, 409)
    if (verification.result !== 'VERIFIED')
      return json(
        {
          verified: false,
          error: verification.result === 'CODE_EXPIRED' ? 'CODE_EXPIRED' : 'INVALID_CODE',
        },
        400
      )
    await audit(client, {
      event: 'tailor_claim.email_verified',
      actor_role: 'SYSTEM',
      payload: { invite_id: verification.invite_id },
    })
    return json({ verified: true })
  }

  if (action === 'BOOTSTRAP_EMAIL_SESSION') {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const code = typeof body.code === 'string' ? body.code.trim() : ''
    if (!emailPattern.test(email) || email.length > 320 || !codePattern.test(code))
      return json({ bootstrapped: false, error: 'EMAIL_VERIFICATION_REQUIRED' }, 400)

    const emailDigest = await emailHash(email)
    const codeDigest = await codeHash(hash, emailDigest, code)
    const claimSessionId = crypto.randomUUID()
    const { data: prepared, error: prepareError } = await client
      .rpc('prepare_tailor_claim_bootstrap_session', {
        p_token_hash: hash,
        p_email_hash: emailDigest,
        p_code_hash: codeDigest,
        p_session_id: claimSessionId,
      })
      .maybeSingle()
    if (prepareError || !prepared)
      return json(
        { bootstrapped: false, error: 'SECURE_SESSION_PREPARE_RETRY', retryable: true },
        503
      )
    const preparation = prepared as {
      result: string
      invite_id: string | null
      user_id: string | null
      placeholder_email: string | null
      expires_at: string | null
    }
    if (preparation.result === 'EMAIL_LOCKED')
      return json({ bootstrapped: false, error: 'EMAIL_LOCKED' }, 429)
    if (preparation.result === 'SESSION_EXISTS')
      return json({ bootstrapped: false, error: 'BOOTSTRAP_ALREADY_STARTED' }, 409)
    if (preparation.result !== 'PREPARED' || !preparation.user_id || !preparation.placeholder_email)
      return json({ bootstrapped: false, error: preparation.result }, 400)

    const failClosed = async (failureCode: string) => {
      await client.rpc('fail_tailor_claim_bootstrap_session', {
        p_session_id: claimSessionId,
        p_failure_code: failureCode,
      })
      const { data: current } = await client.auth.admin.getUserById(preparation.user_id!)
      await client.auth.admin.updateUserById(preparation.user_id!, {
        ban_duration: '876000h',
        app_metadata: {
          ...(current.user?.app_metadata ?? {}),
          role: 'TAILOR',
          account_origin: 'STAFF_DRAFT',
          claim_session_id: null,
        },
      })
    }

    try {
      const { data: current, error: userError } = await client.auth.admin.getUserById(
        preparation.user_id
      )
      if (userError || !current.user) throw new Error('PLACEHOLDER_LOOKUP_FAILED')
      const { error: unlockError } = await client.auth.admin.updateUserById(preparation.user_id, {
        ban_duration: 'none',
        app_metadata: {
          ...(current.user.app_metadata ?? {}),
          role: 'TAILOR',
          account_origin: 'STAFF_DRAFT',
          claim_session_id: claimSessionId,
        },
      })
      if (unlockError) throw new Error('PLACEHOLDER_UNLOCK_FAILED')

      const { data: link, error: linkError } = await client.auth.admin.generateLink({
        type: 'magiclink',
        email: preparation.placeholder_email,
      })
      const linkTokenHash = generatedLinkTokenHash(link)
      if (linkError || !linkTokenHash) throw new Error('BOOTSTRAP_LINK_FAILED')

      const authClient = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      })
      const { data: verified, error: verifyError } = await authClient.auth.verifyOtp({
        token_hash: linkTokenHash,
        type: 'magiclink',
      })
      const session = verified.session
      const authSessionId = session?.access_token
        ? jwtClaim(session.access_token, 'session_id')
        : null
      if (
        verifyError ||
        !session?.access_token ||
        !session.refresh_token ||
        !authSessionId ||
        verified.user?.id !== preparation.user_id
      )
        throw new Error('BOOTSTRAP_SESSION_FAILED')

      const { data: activated, error: activateError } = await client.rpc(
        'activate_tailor_claim_bootstrap_session',
        {
          p_session_id: claimSessionId,
          p_auth_session_id: authSessionId,
          p_user_id: preparation.user_id,
        }
      )
      if (activateError || activated !== true) throw new Error('BOOTSTRAP_ACTIVATION_FAILED')

      await audit(client, {
        event: 'tailor_claim.bootstrap_session_created',
        actor_id: preparation.user_id,
        actor_role: 'TAILOR',
        payload: { invite_id: preparation.invite_id, claim_session_id: claimSessionId },
      })
      return json({
        bootstrapped: true,
        session: {
          claimSessionId,
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
          expiresAt: preparation.expires_at,
        },
      })
    } catch (cause) {
      await failClosed(cause instanceof Error ? cause.message : 'BOOTSTRAP_FAILED')
      return json(
        { bootstrapped: false, error: 'SECURE_SESSION_SETUP_RETRY', retryable: true },
        503
      )
    }
  }

  const { data, error } = await client
    .rpc('resolve_tailor_claim_preview', { p_token_hash: hash })
    .maybeSingle()
  if (error || !data) return json({ actionable: false })

  const resolution = data as { invite_id: string; opened_now: boolean }
  if (resolution.opened_now) {
    await audit(client, {
      event: 'tailor_claim.app_link_opened',
      actor_role: 'SYSTEM',
      severity: 'info',
      payload: { invite_id: resolution.invite_id },
    })
  }
  const { data: invite } = await client
    .from('tailor_claim_invites')
    .select('tailor_profile_id')
    .eq('id', resolution.invite_id)
    .maybeSingle()
  const [{ data: profile, error: profileError }, { data: media, error: mediaError }] =
    await Promise.all([
      client
        .from('tailor_profiles')
        .select(
          'display_name,bio,location,languages,specialty_tags,price_range_min,price_range_max,currency'
        )
        .eq('id', invite?.tailor_profile_id ?? '')
        .maybeSingle(),
      client
        .from('tailor_draft_media')
        .select('id,media_kind,sort_order,is_cover,storage_path')
        .eq('invite_id', resolution.invite_id)
        .eq('moderation_status', 'APPROVED')
        .not('confirmed_at', 'is', null)
        .order('sort_order')
        .order('created_at'),
    ])
  if (profileError || mediaError || !profile || !media?.length)
    return json({ actionable: false, retryable: true }, 503)
  const signed = await client.storage.from('tailor-draft-media').createSignedUrls(
    media.map((item) => item.storage_path),
    10 * 60
  )
  if (signed.error || !signed.data) return json({ actionable: false, retryable: true }, 503)
  return json({
    actionable: true,
    preview: {
      profile: {
        displayName: profile.display_name,
        bio: profile.bio,
        location: profile.location,
        languages: profile.languages,
        specialties: profile.specialty_tags,
        priceMin:
          typeof profile.price_range_min === 'number' ? profile.price_range_min / 100 : null,
        priceMax:
          typeof profile.price_range_max === 'number' ? profile.price_range_max / 100 : null,
        currency: profile.currency,
      },
      media: media.map((item, index) => ({
        id: `preview-${index}`,
        kind: item.media_kind,
        label:
          item.media_kind === 'AVATAR'
            ? 'Profile photo'
            : `${item.media_kind === 'VIDEO' ? 'Video' : 'Portfolio photo'} ${index + 1}`,
        cover: item.is_cover,
        previewUrl: signed.data[index]?.signedUrl ?? null,
      })),
    },
  })
})
