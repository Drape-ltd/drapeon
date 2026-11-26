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
  paidAt: string | null,
): boolean {
  const paidAtMs = paidAt ? Date.parse(paidAt) : NaN
  return proof.state === 'KILLED' || !Number.isFinite(paidAtMs) ||
    !Number.isFinite(Date.parse(proof.expires_at)) ||
    Date.parse(proof.expires_at) <= paidAtMs
}

/** Signed payment time takes precedence over event creation time. A missing or
 * malformed timestamp cannot establish that collection preceded expiry. */
export function phase4CollectionPaidAt(event: {
  created_at?: unknown;
  data?: Record<string, unknown>;
}): string | null {
  const paidAt = event.data?.paid_at
  const candidate = paidAt === undefined || paidAt === null
    ? event.data?.created_at ?? event.created_at : paidAt
  return typeof candidate === 'string' && Number.isFinite(Date.parse(candidate))
    ? candidate : null
}

/** The proof is bound to the attempt before the provider checkout is created.
 * Provider-response metadata can be absent if the later upsert fails. */
export async function loadPhase4ProofForAttempt(
  attemptId: string,
  lookup: (attemptId: string) => Promise<{ data: Record<string, unknown> | null; error: unknown }>,
): Promise<{ proof: Record<string, unknown> | null; error: unknown }> {
  const { data, error } = await lookup(attemptId)
  return { proof: data, error }
}

export function phase4UnboundCheckoutNeedsReview(
  attempt: { id: string; order_id: string; provider: string; provider_payment_id: string | null },
  proof: { order_id?: unknown; payment_attempt_id?: unknown } | null,
): boolean {
  return attempt.provider === 'BACHS' && !attempt.provider_payment_id &&
    proof?.order_id === attempt.order_id && proof.payment_attempt_id === attempt.id
}
