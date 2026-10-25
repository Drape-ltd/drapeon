import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { ordinaryEarningReleasePolicy } from './payout-release.ts'

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
