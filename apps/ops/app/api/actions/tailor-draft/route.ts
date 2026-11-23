import { NextResponse } from 'next/server'
import { isRestrictedOpsPhoneHeaders } from '../../../../lib/client-surface'
import { resolveLocalWorkforcePrincipal } from '../../../../lib/local-workforce-principal'
import { getOpsSession, hasFreshOpsMfa } from '../../../../lib/ops-session'
import { validateOpsMutationOrigin } from '../../../../../web/lib/ops-request-security'
import { getSupabaseServiceRoleKey } from '../../../../../web/lib/supabase-config'
import { validateServiceRoleTarget } from '../../../../../web/lib/supabase-environment'
import { isTailorClaimsEnabled } from '../../../../lib/tailor-claims-feature'

export const dynamic = 'force-dynamic'

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
  })

export async function POST(request: Request) {
  if (!isTailorClaimsEnabled()) return json({ error: 'Draft tailors are not enabled.' }, 404)
  if (!validateOpsMutationOrigin(request).ok || isRestrictedOpsPhoneHeaders(request.headers))
    return json({ error: 'Protected desktop origin required.' }, 403)

  const session = await getOpsSession(request)
  if (!session?.allowed || !hasFreshOpsMfa(session) || !['admin', 'trust'].includes(session.role))
    return json({ error: 'Fresh protected trust session required.' }, 401)

  const body = await request.text()
  if (body.length > 64_000) return json({ error: 'Request too large.' }, 413)
  try {
    JSON.parse(body)
  } catch {
    return json({ error: 'Invalid request.' }, 400)
  }

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? process.env.SUPABASE_URL?.trim()
  const serviceRoleKey = getSupabaseServiceRoleKey()
  if (
    !supabaseUrl ||
    !serviceRoleKey ||
    !validateServiceRoleTarget(
      supabaseUrl,
      serviceRoleKey,
      process.env.SUPABASE_SERVICE_ROLE_PROJECT_REF
    ).isValid
  )
    return json({ error: 'Draft broker unavailable.' }, 503)

  const headers: Record<string, string> = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  }

  if (session.mode !== 'cloudflare-access') {
    if (process.env.NODE_ENV === 'production')
      return json({ error: 'Development bridge unavailable.' }, 403)
    const local = await resolveLocalWorkforcePrincipal(session)
    if (!local || !local.principal.roles.some((role) => ['admin', 'trust'].includes(role)))
      return json({ error: 'Development trust identity unavailable.' }, 403)
    headers['x-drape-local-ops-email'] = local.principal.email
  } else {
    const assertion = request.headers.get('cf-access-jwt-assertion')
    if (!assertion) return json({ error: 'Signed workforce assertion required.' }, 401)
    headers['x-drape-ops-access-assertion'] = assertion
  }

  try {
    const response = await fetch(
      `${supabaseUrl.replace(/\/+$/u, '')}/functions/v1/tailor-draft-action`,
      {
        method: 'POST',
        headers,
        body,
        cache: 'no-store',
        signal: AbortSignal.timeout(30_000),
      }
    )
    return json(await response.json(), response.status)
  } catch {
    return json({ error: 'The draft server did not respond. Retry the same action.' }, 502)
  }
}
