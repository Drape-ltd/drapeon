export function hasReleaseReadyPayoutAccount(input: {
  profileId: string | null | undefined
  legacyVerified: boolean | null | undefined
  legacyReverificationRequired: boolean | null | undefined
  hasAcceptedRouteDestination: boolean
}): boolean {
  if (!input.profileId) return false
  // An accepted order is pinned to a payout destination. Its current
  // capability/active state is checked by acceptedOrderPayoutRoute before this
  // helper is reached, so a profile-level reverification request for a later
  // destination change must not strand an otherwise-valid accepted earning.
  // Legacy orders have no such immutable destination and retain the profile
  // verification requirement below.
  if (input.hasAcceptedRouteDestination) return true
  return input.legacyVerified === true && input.legacyReverificationRequired !== true
}
