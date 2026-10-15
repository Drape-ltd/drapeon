import { NextResponse } from 'next/server'
import { getOpsSession, isNamedOpsWorkforceSession } from '../../../../web/lib/ops-auth'
import { invokeOpsReadBroker, requiresOpsEdgeBroker } from '../../../../web/lib/ops-edge-broker'
import { resolveLocalWorkforcePrincipal } from '../../../lib/local-workforce-principal'
import { readOpsNavigationCounts, type OpsNavigationCounts } from '../../../../../supabase/functions/_shared/ops-queue-page'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function GET() {
  const session = await getOpsSession()
  if (!session?.allowed || !isNamedOpsWorkforceSession(session)) {
    return NextResponse.json({ error: 'workforce-session-required' }, { status: 401, headers })
  }
  try {
    let counts: OpsNavigationCounts
    if (requiresOpsEdgeBroker()) {
      counts = await invokeOpsReadBroker<OpsNavigationCounts>('navigation-counts', {})
    } else {
      const identity = await resolveLocalWorkforcePrincipal(session)
      if (!identity || process.env.DRAPE_OPS_ENV === 'production' || process.env.DRAPE_WEB_ENV === 'production') {
        return NextResponse.json({ error: 'workforce-principal-required' }, { status: 403, headers })
      }
      counts = await readOpsNavigationCounts(identity.client, 'DEVELOPMENT', identity.principal)
    }
    return NextResponse.json(counts, { headers })
  } catch {
    return NextResponse.json({ error: 'navigation-counts-unavailable' }, { status: 503, headers })
  }
}
