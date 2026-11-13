import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  isStaleUnstartedPayout,
  stalePayoutScanWindow,
  staleUnstartedPayoutIssue,
} from './stale-reserved-payout.ts'

const now = Date.parse('2026-11-10T16:00:00Z')

Deno.test('bounded stale scan rotates through every page', () => {
  const interval = 60 * 30 * 1000
  assertEquals(stalePayoutScanWindow(19, 0), { from: 0, to: 99, pages: 1 })
  assertEquals(stalePayoutScanWindow(250, 0), { from: 0, to: 99, pages: 3 })
  assertEquals(stalePayoutScanWindow(250, interval), { from: 100, to: 199, pages: 3 })
  assertEquals(stalePayoutScanWindow(250, interval * 2), { from: 200, to: 299, pages: 3 })
})
const candidate = {
  claimId: 'claim-1',
  sourceKind: 'SETTLEMENT_TRANCHE',
  sourceId: 'source-1',
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
  assertEquals(issue.skipIfUnchanged, true)
  assertEquals(issue.preserveWorkflowState, true)
  assertEquals(issue.recommendedAction.includes('Do not retry'), true)
})

Deno.test('stale unstarted claims of every payout kind are eligible for Ops alerting', () => {
  for (const sourceKind of [
    'SETTLEMENT_TRANCHE',
    'FABRIC_RELEASE',
    'MATERIAL_ADVANCE',
    'RESIDUAL_SETTLEMENT',
    'CONSULTATION_EARNING',
    'ORDER_EARNING',
    'TIP',
  ]) {
    const payout = { ...candidate, sourceKind }
    assertEquals(isStaleUnstartedPayout(payout, now), true, sourceKind)
    assertEquals(staleUnstartedPayoutIssue(payout).metadata.source_kind, sourceKind)
  }
})
