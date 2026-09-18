import type { AuthAccountRole } from './auth-role'

export type OrderRoleScope = {
  userId: string
  role: AuthAccountRole
  tailorProfileId?: string | null
}

/** Build the PostgREST OR clause for the currently active account mode. */
export function orderRoleFilter(scope: OrderRoleScope) {
  const userId = scope.userId.trim()
  if (!userId) throw new Error('userId is required')
  if (scope.role === 'CUSTOMER') return `customer_id.eq.${userId}`

  const tailorProfileId = scope.tailorProfileId?.trim()
  return tailorProfileId
    ? `tailor_id.eq.${userId},tailor_profile_id.eq.${tailorProfileId}`
    : `tailor_id.eq.${userId}`
}

export function orderBelongsToRole(
  order: {
    customer_id?: string | null
    tailor_id?: string | null
    tailor_profile_id?: string | null
  },
  scope: OrderRoleScope
) {
  if (scope.role === 'CUSTOMER') return order.customer_id === scope.userId
  return order.tailor_id === scope.userId || order.tailor_profile_id === scope.tailorProfileId
}
