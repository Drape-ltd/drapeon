import 'server-only'

import { cookies, headers } from 'next/headers'
import { getOpsAccessMode, getOpsSession as getSharedOpsSession } from '../../web/lib/ops-auth'
import { readOpsRequestContext } from './ops-session-context.mjs'

export * from '../../web/lib/ops-auth'

// The Ops app and the customer web app currently use different Next versions.
// Resolve request state in the Ops runtime before calling shared authentication.
export async function getOpsSession() {
  const context = await readOpsRequestContext(getOpsAccessMode(), { cookies, headers })
  return getSharedOpsSession(context)
}
