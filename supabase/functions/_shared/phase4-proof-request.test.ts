import { assertEquals } from 'jsr:@std/assert'
import { loadPhase4ProofForAttempt, parsePhase4ProofRequest, phase4CollectionPaidAt, phase4ProofNeedsCollectionReview, phase4UnboundCheckoutNeedsReview } from './phase4-proof-request.ts'

const proofId = '11111111-1111-4111-8111-111111111111'

Deno.test('controlled proof request accepts only an immutable proof ID', () => {
  assertEquals(parsePhase4ProofRequest({ proofId }), proofId)
  assertEquals(parsePhase4ProofRequest({ proofId, orderId: 'second-order' }), null)
  assertEquals(parsePhase4ProofRequest({ proofId, amount: 999999 }), null)
  assertEquals(parsePhase4ProofRequest({ proofId, currency: 'USD' }), null)
  assertEquals(parsePhase4ProofRequest({ proofId, routeId: 'other-route' }), null)
  assertEquals(parsePhase4ProofRequest({ proofId: 'not-a-uuid' }), null)
})

Deno.test('signed collection after proof kill or expiry needs refund review', () => {
  const paidAt = '2026-11-26T20:00:00Z'
  const open = { state: 'CHECKOUT_RESERVED', expires_at: '2026-11-26T20:01:00Z' }
  assertEquals(phase4ProofNeedsCollectionReview(open, paidAt), false)
  assertEquals(phase4ProofNeedsCollectionReview({ ...open, state: 'KILLED' }, paidAt), true)
  assertEquals(phase4ProofNeedsCollectionReview({ ...open, state: 'EXPIRED' }, paidAt), false)
  assertEquals(phase4ProofNeedsCollectionReview({ ...open, expires_at: paidAt }, paidAt), true)
  assertEquals(phase4ProofNeedsCollectionReview({ ...open, expires_at: 'invalid' }, paidAt), true)
  assertEquals(phase4ProofNeedsCollectionReview(open, null), true)
  assertEquals(phase4CollectionPaidAt({ created_at: paidAt, data: { paid_at: '2026-11-26T20:02:00Z' } }), '2026-11-26T20:02:00Z')
  assertEquals(phase4CollectionPaidAt({ created_at: paidAt, data: { paid_at: 'bad' } }), null)
  assertEquals(phase4CollectionPaidAt({ created_at: '2026-11-26T20:03:00Z', data: { created_at: paidAt } }), paidAt)
  assertEquals(phase4CollectionPaidAt({ created_at: paidAt }), paidAt)
})

Deno.test('checkout bound before upsert still finds proof for late signed collection', async () => {
  const attemptId = '22222222-2222-4222-8222-222222222222'
  const boundProof = { id: proofId, order_id: 'order-1', payment_attempt_id: attemptId,
    state: 'EXPIRED', expires_at: '2026-11-26T20:00:00Z' }
  // The attempt has no provider_response.phase4_proof_id: checkout creation
  // succeeded but the later payment upsert never ran.
  const attempt = { id: attemptId, order_id: 'order-1', provider: 'BACHS',
    provider_payment_id: null, provider_response: {} }
  const { proof, error } = await loadPhase4ProofForAttempt(attempt.id, async (id) => ({
    data: id === attemptId ? boundProof : null, error: null,
  }))
  assertEquals(error, null)
  assertEquals(proof?.id, proofId)
  assertEquals(phase4UnboundCheckoutNeedsReview(attempt, proof), true)
  assertEquals(phase4ProofNeedsCollectionReview(boundProof, '2026-11-26T20:01:00Z'), true)
})
