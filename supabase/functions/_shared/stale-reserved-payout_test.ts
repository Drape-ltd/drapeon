import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  isStaleUnstartedPayout,
  staleUnstartedPayoutIssue,
} from './stale-reserved-payout.ts'

const now = Date.parse('2026-11-10T16:00:00Z')
const candidate = {
  claimId: 'claim-1',
  claimStatus: 'RESERVED',
  claimUpdatedAt: '2026-11-10T15:29:59Z',
  attemptCount: 0,
  orderId: 'order-1',
  payoutId: 'payout-1',
  payoutStatus: 'PROCESSING',
  provider: 'STRIPE',
  providerPayoutId: null,
  providerTransferStatus: 'PROCESSING',
  providerTransferId: null,
  tailorProfileId: 'tailor-1',
}

Deno.test('stale no-attempt reservations alert at thirty minutes, including legacy routes', () => {
  assertEquals(isStaleUnstartedPayout(candidate, now), true)
  assertEquals(
    isStaleUnstartedPayout({
      ...candidate,
      claimUpdatedAt: '2026-11-10T15:30:01Z',
    }, now),
    false,
  )
  assertEquals(
    isStaleUnstartedPayout({ ...candidate, attemptCount: 1 }, now),
    false,
  )
  assertEquals(
    isStaleUnstartedPayout(
      { ...candidate, providerTransferId: 'tr_existing' },
      now,
    ),
    false,
  )
  assertEquals(
    isStaleUnstartedPayout({ ...candidate, payoutStatus: 'FAILED' }, now),
    false,
  )
})

Deno.test('alert is deduped by claim and gives Ops a no-retry instruction', () => {
  const issue = staleUnstartedPayoutIssue(candidate)
  assertEquals(issue.dedupeKey, 'unstarted-payout-reservation:claim-1')
  assertEquals(issue.severity, 'HIGH')
  assertEquals(issue.notifyOps, true)
  assertEquals(issue.recommendedAction.includes('Do not retry'), true)
})
