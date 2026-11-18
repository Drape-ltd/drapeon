import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseAnonKey, getSupabaseUrl } from '../_shared/env.ts'
import { getClientIp, rateLimit } from '../_shared/rateLimit.ts'
import { audit } from '../_shared/logger.ts'
import {
  normalizeDrapeonSender,
  renderDrapeonTransactionalEmail,
} from '../_shared/email-template.ts'
import { getActiveStaffDraftClaimSession } from '../_shared/auth.ts'
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@6.1.2'

const FN = 'tailor-claim-action'
const tokenPattern = /^[A-Za-z0-9_-]{40,60}$/u
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u
const codePattern = /^\d{6}$/u
const encoder = new TextEncoder()
const appleJwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'))
const googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))

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
  return { subject: payload.sub, nonceDigest }
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
    ].includes(action) ||
    typeof body.token !== 'string' ||
    !tokenPattern.test(body.token)
  )
    return json({ actionable: false })

  const client = createClient(getSupabaseUrl(), getServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const ip = getClientIp(request)
  const hash = await tokenHash(body.token)
  const ipLimit = await rateLimit(client, ip, `${FN}:${action.toLowerCase()}:ip`, 30, 10 * 60_000, {
    ip,
  })
  if (!ipLimit.allowed) return json({ actionable: false }, 429, ipLimit.retryAfter)
  const tokenLimit = await rateLimit(
    client,
    hash,
    `${FN}:${action.toLowerCase()}:token`,
    20,
    10 * 60_000,
    { ip }
  )
  if (!tokenLimit.allowed) return json({ actionable: false }, 429, tokenLimit.retryAfter)

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
    } catch {
      await client.rpc('fail_tailor_claim_provider_bootstrap_session', {
        p_session_id: proofId,
        p_failure_code: 'PROVIDER_PROOF_INVALID',
      })
      return json({ bootstrapped: false, error: 'PROVIDER_PROOF_INVALID' }, 401)
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
    if (recordError || !recorded) return json({ bootstrapped: false, retryable: true }, 503)
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
      return json({ bootstrapped: false, retryable: true }, 503)
    }
  }

  if (action === 'VERIFY_LINKED_PROVIDER') {
    const provider = body.provider === 'apple' || body.provider === 'google' ? body.provider : null
    if (!provider) return json({ verified: false, error: 'INVALID_PROVIDER_PROOF' }, 400)

    const claimSession = await getActiveStaffDraftClaimSession(request)
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
    const linkedIdentity = authUser.user?.identities?.find(
      (identity) =>
        identity.provider === provider &&
        identity.user_id === claimSession.userId &&
        identity.identity_data?.sub === ledger.provider_subject
    )
    if (authUserError || !linkedIdentity) {
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
    if (!provider) return json({ recorded: false }, 400)
    const claimSession = await getActiveStaffDraftClaimSession(request)
    if (!claimSession) return json({ recorded: false, error: 'CLAIM_SESSION_EXPIRED' }, 401)
    const { data: failed, error: failError } = await client.rpc(
      'fail_tailor_claim_provider_bootstrap_session',
      { p_session_id: claimSession.claimSessionId, p_failure_code: 'ACCOUNT_CONFLICT' }
    )
    if (failError || failed !== true) return json({ recorded: false, retryable: true }, 503)
    return json({ recorded: true, error: 'ACCOUNT_CONFLICT' }, 409)
  }

  if (action === 'FAIL_PROVIDER_SESSION') {
    const provider = body.provider === 'apple' || body.provider === 'google' ? body.provider : null
    if (!provider) return json({ recorded: false }, 400)
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
    if (failError || failed !== true) return json({ recorded: false, retryable: true }, 503)
    return json({ recorded: true })
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
    if (prepareError || !prepared) return json({ bootstrapped: false, retryable: true }, 503)
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
      return json({ bootstrapped: false, retryable: true }, 503)
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
  return json({ actionable: true })
})
