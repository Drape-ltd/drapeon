import 'server-only'
import { getOpsSession } from '../../web/lib/ops-auth'
import { invokeOpsReadBroker, requiresOpsEdgeBroker } from '../../web/lib/ops-edge-broker'
import { readOpsSearch, type OpsSearchData, type OpsSearchClient } from '../../../supabase/functions/_shared/ops-search'
import { resolveLocalWorkforcePrincipal } from './local-workforce-principal'

export async function loadOpsSearch(query: string): Promise<OpsSearchData> {
  if (requiresOpsEdgeBroker()) return invokeOpsReadBroker<OpsSearchData>('search', { query })
  const session = await getOpsSession()
  const local = session?.allowed ? await resolveLocalWorkforcePrincipal(session) : null
  if (!local) throw new Error('A current workforce identity is required.')
  // Keep the SDK's recursive schema generics outside the shared query interface.
  return readOpsSearch(local.client as unknown as OpsSearchClient, 'DEVELOPMENT', local.principal, query)
}
