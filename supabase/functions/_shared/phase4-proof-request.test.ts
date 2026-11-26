import { assertEquals } from 'jsr:@std/assert'
import { parsePhase4ProofRequest } from './phase4-proof-request.ts'

const proofId = '11111111-1111-4111-8111-111111111111'

Deno.test('controlled proof request accepts only an immutable proof ID', () => {
  assertEquals(parsePhase4ProofRequest({ proofId }), proofId)
  assertEquals(parsePhase4ProofRequest({ proofId, orderId: 'second-order' }), null)
  assertEquals(parsePhase4ProofRequest({ proofId, amount: 999999 }), null)
  assertEquals(parsePhase4ProofRequest({ proofId, currency: 'USD' }), null)
  assertEquals(parsePhase4ProofRequest({ proofId, routeId: 'other-route' }), null)
  assertEquals(parsePhase4ProofRequest({ proofId: 'not-a-uuid' }), null)
})
