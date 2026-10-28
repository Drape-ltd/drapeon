import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { routeTrancheClaimIdentity, type RouteTrancheClaimRow } from './reconcile-route-tranche-claim.ts'

const claim: RouteTrancheClaimRow = {
  id: 'claim-1', source_kind: 'SETTLEMENT_TRANCHE', source_id: 'tranche-1', order_id: 'order-1',
  tailor_profile_id: 'profile-1', provider: 'BACHS', provider_destination_id: 'acct_test_1',
  currency: 'NGN', amount: 700000, route_version: '7', earning_policy_version: 'commercial-2026-07-31-v1',
  tailor_terms_version: 'terms-v2', provider_idempotency_key: 'tranche:tranche-1:op:1',
  status: 'PROVIDER_PENDING', provider_transfer_id: 'tr_123', payout_id: 'payout-1',
  payout_ledger_transaction_id: null,
  accepted_route_snapshot_at: '2026-10-28T00:00:00.000Z',
  payment_route_id: 'route-1', charge_provider_snapshot: 'BACHS',
}

Deno.test('route tranche reconciliation rebuilds the frozen Bachs claim identity', () => {
  assertEquals(routeTrancheClaimIdentity(claim), {
    businessKey: 'tranche:tranche-1', sourceKind: 'SETTLEMENT_TRANCHE', sourceId: 'tranche-1',
    orderId: 'order-1', tailorProfileId: 'profile-1', provider: 'BACHS',
    destinationId: 'acct_test_1', currency: 'NGN', amount: 700000, routeVersion: '7',
    earningPolicyVersion: 'commercial-2026-07-31-v1', tailorTermsVersion: 'terms-v2',
    providerIdempotencyKey: 'tranche:tranche-1:op:1',
  })
})

Deno.test('route tranche reconciliation rebuilds the frozen Stripe claim identity', () => {
  assertEquals(routeTrancheClaimIdentity({
    ...claim, provider: 'STRIPE', provider_destination_id: 'acct_stripe_test', currency: 'GBP',
    charge_provider_snapshot: 'STRIPE',
  }).provider, 'STRIPE')
})

Deno.test('route tranche reconciliation rejects mutated, legacy, or unsupported claims', () => {
  assertThrows(() => routeTrancheClaimIdentity({ ...claim, provider: 'PAYSTACK' }))
  assertThrows(() => routeTrancheClaimIdentity({ ...claim, provider_idempotency_key: 'new-key' }))
  assertThrows(() => routeTrancheClaimIdentity({ ...claim, amount: 0 }))
  assertThrows(() => routeTrancheClaimIdentity({ ...claim, status: 'FAILED_RECONCILED' }))
  assertThrows(() => routeTrancheClaimIdentity({ ...claim, accepted_route_snapshot_at: null }))
  assertThrows(() => routeTrancheClaimIdentity({ ...claim, charge_provider_snapshot: 'STRIPE' }))
})
