export type ReviewedClaimedTrancheRetryRequest = {
  id: string
  targetId: string
  actionPayload: unknown
}

export type ReviewedClaimedTrancheRetryResult = {
  ok: boolean
  pending?: boolean
  providerReference?: string | null
  error?: string
}

/** A lost Edge response cannot prove that Stripe did not receive the request.
 * Keep the original Money Desk execution open; settlement monitoring retries
 * the same approved request and immutable provider operation. */
export async function executeReviewedClaimedTrancheRetry(
  request: ReviewedClaimedTrancheRetryRequest,
  invoke: (body: { trancheId: string; moneyDeskRequestId: string }) => Promise<{
    ok: boolean
    providerReference?: string | null
  }>,
): Promise<ReviewedClaimedTrancheRetryResult> {
  const payload = request.actionPayload && typeof request.actionPayload === 'object' &&
      !Array.isArray(request.actionPayload)
    ? request.actionPayload as Record<string, unknown>
    : {}
  if (typeof payload.trancheId !== 'string' || !payload.trancheId ||
    payload.claimId !== request.targetId) {
    return { ok: false, error: 'Reviewed retry has no exact tranche and claim identity.' }
  }
  try {
    const result = await invoke({
      trancheId: payload.trancheId,
      moneyDeskRequestId: request.id,
    })
    // A structured error can still follow a completed reservation; the
    // monitor decides its terminal state using the saved provider operation.
    return { ok: true, pending: true,
      providerReference: result.ok ? result.providerReference ?? null : null }
  } catch {
    return { ok: true, pending: true }
  }
}
