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

/** A signed late collection still books the captured money, but it must not
 * advance the order or release a payout after the proof window closes. */
export function phase4ProofNeedsCollectionReview(
  proof: { state: string; expires_at: string },
  nowMs: number,
): boolean {
  return proof.state === 'KILLED' || proof.state === 'EXPIRED' ||
    !Number.isFinite(Date.parse(proof.expires_at)) ||
    Date.parse(proof.expires_at) <= nowMs
}
