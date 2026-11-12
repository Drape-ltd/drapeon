export function hasReleaseReadyPayoutAccount(input: {
  profileId: string | null | undefined
  legacyVerified: boolean | null | undefined
  legacyReverificationRequired: boolean | null | undefined
  hasAcceptedRouteDestination: boolean
}): boolean {
  if (!input.profileId) return false
  if (input.hasAcceptedRouteDestination) return true
  return input.legacyVerified === true && input.legacyReverificationRequired !== true
}
