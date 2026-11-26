const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

/** The service action accepts only a proof ID. Order, amount, currency and
 * route are loaded from the immutable database tuple, never from the caller. */
export function parsePhase4ProofRequest(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const keys = Object.keys(body)
  if (keys.length !== 1 || keys[0] !== 'proofId') return null
  const id = (body as { proofId?: unknown }).proofId
  return typeof id === 'string' && UUID.test(id) ? id : null
}
