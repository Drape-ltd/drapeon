import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { ordinaryEarningReleaseDecision, ordinaryEarningReleasePolicy } from './payout-release.ts'

Deno.test('ordinary earning release accepts only a snapshotted legacy policy', () => {
  assertEquals(
    ordinaryEarningReleasePolicy({ commercial_policy_version: 'legacy-single-release-72h' }),
    'LEGACY',
  )
  assertEquals(
    ordinaryEarningReleasePolicy({ commercial_policy_version: 'commercial-2026-07-31-v1' }),
    'STAGED',
  )

  for (const version of ['unknown-v1', null, undefined]) {
    assertEquals(ordinaryEarningReleasePolicy({ commercial_policy_version: version }), 'REVIEW')
  }
})

Deno.test('ordinary payout worker releases only legacy, skips staged, and reviews ambiguous policy', () => {
  assertEquals(
    ordinaryEarningReleaseDecision({ commercial_policy_version: 'legacy-single-release-72h' }, false),
    'RELEASE',
  )
  assertEquals(
    ordinaryEarningReleaseDecision({ commercial_policy_version: 'commercial-2026-07-31-v1' }, false),
    'SKIP_STAGED',
  )
  assertEquals(
    ordinaryEarningReleaseDecision({ commercial_policy_version: 'commercial-2026-07-31-v1' }, true),
    'REVIEW',
  )
  assertEquals(ordinaryEarningReleaseDecision({ commercial_policy_version: null }, true), 'REVIEW')
})
