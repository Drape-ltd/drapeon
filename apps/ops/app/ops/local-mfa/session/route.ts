import { NextResponse } from 'next/server'
import {
  createLocalSupabaseAuthClient,
  isLocalSupabaseMfaEnabled,
  OPS_SUPABASE_ACCESS_COOKIE,
  OPS_SUPABASE_REFRESH_COOKIE,
} from '../../../../../web/lib/local-supabase-mfa'
import { validateOpsMutationOrigin } from '../../../../../web/lib/ops-request-security'
import { createServiceRoleClient } from '../../../../../web/lib/server-supabase'
import { requiredCaptchaToken } from '../../../../lib/local-mfa-captcha.mjs'
import { restoreLocalMfaSession } from '../../../../lib/local-mfa-session-refresh.mjs'

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store, max-age=0', 'X-Robots-Tag': 'noindex, nofollow, noarchive' } })
}

function setSessionCookies(result: NextResponse, session: { access_token: string; refresh_token: string; expires_in?: number }) {
  const options = { httpOnly: true, sameSite: 'strict' as const, secure: false, path: '/', maxAge: session.expires_in ?? 3600 }
  result.cookies.set(OPS_SUPABASE_ACCESS_COOKIE, session.access_token, options)
  result.cookies.set(OPS_SUPABASE_REFRESH_COOKIE, session.refresh_token, { ...options, maxAge: 60 * 60 * 24 * 7 })
}

async function bindApprovedPrincipal(authUserId: string) {
  const service = createServiceRoleClient()
  if (!service) return false
  const { error } = await service.rpc('bind_dev_ops_mfa_principal', { p_auth_user_id: authUserId })
  return !error
}

export async function POST(request: Request) {
  if (!isLocalSupabaseMfaEnabled()) return response({ ok: false, error: 'Not found.' }, 404)
  if (!validateOpsMutationOrigin(request).ok) return response({ ok: false, error: 'invalid-origin' }, 403)
  const form = await request.formData()
  const action = String(form.get('action') ?? '')
  const client = createLocalSupabaseAuthClient()
  if (!client) return response({ ok: false, error: 'Dev Auth is unavailable.' }, 503)

  if (action === 'sign-in' || action === 'sign-up') {
    const email = String(form.get('email') ?? '').trim().toLowerCase()
    const password = String(form.get('password') ?? '')
    const captchaToken = requiredCaptchaToken(form)
    if (!['founders@drapeon.co', 'founders+ops-qa@drapeon.co'].includes(email)) return response({ ok: false, error: 'This is not an approved Dev QA identity.' }, 403)
    if (!captchaToken) return response({ ok: false, error: 'Complete the security check before continuing.' }, 400)
    if (action === 'sign-up') {
      const { data, error } = await client.auth.signUp({ email, password, options: { captchaToken } })
      if (error) return response({ ok: false, error: 'The Dev Auth user could not be created.' }, 409)
      if (!data.session) return response({ ok: true, needsMfa: true, message: 'Account created. Complete any email confirmation, then sign in.' })
      const result = response({ ok: true, needsMfa: true, message: 'Account created. Enroll a separate TOTP factor.' })
      if (!data.user || !await bindApprovedPrincipal(data.user.id)) return response({ ok: false, error: 'The Auth user could not be bound to its Dev workforce principal.' }, 409)
      setSessionCookies(result, data.session)
      return result
    }
    const { data, error } = await client.auth.signInWithPassword({ email, password, options: { captchaToken } })
    if (error || !data.session) return response({ ok: false, error: 'Sign-in failed.' }, 401)
    if (!data.user || !await bindApprovedPrincipal(data.user.id)) return response({ ok: false, error: 'The Auth user is not bound to an active Dev workforce principal.' }, 403)
    const factors = await client.auth.mfa.listFactors()
    const factorId = factors.data?.totp.find((factor) => factor.status === 'verified')?.id
    const result = response({ ok: true, needsMfa: true, factorId, message: 'Password verified. Enroll or verify the separate TOTP factor.' })
    setSessionCookies(result, data.session)
    return result
  }

  const cookieHeader = request.headers.get('cookie') ?? ''
  const accessToken = cookieHeader.match(new RegExp(`(?:^|; )${OPS_SUPABASE_ACCESS_COOKIE}=([^;]+)`))?.[1]
  const refreshToken = cookieHeader.match(new RegExp(`(?:^|; )${OPS_SUPABASE_REFRESH_COOKIE}=([^;]+)`))?.[1]
  if (!refreshToken) return response({ ok: false, error: 'Sign in first.' }, 401)
  const restored = await restoreLocalMfaSession(client.auth, {
    accessToken: accessToken ? decodeURIComponent(accessToken) : null,
    refreshToken: decodeURIComponent(refreshToken),
  })
  if (!restored.session) return response({ ok: false, error: 'The Auth session expired. Sign in again.' }, 401)

  if (action === 'enroll') {
    const { data, error } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Drapeon Ops QA ${Date.now()}` })
    if (error) return response({ ok: false, error: 'TOTP enrollment could not start.' }, 409)
    const result = response({ ok: true, factorId: data.id, qrCode: data.totp.qr_code })
    if (restored.refreshed) setSessionCookies(result, restored.session)
    return result
  }
  if (action === 'verify') {
    const factorId = String(form.get('factorId') ?? '').trim()
    const code = String(form.get('code') ?? '').trim()
    const { data, error } = await client.auth.mfa.challengeAndVerify({ factorId, code })
    if (error || !data) return response({ ok: false, error: 'The authenticator code was not accepted.' }, 401)
    const refreshed = await client.auth.refreshSession()
    if (refreshed.error || !refreshed.data.session) return response({ ok: false, error: 'MFA succeeded but the session could not refresh.' }, 409)
    const result = response({ ok: true })
    setSessionCookies(result, refreshed.data.session)
    return result
  }
  return response({ ok: false, error: 'Invalid action.' }, 400)
}
