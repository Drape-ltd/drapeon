import 'server-only'

import { getOpsSession } from './ops-session'
import { canAccessOpsArea, type OpsArea } from './route-access-policy'

export async function hasOpsAreaAccess(area: OpsArea) {
  const session = await getOpsSession()
  return Boolean(session?.allowed && canAccessOpsArea(session.role, area))
}
