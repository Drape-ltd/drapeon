import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { bachsTrancheClaimIdentity, type BachsTrancheClaimRow } from './reconcile-bachs-tranche-claim.ts'

const claim: BachsTrancheClaimRow = {
  id: 'claim-1', source_kind: 'SETTLEMENT_TRANCHE', source_id: 'tranche-1', order_id: 'order-1',
  tailor_profile_id: 'profile-1', provider: 'BACHS', provider_destination_id: 'acct_test_1',
  currency: 'NGN', amount: 700000, route_version: '7', earning_policy_version: 'commercial-2026-07-31-v1',
  tailor_terms_version: 'terms-v2', provider_idempotency_key: 'tranche:tranche-1:op:1',
  status: 'PROVIDER_PENDING', provider_transfer_id: 'tr_123', payout_id: 'payout-1',
  payout_ledger_transaction_id: null,
}

Deno.test('Bachs tranche reconciliation rebuilds only the frozen claim identity', () => {
  assertEquals(bachsTrancheClaimIdentity(claim), {
    businessKey: 'tranche:tranche-1', sourceKind: 'SETTLEMENT_TRANCHE', sourceId: 'tranche-1',
    orderId: 'order-1', tailorProfileId: 'profile-1', provider: 'BACHS',
    destinationId: 'acct_test_1', currency: 'NGN', amount: 700000, routeVersion: '7',
    earningPolicyVersion: 'commercial-2026-07-31-v1', tailorTermsVersion: 'terms-v2',
    providerIdempotencyKey: 'tranche:tranche-1:op:1',
  })
})

Deno.test('Bachs tranche reconciliation rejects a mutated or unsupported claim identity', async () => {
  assertThrows(() => bachsTrancheClaimIdentity({ ...claim, provider: 'PAYSTACK' }))
  assertThrows(() => bachsTrancheClaimIdentity({ ...claim, provider_idempotency_key: 'new-key' }))
  assertThrows(() => bachsTrancheClaimIdentity({ ...claim, amount: 0 }))
})
