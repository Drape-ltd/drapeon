import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { hasReleaseReadyPayoutAccount } from './accepted-payout-readiness.ts'

Deno.test('accepted route destination supersedes legacy profile payout flag', () => {
  assertEquals(hasReleaseReadyPayoutAccount({
    profileId: 'profile_1',
    legacyVerified: false,
    legacyReverificationRequired: true,
    hasAcceptedRouteDestination: true,
  }), true)
})

Deno.test('legacy orders still require the verified profile flag', () => {
  assertEquals(hasReleaseReadyPayoutAccount({
    profileId: 'profile_1',
    legacyVerified: false,
    legacyReverificationRequired: false,
    hasAcceptedRouteDestination: false,
  }), false)
  assertEquals(hasReleaseReadyPayoutAccount({
    profileId: 'profile_1',
    legacyVerified: true,
    legacyReverificationRequired: false,
    hasAcceptedRouteDestination: false,
  }), true)
})

Deno.test('a profile identity is always required', () => {
  assertEquals(hasReleaseReadyPayoutAccount({
    profileId: null,
    legacyVerified: true,
    legacyReverificationRequired: false,
    hasAcceptedRouteDestination: true,
  }), false)
})
