import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getOpsSession, hasFreshOpsMfa, isNamedOpsWorkforceSession } from '../../../../lib/ops-session'
import { validateOpsMutationOrigin } from '../../../../../web/lib/ops-request-security'
import { createServiceRoleClient } from '../../../../../web/lib/server-supabase'
import { isRestrictedOpsPhoneHeaders } from '../../../../lib/client-surface'
import { resolveLocalWorkforcePrincipal } from '../../../../lib/local-workforce-principal'
import { DispatchCommandError, executeOpsDispatchCommand } from '../../../../../../supabase/functions/_shared/ops-dispatch-execution'

export const dynamic = 'force-dynamic'
const json = (body: Record<string, unknown>, status: number) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })

export async function POST(request: Request) {
  const correlationId = request.headers.get('x-correlation-id')?.trim() || randomUUID()
  if (!validateOpsMutationOrigin(request).ok || isRestrictedOpsPhoneHeaders(request.headers)) return json({ ok: false, error: 'protected-desktop-origin-required', correlationId }, 403)
  const session = await getOpsSession(request)
  if (!session?.allowed || !session.email || !isNamedOpsWorkforceSession(session) || !['admin', 'ops'].includes(session.role)) return json({ ok: false, error: 'named-ops-session-required', correlationId }, 401)
  if (!hasFreshOpsMfa(session)) return json({ ok: false, error: 'fresh-mfa-assurance-required', correlationId }, 401)
  const form = await request.formData().catch(() => null)
  if (!form) return json({ ok: false, error: 'invalid-form', correlationId }, 400)
  if (session.mode === 'cloudflare-access') {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()?.replace(/\/+$/u, '')
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? process.env.SUPABASE_ANON_KEY?.trim()
    const assertion = request.headers.get('cf-access-jwt-assertion')?.trim()
    if (!url || !key || !assertion) return json({ ok: false, error: 'dispatch-broker-unavailable', correlationId }, 503)
    try {
      const response = await fetch(`${url}/functions/v1/ops-dispatch-action`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'x-drape-ops-access-assertion': assertion, 'x-correlation-id': correlationId }, body: form, cache: 'no-store', signal: AbortSignal.timeout(20_000) })
      return json(await response.json() as Record<string, unknown>, response.status)
    } catch { return json({ ok: false, error: 'dispatch-broker-interrupted', correlationId }, 502) }
  }
  const local = await resolveLocalWorkforcePrincipal(session)
  const client = createServiceRoleClient()
  if (!local || !client) return json({ ok: false, error: 'development-operator-unavailable', correlationId }, 403)
  try {
    const result = await executeOpsDispatchCommand(client, { principalId: local.principal.id, label: session.email, role: session.role as 'admin' | 'ops' }, form)
    return json({ ...result, correlationId }, 200)
  } catch (error) {
    if (error instanceof DispatchCommandError) return json({ ok: false, error: error.code, message: error.message, correlationId }, error.status)
    return json({ ok: false, error: 'dispatch-command-failed', correlationId }, 500)
  }
}
