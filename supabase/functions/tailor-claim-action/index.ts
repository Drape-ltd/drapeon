import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { getClientIp, rateLimit } from '../_shared/rateLimit.ts'
import { audit } from '../_shared/logger.ts'
import { normalizeDrapeonSender, renderDrapeonTransactionalEmail } from '../_shared/email-template.ts'

const FN = 'tailor-claim-action'
const tokenPattern = /^[A-Za-z0-9_-]{40,60}$/u
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u
const codePattern = /^\d{6}$/u
const encoder = new TextEncoder()

function base64url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')
}

async function tokenHash(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return base64url(new Uint8Array(digest))
}

function getClaimHmacKey() {
  const key = Deno.env.get('TAILOR_CLAIM_HMAC_KEY')?.trim()
  if (!key || key.length < 32) throw new Error('TAILOR_CLAIM_HMAC_KEY must contain at least 32 characters.')
  return key
}

async function keyedHash(value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(getClaimHmacKey()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
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
  )?.trim().replace(/\/$/u, '')
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
  const result = await response.json().catch(() => ({})) as { id?: string }
  return response.ok
    ? { accepted: true as const, provider: 'RESEND', providerReference: result.id ?? null }
    : { accepted: false as const, failureCode: `RESEND_${response.status}` }
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
  if (raw.length > 2_000) return json({ actionable: false }, 400)

  let body: { action?: unknown; token?: unknown; email?: unknown; code?: unknown }
  try {
    body = JSON.parse(raw)
  } catch {
    return json({ actionable: false }, 400)
  }
  const action = typeof body.action === 'string' ? body.action : ''
  if (!['RESOLVE', 'REQUEST_EMAIL_CODE', 'VERIFY_EMAIL_CODE'].includes(action)
      || typeof body.token !== 'string' || !tokenPattern.test(body.token))
    return json({ actionable: false })

  const client = createClient(getSupabaseUrl(), getServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const ip = getClientIp(request)
  const hash = await tokenHash(body.token)
  const ipLimit = await rateLimit(client, ip, `${FN}:${action.toLowerCase()}:ip`, 30, 10 * 60_000, { ip })
  if (!ipLimit.allowed) return json({ actionable: false }, 429, ipLimit.retryAfter)
  const tokenLimit = await rateLimit(client, hash, `${FN}:${action.toLowerCase()}:token`, 20, 10 * 60_000, { ip })
  if (!tokenLimit.allowed) return json({ actionable: false }, 429, tokenLimit.retryAfter)

  if (action === 'REQUEST_EMAIL_CODE') {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!emailPattern.test(email) || email.length > 320) return json({ sent: false, error: 'INVALID_EMAIL' }, 400)
    const emailDigest = await emailHash(email)
    const code = randomEmailCode()
    const codeDigest = await codeHash(hash, emailDigest, code)
    const { data: issued, error: issueError } = await client.rpc('issue_tailor_claim_email_code', {
      p_token_hash: hash,
      p_email_hash: emailDigest,
      p_code_hash: codeDigest,
    }).maybeSingle()
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
    const { data: recorded, error: recordError } = await client.rpc('record_tailor_claim_email_job_outcome', {
      p_job_id: issue.job_id,
      p_accepted: outcome.accepted,
      p_provider: outcome.accepted ? outcome.provider : null,
      p_provider_reference: outcome.accepted ? outcome.providerReference : null,
      p_failure_code: outcome.accepted ? null : outcome.failureCode,
    })
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
    const { data: verified, error: verifyError } = await client.rpc('verify_tailor_claim_email_code', {
      p_token_hash: hash,
      p_email: email,
      p_email_hash: emailDigest,
      p_code_hash: codeDigest,
    }).maybeSingle()
    if (verifyError || !verified) return json({ verified: false, retryable: true }, 503)
    const verification = verified as { result: string; invite_id: string | null }
    if (verification.result === 'EMAIL_LOCKED') return json({ verified: false, error: 'EMAIL_LOCKED' }, 429)
    if (verification.result === 'ACCOUNT_CONFLICT')
      return json({ verified: false, error: 'ACCOUNT_CONFLICT' }, 409)
    if (verification.result !== 'VERIFIED')
      return json({ verified: false, error: verification.result === 'CODE_EXPIRED' ? 'CODE_EXPIRED' : 'INVALID_CODE' }, 400)
    await audit(client, {
      event: 'tailor_claim.email_verified',
      actor_role: 'SYSTEM',
      payload: { invite_id: verification.invite_id },
    })
    return json({ verified: true })
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
