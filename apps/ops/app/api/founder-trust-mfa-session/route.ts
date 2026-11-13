import { randomUUID } from 'node:crypto'
import { type Session } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import {
  FOUNDER_TRUST_ACCESS_COOKIE,
  FOUNDER_TRUST_EMAIL,
  FOUNDER_TRUST_REFRESH_COOKIE,
  createFounderTrustAuthClient,
  getFounderTrustFallbackBinding,
  isFounderTrustMfaRuntime,
  recordFounderTrustMfaEvent,
} from '../../../../web/lib/founder-trust-mfa'
import { sanitizeOpsRedirect, validateOpsMutationOrigin } from '../../../../web/lib/ops-request-security'
import { getTurnstileSiteKey } from '../../../../web/lib/supabase-config'
import { getOpsSession } from '../../../lib/ops-session'
import { restoreLocalMfaSession } from '../../../lib/local-mfa-session-refresh.mjs'

export const dynamic = 'force-dynamic'

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    },
  })
}

function setSessionCookies(result: NextResponse, session: Session) {
  const options = {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: true,
    path: '/',
    maxAge: Math.min(session.expires_in ?? 900, 900),
  }
  result.cookies.set(FOUNDER_TRUST_ACCESS_COOKIE, session.access_token, options)
  result.cookies.set(FOUNDER_TRUST_REFRESH_COOKIE, session.refresh_token, options)
}

function clearSessionCookies(result: NextResponse) {
  result.cookies.set(FOUNDER_TRUST_ACCESS_COOKIE, '', { path: '/', maxAge: 0 })
  result.cookies.set(FOUNDER_TRUST_REFRESH_COOKIE, '', { path: '/', maxAge: 0 })
}

export async function POST(request: NextRequest) {
  if (!isFounderTrustMfaRuntime()) return response({ error: 'Not found.' }, 404)
  if (!getTurnstileSiteKey()) return response({ error: 'Founder security verification is unavailable.' }, 503)
  if (!validateOpsMutationOrigin(request).ok) return response({ error: 'invalid-origin' }, 403)
  const [session, binding] = await Promise.all([getOpsSession(request), getFounderTrustFallbackBinding()])
  if (
    !session?.allowed
    || session.mode !== 'cloudflare-access'
    || session.role !== 'admin'
    || session.email !== FOUNDER_TRUST_EMAIL
    || !session.principalId
    || !binding
    || binding.principal_id !== session.principalId
  ) return response({ error: 'Founder trust step-up is unavailable.' }, 403)

  const form = await request.formData()
  const action = String(form.get('action') ?? '')
  const returnTo = sanitizeOpsRedirect(request, form.get('returnTo'))
  const client = createFounderTrustAuthClient()
  if (!client) return response({ error: 'Founder Auth is unavailable.' }, 503)

  if (action === 'sign-in') {
    const password = String(form.get('password') ?? '')
    const captchaToken = String(form.get('captchaToken') ?? '').trim()
    if (!captchaToken) return response({ error: 'Complete the bot check first.' }, 400)
    const { data, error } = await client.auth.signInWithPassword({
      email: FOUNDER_TRUST_EMAIL,
      password,
      ...(captchaToken ? { options: { captchaToken } } : {}),
    })
    if (
      error
      || !data.session
      || !data.user
      || data.user.id !== binding.auth_user_id
      || data.user.email?.trim().toLowerCase() !== FOUNDER_TRUST_EMAIL
    ) {
      await recordFounderTrustMfaEvent({
        workforceSession: session,
        authUserId: binding.auth_user_id,
        eventType: 'SIGN_IN_ATTEMPTED',
        outcome: 'FAILED',
        correlationId: randomUUID(),
        reasonCode: error?.code === 'captcha_failed' ? 'CAPTCHA_FAILED' : 'SIGN_IN_FAILED',
      })
      return response({ error: error?.code === 'captcha_failed' ? 'The bot check expired. Try again.' : 'Founder sign-in failed.' }, 401)
    }
    const factors = await client.auth.mfa.listFactors()
    const factorId = factors.data?.totp.find((factor) => factor.status === 'verified')?.id
    const correlationId = randomUUID()
    const audited = await recordFounderTrustMfaEvent({
      workforceSession: session,
      authUserId: data.user.id,
      eventType: 'SIGN_IN_ATTEMPTED',
      outcome: 'SUCCEEDED',
      correlationId,
    })
    if (!audited) return response({ error: 'Founder sign-in could not be audited.' }, 503)
    const result = response({
      ok: true,
      factorId,
      message: factorId ? 'Password verified. Enter the founder authenticator code.' : 'Password verified. Set up the founder authenticator.',
    })
    setSessionCookies(result, data.session)
    return result
  }

  const accessToken = request.cookies.get(FOUNDER_TRUST_ACCESS_COOKIE)?.value ?? null
  const refreshToken = request.cookies.get(FOUNDER_TRUST_REFRESH_COOKIE)?.value ?? null
  if (!refreshToken) return response({ error: 'Sign in again.' }, 401)
  const restored = await restoreLocalMfaSession(client.auth, { accessToken, refreshToken })
  if (!restored.session || restored.session.user.id !== binding.auth_user_id) {
    const result = response({ error: 'The founder Auth session expired. Sign in again.' }, 401)
    clearSessionCookies(result)
    return result
  }

  if (action === 'enroll') {
    const factors = await client.auth.mfa.listFactors()
    const existing = factors.data?.totp.find((factor) => factor.status === 'verified')
    if (existing) {
      const result = response({ ok: true, factorId: existing.id, message: 'Use the existing founder authenticator.' })
      if (restored.refreshed) setSessionCookies(result, restored.session)
      return result
    }
    const { data, error } = await client.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `Drapeon founder trust fallback ${new Date().toISOString().slice(0, 10)}`,
    })
    if (error) return response({ error: 'Authenticator enrollment could not start.' }, 409)
    const audited = await recordFounderTrustMfaEvent({
      workforceSession: session,
      authUserId: binding.auth_user_id,
      eventType: 'TOTP_ENROLLMENT_STARTED',
      outcome: 'SUCCEEDED',
      correlationId: randomUUID(),
    })
    if (!audited) return response({ error: 'Authenticator enrollment could not be audited.' }, 503)
    const result = response({ ok: true, factorId: data.id, qrCode: data.totp.qr_code })
    if (restored.refreshed) setSessionCookies(result, restored.session)
    return result
  }

  if (action === 'verify') {
    const factorId = String(form.get('factorId') ?? '').trim()
    const code = String(form.get('code') ?? '').trim()
    if (!factorId || !/^[0-9]{6}$/u.test(code)) return response({ error: 'Enter the six-digit authenticator code.' }, 400)
    const factors = await client.auth.mfa.listFactors()
    const ownsFactor = factors.data?.totp.some((factor) => factor.id === factorId)
    if (!ownsFactor) return response({ error: 'The authenticator factor does not belong to this founder account.' }, 403)
    const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code })
    if (error) {
      await recordFounderTrustMfaEvent({
        workforceSession: session,
        authUserId: binding.auth_user_id,
        eventType: 'TOTP_VERIFICATION_ATTEMPTED',
        outcome: 'FAILED',
        correlationId: randomUUID(),
        reasonCode: 'TOTP_REJECTED',
      })
      return response({ error: 'The authenticator code was not accepted.' }, 401)
    }
    const refreshed = await client.auth.refreshSession()
    if (refreshed.error || !refreshed.data.session) return response({ error: 'MFA succeeded but the protected session could not refresh.' }, 409)
    const mfaAuthenticatedAt = Math.floor(Date.now() / 1000)
    const audited = await recordFounderTrustMfaEvent({
      workforceSession: session,
      authUserId: binding.auth_user_id,
      eventType: 'TOTP_VERIFICATION_ATTEMPTED',
      outcome: 'SUCCEEDED',
      correlationId: randomUUID(),
      mfaAuthenticatedAt,
    })
    if (!audited) return response({ error: 'MFA succeeded but could not be audited.' }, 503)
    const result = response({ ok: true, redirectTo: `${returnTo}${returnTo.includes('?') ? '&' : '?'}protected=verified` })
    setSessionCookies(result, refreshed.data.session)
    return result
  }

  return response({ error: 'Invalid action.' }, 400)
}
