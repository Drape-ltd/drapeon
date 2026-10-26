const PAYOUT_BLOCK_RESOLUTION_MODES = new Set([
  'ORIGINAL_CURRENCY',
  'CONVERT_TO_CURRENT',
  'REFUND_CUSTOMER',
])

export function isPayoutBlockResolutionAllowed({ hasAcceptedRouteSnapshot, mode }) {
  if (!PAYOUT_BLOCK_RESOLUTION_MODES.has(String(mode ?? '').trim().toUpperCase())) return false
  if (hasAcceptedRouteSnapshot && String(mode).trim().toUpperCase() !== 'REFUND_CUSTOMER') return false
  return true
}
