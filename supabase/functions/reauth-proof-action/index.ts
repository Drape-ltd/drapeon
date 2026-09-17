/**
 * reauth-proof-action
 *
 * Issues short-lived signed proofs that the current user confirmed their
 * password for a specific sensitive action. The proof is bound to the JWT user,
 * expires in five minutes, and is verified server-side by downstream functions.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { logPreflightFailure, preflightFailureResponse, runPreflight } from '../_shared/preflight.ts'
import { hasReauthProofSecret, issueReauthProof, REAUTH_PROOF_PURPOSES } from '../_shared/reauth-proof.ts'
import { checkRateLimit, getClientIp, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import {
  challengeCodeHash,
  constantTimeEqual,
  isChallengeCode,
  maskEmailAddress,
  randomChallengeCode,
} from '../_shared/challenge-code.ts'
import { normalizeDrapeonSender, renderDrapeonTransactionalEmail } from '../_shared/email-template.ts'
import { parseBody, z } from '../_shared/validate.ts'

const FN = 'reauth-proof-action'
const PROVIDER_REAUTH_WINDOW_SECONDS = 2 * 60
const EMAIL_CHALLENGE_TTL_MINUTES = 10
const EMAIL_CHALLENGE_MAX_ATTEMPTS = 5
const RESEND_API = 'https://api.resend.com/emails'

const PURPOSE_LABELS: Record<string, string> = {
  ACCOUNT_DELETION: 'delete your Drapeon account',
  EMAIL_CHANGE: 'change your account email',
  PASSWORD_CHANGE: 'change your password',
  PHONE_CHANGE: 'change your phone number',
  PAYOUT_ACCOUNT_CHANGE: 'change your payout account',
}

const BodySchema = z.object({
  action: z
    .enum(['issue-proof', 'issue-provider-proof', 'issue-email-challenge', 'verify-email-challenge'])
    .default('issue-proof'),
  purpose: z.enum(REAUTH_PROOF_PURPOSES),
  password: z.string().max(1024).optional(),
  provider: z.enum(['apple', 'google']).optional(),
  challengeId: z.string().uuid().optional(),
  code: z.string().trim().max(12).optional(),
})

function bearerClaims(req: Request): Record<string, unknown> | null {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim()
  const payload = token?.split('.')[1]
  if (!payload) return null
  try {
    const normalized = payload.replaceAll('-', '+').replaceAll('_', '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    return JSON.parse(atob(padded)) as Record<string, unknown>
  } catch {
    return null
  }
}

function claimProviders(claims: Record<string, unknown> | null) {
  const appMetadata = claims?.app_metadata
  const providers = appMetadata && typeof appMetadata === 'object'
    ? (appMetadata as Record<string, unknown>).providers
    : null
  return Array.isArray(providers)
    ? providers.filter((provider): provider is string => typeof provider === 'string')
    : []
}

function siteUrl() {
  return (Deno.env.get('SITE_URL') ?? Deno.env.get('NEXT_PUBLIC_SITE_URL') ?? 'https://drapeon.co')
    .replace(/\/+$/u, '')
}

function recipientName(user: { email?: string | null; user_metadata?: Record<string, unknown> | null }) {
  const metadata = user.user_metadata ?? {}
  const candidate = [metadata.display_name, metadata.full_name, metadata.name].find(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  )
  return candidate?.trim().split(/\s+/u)[0] ?? user.email?.split('@')[0] ?? 'there'
}

async function sendChallengeEmail(input: { to: string; code: string; purpose: string; name: string }) {
  const apiKey = Deno.env.get('RESEND_API_KEY')?.trim()
  if (!apiKey) return { accepted: false, providerReference: null }
  const intent = PURPOSE_LABELS[input.purpose] ?? 'confirm a sensitive account change'
  const email = renderDrapeonTransactionalEmail({
    preheader: `${input.code} is your Drapeon confirmation code. It expires in ${EMAIL_CHALLENGE_TTL_MINUTES} minutes.`,
    eyebrow: 'Account security',
    headline: 'Confirm this change',
    recipientName: input.name,
    body: `Someone asked to ${intent}. Enter this code only in Drapeon. If this was not you, ignore this email and nothing changes.`,
    verificationCode: input.code,
    verificationHint: `Expires in ${EMAIL_CHALLENGE_TTL_MINUTES} minutes. Never share this code.`,
    ctaLabel: 'Security help',
    ctaUrl: `${siteUrl()}/security`,
  })
  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'drapeon-reauth-proof/1.0',
    },
    body: JSON.stringify({
      from: normalizeDrapeonSender(Deno.env.get('RESEND_FROM'), 'Drapeon Security', 'security@drapeon.co'),
      to: [input.to],
      subject: `${input.code} is your Drapeon confirmation code`,
      html: email.html,
      text: email.text,
    }),
  })
  if (!response.ok) return { accepted: false, providerReference: null }
  const payload = await response.json().catch(() => ({})) as { id?: string }
  return { accepted: true, providerReference: payload.id ?? null }
}

function jsonResponse(payload: Record<string, unknown>, status: number, cors: HeadersInit) {
  if (typeof payload.error === 'string' && typeof payload.message !== 'string') {
    payload.message = payload.error
  }

  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const caller = await getAuthUser(req)
    if (!caller) {
      log('warn', FN, 'auth.unauthenticated')
      return jsonResponse({ error: 'Please sign in again before confirming your password.' }, 401, cors)
    }

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) {
      log('warn', FN, 'validation.failed', { actor_id: caller.id, error: parsed.error })
      return jsonResponse({ error: parsed.error }, 400, cors)
    }

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    const claims = bearerClaims(req)
    const clientIp = getClientIp(req)
    const allowed = await checkRateLimit(supabase, `${FN}:${caller.id}:${clientIp}`, 300, 5)
    if (!allowed) {
      await audit(supabase, {
        event: 'rate_limit.exceeded',
        actor_id: caller.id,
        severity: 'warn',
        payload: { function: FN, ip: clientIp, purpose: parsed.data.purpose },
      })
      return rateLimitExceededResponse(cors)
    }

    // ── Email-code re-authentication ──────────────────────────────────────
    // A tailor who signed up with Google or Apple has no password, so the
    // password path below can never succeed for them. A code sent to the
    // account email proves the same thing — that the person holding the
    // session also holds the account — at no messaging cost.
    if (parsed.data.action === 'issue-email-challenge') {
      if (!caller.email) {
        return jsonResponse(
          { error: 'This account has no email address to send a confirmation code to. Contact support.' },
          400,
          cors,
        )
      }
      if (!hasReauthProofSecret()) {
        return jsonResponse(
          { error: 'Drapeon could not start this confirmation. Try again in a moment.' },
          503,
          cors,
        )
      }

      // One live challenge per purpose: a new request retires the previous code.
      await supabase
        .from('auth_reauth_challenges')
        .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
        .eq('user_id', caller.id)
        .eq('purpose', parsed.data.purpose)
        .eq('status', 'PENDING')

      const challengeId = crypto.randomUUID()
      const code = randomChallengeCode()
      const expiresAt = new Date(Date.now() + EMAIL_CHALLENGE_TTL_MINUTES * 60_000)
      const { error: insertError } = await supabase.from('auth_reauth_challenges').insert({
        id: challengeId,
        user_id: caller.id,
        purpose: parsed.data.purpose,
        code_hash: await challengeCodeHash(challengeId, caller.id, code),
        expires_at: expiresAt.toISOString(),
      })
      if (insertError) {
        log('error', FN, 'email_challenge.insert_failed', {
          actor_id: caller.id,
          error: insertError.message,
        })
        return jsonResponse({ error: 'We could not send a confirmation code. Please try again.' }, 500, cors)
      }

      const delivery = await sendChallengeEmail({
        to: caller.email,
        code,
        purpose: parsed.data.purpose,
        name: recipientName(caller),
      })
      await supabase
        .from('auth_reauth_challenges')
        .update({
          delivery_status: delivery.accepted ? 'ACCEPTED' : 'FAILED',
          provider: 'RESEND',
          provider_reference: delivery.providerReference,
          updated_at: new Date().toISOString(),
        })
        .eq('id', challengeId)

      if (!delivery.accepted) {
        return jsonResponse(
          { error: 'We could not send the confirmation code. Check your connection and try again.' },
          502,
          cors,
        )
      }

      await audit(supabase, {
        event: 'reauth_proof.email_challenge_sent',
        actor_id: caller.id,
        severity: 'info',
        payload: { function: FN, purpose: parsed.data.purpose, challenge_id: challengeId },
      })

      return jsonResponse(
        {
          ok: true,
          challengeId,
          maskedEmail: maskEmailAddress(caller.email),
          expiresAt: expiresAt.toISOString(),
        },
        200,
        cors,
      )
    }

    if (parsed.data.action === 'verify-email-challenge') {
      if (!parsed.data.challengeId || !isChallengeCode(parsed.data.code ?? '')) {
        return jsonResponse({ error: 'Enter the six-digit code from your email.' }, 400, cors)
      }
      const { data: challenge } = await supabase
        .from('auth_reauth_challenges')
        .select('id, user_id, purpose, code_hash, status, attempts, expires_at')
        .eq('id', parsed.data.challengeId)
        .eq('user_id', caller.id)
        .eq('purpose', parsed.data.purpose)
        .maybeSingle()

      if (!challenge || challenge.status !== 'PENDING') {
        return jsonResponse({ error: 'That code is no longer valid. Send a new one.' }, 410, cors)
      }
      if (new Date(String(challenge.expires_at)).getTime() <= Date.now()) {
        await supabase
          .from('auth_reauth_challenges')
          .update({ status: 'EXPIRED', updated_at: new Date().toISOString() })
          .eq('id', challenge.id)
        return jsonResponse({ error: 'That code expired. Send a new one.' }, 410, cors)
      }

      const attempts = Number(challenge.attempts ?? 0) + 1
      const candidate = await challengeCodeHash(challenge.id, caller.id, (parsed.data.code ?? '').trim())
      if (!constantTimeEqual(candidate, String(challenge.code_hash))) {
        const locked = attempts >= EMAIL_CHALLENGE_MAX_ATTEMPTS
        await supabase
          .from('auth_reauth_challenges')
          .update({
            attempts,
            status: locked ? 'LOCKED' : 'PENDING',
            updated_at: new Date().toISOString(),
          })
          .eq('id', challenge.id)
        await audit(supabase, {
          event: 'reauth_proof.email_challenge_failed',
          actor_id: caller.id,
          severity: locked ? 'warn' : 'info',
          payload: { function: FN, purpose: parsed.data.purpose, challenge_id: challenge.id, attempts },
        })
        return jsonResponse(
          {
            error: locked
              ? 'Too many incorrect codes. Send a new code to try again.'
              : 'That code is incorrect.',
            attemptsRemaining: Math.max(0, EMAIL_CHALLENGE_MAX_ATTEMPTS - attempts),
          },
          locked ? 423 : 400,
          cors,
        )
      }

      await supabase
        .from('auth_reauth_challenges')
        .update({
          attempts,
          status: 'VERIFIED',
          verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', challenge.id)

      const verified = await issueReauthProof({ userId: caller.id, purpose: parsed.data.purpose })
      await audit(supabase, {
        event: 'reauth_proof.issued',
        actor_id: caller.id,
        severity: 'info',
        payload: {
          function: FN,
          purpose: parsed.data.purpose,
          method: 'email_code',
          issued_at: new Date(verified.payload.issuedAt).toISOString(),
          expires_at: new Date(verified.payload.expiresAt).toISOString(),
        },
      })

      return jsonResponse(
        {
          ok: true,
          proof: verified.proof,
          purpose: verified.payload.purpose,
          issuedAt: new Date(verified.payload.issuedAt).toISOString(),
          expiresAt: new Date(verified.payload.expiresAt).toISOString(),
        },
        200,
        cors,
      )
    }

    const providerProof = parsed.data.action === 'issue-provider-proof'
    const emailPreflight = runPreflight([
      {
        name: providerProof ? 'user_has_provider_identity' : 'user_has_email_password_identity',
        condition: providerProof
          ? !!parsed.data.provider && claimProviders(claims).includes(parsed.data.provider)
          : !!caller.email && !!parsed.data.password,
        errorCode: 'REAUTH_EMAIL_REQUIRED',
        message: providerProof
          ? 'Sign in with the provider connected to this account before continuing.'
          : 'This account needs an email and password before this action can continue.',
        field: providerProof ? 'provider' : 'email',
        severity: 'BLOCKING',
        actual: { hasEmail: !!caller.email, provider: parsed.data.provider ?? null },
      },
    ])

    if (!emailPreflight.passed) {
      await logPreflightFailure(supabase, emailPreflight, {
        operation: 'issue_reauth_proof',
        entityType: 'user',
        entityId: caller.id,
        actorId: caller.id,
        userId: caller.id,
        source: FN,
        metadata: { purpose: parsed.data.purpose },
      })
      return preflightFailureResponse(emailPreflight, cors, 400)
    }

    const secretPreflight = runPreflight([
      {
        name: 'reauth_signing_secret_configured',
        condition: hasReauthProofSecret(),
        errorCode: 'REAUTH_PROOF_SECRET_MISSING',
        message: 'Drapeon could not verify your recent password confirmation. Try again in a moment.',
        field: 'reauthProof',
        severity: 'BLOCKING',
      },
    ])

    if (!secretPreflight.passed) {
      await logPreflightFailure(supabase, secretPreflight, {
        operation: 'issue_reauth_proof',
        entityType: 'user',
        entityId: caller.id,
        actorId: caller.id,
        userId: caller.id,
        source: FN,
        metadata: { purpose: parsed.data.purpose },
      })
      return preflightFailureResponse(secretPreflight, cors, 503)
    }

    let verificationPassed = false
    let verificationCode = 'REAUTH_USER_MISMATCH'
    let verificationMessage = 'Confirm your identity again before continuing.'
    let verificationActual: Record<string, unknown> = {}

    if (providerProof) {
      const issuedAt = typeof claims?.iat === 'number' ? claims.iat : null
      const subject = typeof claims?.sub === 'string' ? claims.sub : null
      const ageSeconds = issuedAt == null ? null : Math.floor(Date.now() / 1000) - issuedAt
      verificationPassed = subject === caller.id && ageSeconds != null && ageSeconds >= -30 && ageSeconds <= PROVIDER_REAUTH_WINDOW_SECONDS
      verificationCode = verificationPassed ? '' : 'REAUTH_PROVIDER_SESSION_STALE'
      verificationMessage = 'Complete a fresh provider sign-in before continuing.'
      verificationActual = { provider: parsed.data.provider, issuedAt, ageSeconds, subjectMatches: subject === caller.id }
    } else {
      // This is an authenticated, rate-limited server-side password check. Use the
      // service credential so global Auth CAPTCHA does not turn every sensitive
      // in-account action into a second public sign-in challenge. GoTrue still
      // validates the submitted password; the service key never leaves Edge.
      const authClient = createClient(getSupabaseUrl(), getServiceRoleKey(), {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const { data: passwordData, error: passwordError } = await authClient.auth.signInWithPassword({
        email: caller.email!,
        password: parsed.data.password!,
      })
      verificationPassed = !passwordError && passwordData.user?.id === caller.id
      verificationCode = passwordError ? 'REAUTH_PASSWORD_INCORRECT' : 'REAUTH_USER_MISMATCH'
      verificationMessage = passwordError ? 'Incorrect password. Try again.' : 'Confirm your password again before continuing.'
      verificationActual = {
        authError: passwordError?.message ?? null,
        signedInUserId: passwordData.user?.id ?? null,
        expectedUserId: caller.id,
      }
    }

    const passwordPreflight = runPreflight([
      {
        name: providerProof ? 'provider_verified_for_current_user' : 'password_verified_for_current_user',
        condition: verificationPassed,
        errorCode: verificationCode,
        message: verificationMessage,
        field: providerProof ? 'provider' : 'password',
        severity: 'BLOCKING',
        actual: verificationActual,
      },
    ])

    if (!passwordPreflight.passed) {
      await logPreflightFailure(supabase, passwordPreflight, {
        operation: 'issue_reauth_proof',
        entityType: 'user',
        entityId: caller.id,
        actorId: caller.id,
        userId: caller.id,
        source: FN,
        metadata: { purpose: parsed.data.purpose, ip: clientIp },
      })
      return preflightFailureResponse(passwordPreflight, cors, 401)
    }

    const { proof, payload } = await issueReauthProof({
      userId: caller.id,
      purpose: parsed.data.purpose,
    })

    await audit(supabase, {
      event: 'reauth_proof.issued',
      actor_id: caller.id,
      severity: 'info',
      payload: {
        function: FN,
        purpose: parsed.data.purpose,
        method: providerProof ? parsed.data.provider : 'password',
        issued_at: new Date(payload.issuedAt).toISOString(),
        expires_at: new Date(payload.expiresAt).toISOString(),
      },
    })

    return jsonResponse({
      ok: true,
      proof,
      purpose: payload.purpose,
      issuedAt: new Date(payload.issuedAt).toISOString(),
      expiresAt: new Date(payload.expiresAt).toISOString(),
    }, 200, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return jsonResponse({ error: 'We could not confirm your password right now. Please try again.' }, 500, cors)
  }
})
