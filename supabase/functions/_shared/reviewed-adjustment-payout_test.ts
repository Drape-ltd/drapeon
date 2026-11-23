import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  reviewedAdjustmentPayoutIdentity,
  type ReviewedAdjustmentClaimRow,
} from './reviewed-adjustment-payout.ts'

const base: ReviewedAdjustmentClaimRow = {
  id: 'claim-1',
  business_key: 'adjustment:11111111-1111-4111-8111-111111111111',
  source_kind: 'TAILOR_ADJUSTMENT',
  source_id: '11111111-1111-4111-8111-111111111111',
  order_id: 'order-1',
  tailor_profile_id: 'tailor-1',
  provider: 'BACHS',
  provider_destination_id: 'acct_bachs_test_1',
  currency: 'NGN',
  amount: 12500,
  route_version: 'ng-ngn-ngn-bachs-v1',
  earning_policy_version: 'tailor-adjustment-delivery-72h-reviewed-v1',
  tailor_terms_version: 'terms-2026-10',
  provider_idempotency_key: 'adjustment:11111111-1111-4111-8111-111111111111:op:1',
}

Deno.test('reviewed adjustment identity supports snapshot-pinned Bachs', () => {
  const identity = reviewedAdjustmentPayoutIdentity(base)
  assertEquals(identity.provider, 'BACHS')
  assertEquals(identity.currency, 'NGN')
  assertEquals(identity.amount, 12500)
  assertEquals(identity.destinationId, 'acct_bachs_test_1')
  assertEquals(identity.providerIdempotencyKey, base.provider_idempotency_key)
})

Deno.test('reviewed adjustment identity preserves snapshot-pinned Stripe', () => {
  const identity = reviewedAdjustmentPayoutIdentity({
    ...base,
    provider: 'STRIPE',
    currency: 'USD',
  })
  assertEquals(identity.provider, 'STRIPE')
  assertEquals(identity.currency, 'USD')
})

Deno.test('reviewed adjustment identity rejects retired Paystack claims', () => {
  assertThrows(() => reviewedAdjustmentPayoutIdentity({ ...base, provider: 'PAYSTACK' }))
})

Deno.test('reviewed adjustment identity rejects mismatched business and provider keys', () => {
  assertThrows(() =>
    reviewedAdjustmentPayoutIdentity({ ...base, business_key: 'adjustment:other' })
  )
  assertThrows(() =>
    reviewedAdjustmentPayoutIdentity({ ...base, provider_idempotency_key: 'new-key' })
  )
})

Deno.test('reviewed adjustment identity rejects amount or policy drift', () => {
  assertThrows(() => reviewedAdjustmentPayoutIdentity({ ...base, amount: 0 }))
  assertThrows(() =>
    reviewedAdjustmentPayoutIdentity({ ...base, earning_policy_version: 'legacy' })
  )
})
