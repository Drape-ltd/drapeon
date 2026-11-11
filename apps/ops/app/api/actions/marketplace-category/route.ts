import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getOpsSession, hasFreshOpsMfa, isNamedOpsWorkforceSession } from '../../../../lib/ops-session'
import { validateOpsMutationOrigin } from '../../../../../web/lib/ops-request-security'
import { createServiceRoleClient } from '../../../../../web/lib/server-supabase'
import { isRestrictedOpsPhoneHeaders } from '../../../../lib/client-surface'

export const dynamic = 'force-dynamic'
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })

export async function POST(request: Request) {
  if (!validateOpsMutationOrigin(request).ok || isRestrictedOpsPhoneHeaders(request.headers)) return json({ error: 'Protected desktop origin required.' }, 403)
  const session = await getOpsSession()
  if (!session?.allowed || !session.email || !isNamedOpsWorkforceSession(session) || !hasFreshOpsMfa(session)) return json({ error: 'Fresh named workforce session required.' }, 401)
  if (!['admin', 'trust'].includes(session.role)) return json({ error: 'Admin or trust role required.' }, 403)
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const profileId = typeof body?.profileId === 'string' ? body.profileId.trim() : ''
  const category = typeof body?.category === 'string' ? body.category.trim().toUpperCase() : ''
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
  const idempotencyKey = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey.trim() : randomUUID()
  if (!/^[0-9a-f-]{36}$/iu.test(profileId) || !['TAILORING', 'STREETWEAR'].includes(category) || reason.length < 12 || reason.length > 500) return json({ error: 'A valid profile, section, and reason of 12–500 characters are required.' }, 400)
  const client = createServiceRoleClient()
  if (!client) return json({ error: 'Marketplace category service unavailable.' }, 503)
  const { data, error } = await client.rpc('ops_set_marketplace_category', { p_tailor_profile_id: profileId, p_category: category, p_reason: reason, p_actor: session.email, p_idempotency_key: idempotencyKey })
  if (error) return json({ error: error.message }, error.code === '23505' ? 409 : 400)
  return json({ ok: true, result: data }, 200)
}
