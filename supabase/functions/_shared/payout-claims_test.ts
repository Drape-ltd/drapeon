import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  recordPayoutAttemptOutcome,
  reservePayoutClaim,
  startPayoutAttempt,
  type PayoutClaimIdentity,
  type PayoutClaimReservation,
} from './payout-claims.ts'

const identity: PayoutClaimIdentity = {
  businessKey: 'order:o1:earning', sourceKind: 'ORDER_EARNING', sourceId: 'o1',
  orderId: 'o1', tailorProfileId: 't1', provider: 'STRIPE', destinationId: 'acct_1',
  currency: 'USD', amount: 1000, routeVersion: 'locked-route-v1',
  earningPolicyVersion: 'legacy-single-release-72h',
  providerIdempotencyKey: 'DRAPE-PAYOUT-o1',
}
const claim: PayoutClaimReservation = {
  outcome: 'RESERVED', claim_id: 'claim-1', status: 'RESERVED',
  provider_idempotency_key: identity.providerIdempotencyKey,
  provider_transfer_id: null, payout_id: null,
}

function fakeRpc(
  fn: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>,
): SupabaseClient {
  return { rpc: fn } as unknown as SupabaseClient
}

Deno.test('claim reservation sends immutable earning identity and stable provider key', async () => {
  let captured: Record<string, unknown> = {}
  const db = fakeRpc(async (name, args) => {
    assertEquals(name, 'reserve_payout_claim')
    captured = args
    return { data: claim, error: null }
  })
  assertEquals(await reservePayoutClaim(db, identity), claim)
  assertEquals(captured.p_business_key, 'order:o1:earning')
  assertEquals(captured.p_amount, 1000)
  assertEquals(captured.p_provider_idempotency_key, 'DRAPE-PAYOUT-o1')
})

Deno.test('invalid amount never reserves a payout claim', async () => {
  const db = fakeRpc(async () => { throw new Error('should not call database') })
  await assertRejects(() => reservePayoutClaim(db, { ...identity, amount: 0 }), Error, 'positive integer')
})

Deno.test('existing claim with a different key fails closed', async () => {
  const db = fakeRpc(async () => ({ data: { ...claim, outcome: 'EXISTING', provider_idempotency_key: 'other-key' }, error: null }))
  await assertRejects(() => reservePayoutClaim(db, identity), Error, 'invalid identity')
})

Deno.test('reserved claim starts one provider call with the same key', async () => {
  let mode: unknown
  const db = fakeRpc(async (name, args) => {
    assertEquals(name, 'start_payout_attempt')
    mode = args.p_mode
    return { data: { action: 'PROVIDER_CALL', claim_id: claim.claim_id, attempt_id: 'attempt-1', provider_idempotency_key: identity.providerIdempotencyKey }, error: null }
  })
  assertEquals((await startPayoutAttempt(db, claim)).action, 'PROVIDER_CALL')
  assertEquals(mode, 'PROVIDER_CALL')
})

Deno.test('unknown outcome reconciles rather than starting a fresh provider call', async () => {
  let mode: unknown
  const db = fakeRpc(async (_name, args) => {
    mode = args.p_mode
    return { data: { action: 'RECONCILE', claim_id: claim.claim_id, attempt_id: 'attempt-2', provider_idempotency_key: identity.providerIdempotencyKey }, error: null }
  })
  assertEquals((await startPayoutAttempt(db, { ...claim, status: 'PROVIDER_UNKNOWN' })).action, 'RECONCILE')
  assertEquals(mode, 'RECONCILE')
})

Deno.test('attempt response cannot silently change the provider key', async () => {
  const db = fakeRpc(async () => ({ data: { action: 'PROVIDER_CALL', claim_id: claim.claim_id, attempt_id: 'attempt-1', provider_idempotency_key: 'other-key' }, error: null }))
  await assertRejects(() => startPayoutAttempt(db, claim), Error, 'did not preserve')
})

Deno.test('timeout is recorded as unknown with its original attempt', async () => {
  let captured: Record<string, unknown> = {}
  const db = fakeRpc(async (name, args) => {
    assertEquals(name, 'record_payout_attempt_outcome')
    captured = args
    return { data: { outcome: 'RECORDED' }, error: null }
  })
  assertEquals(await recordPayoutAttemptOutcome(db, {
    attemptId: 'attempt-1', status: 'PROVIDER_UNKNOWN', evidence: { error_class: 'TIMEOUT' },
  }), 'RECORDED')
  assertEquals(captured.p_attempt_id, 'attempt-1')
  assertEquals(captured.p_provider_transfer_id, null)
})

Deno.test('success without provider reference fails before database write', async () => {
  const db = fakeRpc(async () => { throw new Error('should not call database') })
  await assertRejects(() => recordPayoutAttemptOutcome(db, {
    attemptId: 'attempt-1', status: 'SUCCEEDED', evidence: { confirmed: true },
  }), Error, 'provider transfer reference')
})
