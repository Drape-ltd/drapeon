import { assertEquals } from 'jsr:@std/assert'
import { parsePhase4ProofRequest, phase4ProofNeedsCollectionReview } from './phase4-proof-request.ts'

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
  const now = Date.parse('2026-11-26T20:00:00Z')
  const open = { state: 'CHECKOUT_RESERVED', expires_at: '2026-11-26T20:01:00Z' }
  assertEquals(phase4ProofNeedsCollectionReview(open, now), false)
  assertEquals(phase4ProofNeedsCollectionReview({ ...open, state: 'KILLED' }, now), true)
  assertEquals(phase4ProofNeedsCollectionReview({ ...open, state: 'EXPIRED' }, now), true)
  assertEquals(phase4ProofNeedsCollectionReview({ ...open, expires_at: '2026-11-26T20:00:00Z' }, now), true)
  assertEquals(phase4ProofNeedsCollectionReview({ ...open, expires_at: 'invalid' }, now), true)
})
