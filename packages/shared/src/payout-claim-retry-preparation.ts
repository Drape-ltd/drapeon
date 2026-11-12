export const PAYOUT_CLAIM_RETRY_GRACE_MS = 10 * 60 * 1000

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function payoutClaimRetryAvailableAt(confirmedAt: string | null | undefined) {
  if (!confirmedAt) return null
  const timestamp = Date.parse(confirmedAt)
  if (!Number.isFinite(timestamp)) return null
  return new Date(timestamp + PAYOUT_CLAIM_RETRY_GRACE_MS).toISOString()
}

export function isPayoutClaimRetryGraceElapsed(
  confirmedAt: string | null | undefined,
  nowMs = Date.now(),
) {
  const availableAt = payoutClaimRetryAvailableAt(confirmedAt)
  return availableAt !== null && Date.parse(availableAt) <= nowMs
}

export type PreparedClaimRetrySnapshot = {
  claimId: string
  orderId: string
  trancheId: string
  priorOperationId: string
  nextOperationNumber: number
  provider: 'STRIPE'
  destinationId: string
  currency: string
  amount: number
  sourceTransaction: string
  finalFailureReference: string
  fundsReturnReference: string
  fundsReturnConfirmedAt: string
  latestTerminalRequestId: string | null
}

export type ClaimRetryPreparationError =
  | 'INVALID_REASON'
  | 'CLAIM_NOT_RETRYABLE'
  | 'RETRY_GRACE_ACTIVE'
  | 'RETRY_EVIDENCE_MISMATCH'
  | 'RETRY_ALREADY_AUTHORIZED'
  | 'ACTIVE_REQUEST_EXISTS'
  | 'RETRY_DATA_UNAVAILABLE'
  | 'REQUEST_SUBMISSION_FAILED'

/**
 * Re-read the durable failed claim immediately before creating a reviewed
 * retry request. The database rechecks the full authorization and funding
 * invariants at execution; this read only prevents stale or premature requests.
 */
export async function readPreparedClaimRetrySnapshot(
  client: any,
  claimId: string,
  nowMs = Date.now(),
): Promise<{ ok: true; snapshot: PreparedClaimRetrySnapshot } | { ok: false; code: ClaimRetryPreparationError }> {
  const claimResult = await client.from('payout_claims')
    .select('id,source_kind,source_id,order_id,provider,provider_destination_id,currency,amount,status,transfer_status,payout_id,provider_transfer_id')
    .eq('id', claimId)
    .maybeSingle()
  if (claimResult.error) return { ok: false, code: 'RETRY_DATA_UNAVAILABLE' }
  const claim = claimResult.data
  if (!claim?.id || claim.source_kind !== 'SETTLEMENT_TRANCHE' || claim.provider !== 'STRIPE' ||
    claim.status !== 'FAILED_RECONCILED' || claim.transfer_status !== 'FAILED_RECONCILED' ||
    claim.provider_transfer_id != null || !claim.payout_id || !claim.provider_destination_id ||
    !claim.order_id || !claim.source_id || !claim.amount || !claim.currency) {
    return { ok: false, code: 'CLAIM_NOT_RETRYABLE' }
  }

  const [operations, payoutResult, trancheResult] = await Promise.all([
    client.from('payout_provider_operations')
      .select('id,operation_number,provider,provider_destination_id,currency,amount,status,provider_source_transaction_id,final_failure_reference,funds_return_reference,funds_return_confirmed_at,provider_transfer_id')
      .eq('claim_id', claim.id)
      .order('operation_number', { ascending: false })
      .limit(1),
    client.from('payouts')
      .select('id,order_id,status,payout_purpose,amount,currency,provider,provider_destination_id')
      .eq('id', claim.payout_id)
      .maybeSingle(),
    client.from('order_settlement_tranches')
      .select('id,order_id,status,payout_id,amount,currency')
      .eq('id', claim.source_id)
      .maybeSingle(),
  ])
  if (operations.error || payoutResult.error || trancheResult.error) {
    return { ok: false, code: 'RETRY_DATA_UNAVAILABLE' }
  }
  const prior = Array.isArray(operations.data) ? operations.data[0] : null
  const payout = payoutResult.data
  const tranche = trancheResult.data
  if (!prior || !payout || !tranche || prior.status !== 'FAILED_RETURNED' ||
    prior.provider !== 'STRIPE' || prior.provider_transfer_id != null ||
    !prior.provider_source_transaction_id?.trim() || !prior.final_failure_reference?.trim() ||
    !prior.funds_return_reference?.startsWith('NOT_SENT:') ||
    prior.operation_number < 1 || prior.operation_number >= 3 ||
    prior.provider_destination_id !== claim.provider_destination_id ||
    prior.currency !== claim.currency || prior.amount !== claim.amount ||
    payout.status !== 'FAILED' || payout.payout_purpose !== 'SETTLEMENT_TRANCHE' || payout.provider !== 'STRIPE' ||
    payout.order_id !== claim.order_id || payout.amount !== claim.amount ||
    payout.currency !== claim.currency || payout.provider_destination_id !== claim.provider_destination_id ||
    tranche.status !== 'BLOCKED' || tranche.order_id !== claim.order_id ||
    tranche.payout_id !== payout.id || tranche.amount !== claim.amount || tranche.currency !== claim.currency) {
    return { ok: false, code: 'RETRY_EVIDENCE_MISMATCH' }
  }
  const confirmedAt = typeof prior.funds_return_confirmed_at === 'string'
    ? prior.funds_return_confirmed_at
    : null
  if (!isPayoutClaimRetryGraceElapsed(confirmedAt, nowMs)) {
    return { ok: false, code: 'RETRY_GRACE_ACTIVE' }
  }

  const [authorizationResult, requestResult] = await Promise.all([
    client.from('payout_claim_retry_authorizations').select('id').eq('prior_operation_id', prior.id).maybeSingle(),
    client.from('money_desk_requests')
      .select('id,status,created_at,idempotency_key')
      .eq('action_type', 'POST_RELEASE_RECOVERY')
      .eq('target_type', 'PAYOUT_CLAIM_RETRY')
      .eq('target_id', claim.id)
      .order('created_at', { ascending: false })
      .limit(20),
  ])
  if (authorizationResult.error || requestResult.error) return { ok: false, code: 'RETRY_DATA_UNAVAILABLE' }
  if (authorizationResult.data?.id) return { ok: false, code: 'RETRY_ALREADY_AUTHORIZED' }
  const requests = Array.isArray(requestResult.data) ? requestResult.data as Array<Record<string, unknown>> : []
  const latestTerminal = requests.find((request) => ['FAILED', 'REJECTED', 'CANCELLED'].includes(String(request.status)))
  const latestTerminalRequestId = typeof latestTerminal?.id === 'string' ? latestTerminal.id : null
  const snapshot = {
    claimId: String(claim.id), orderId: String(claim.order_id), trancheId: String(claim.source_id),
    priorOperationId: String(prior.id), nextOperationNumber: Number(prior.operation_number) + 1,
    provider: 'STRIPE' as const, destinationId: String(claim.provider_destination_id), currency: String(claim.currency),
    amount: Number(claim.amount), sourceTransaction: String(prior.provider_source_transaction_id),
    finalFailureReference: String(prior.final_failure_reference), fundsReturnReference: String(prior.funds_return_reference),
    fundsReturnConfirmedAt: confirmedAt!, latestTerminalRequestId,
  }
  const key = payoutClaimRetryIdempotencyKey(snapshot)
  if (requests.some((request) => ['PENDING_APPROVAL', 'APPROVED', 'EXECUTING'].includes(String(request.status)) && request.idempotency_key !== key)) {
    return { ok: false, code: 'ACTIVE_REQUEST_EXISTS' }
  }

  return {
    ok: true,
    snapshot,
  }
}

export function payoutClaimRetryIdempotencyKey(snapshot: Pick<PreparedClaimRetrySnapshot, 'claimId' | 'priorOperationId' | 'latestTerminalRequestId'>) {
  return `payout-claim-retry:${snapshot.claimId}:after:${snapshot.priorOperationId}:request:${snapshot.latestTerminalRequestId ?? 'none'}`
}

export type PreparedClaimRetryActor = {
  email: string
  subject: string
  role: string
}

export type PreparedClaimRetryRequest = {
  requestId: string
  reference: string | null
  status: string
  requiredApprovalCount: number | null
  riskLevel: string | null
  duplicate: boolean
}

export type PayoutClaimRetryCandidate = {
  claimId: string
  orderId: string
  orderReference: string | null
  trancheId: string
  amount: number
  currency: string
  confirmedAt: string
  availableAt: string
  graceElapsed: boolean
  request: { id: string; reference: string; status: string } | null
}

export function buildPayoutClaimRetryCandidate(input: {
  claim: Record<string, unknown>
  operation: Record<string, unknown> | null
  payout: Record<string, unknown> | null
  tranche: Record<string, unknown> | null
  requests: Array<Record<string, unknown>>
  authorizedPriorOperationId?: string | null
  orderReference?: string | null
  nowMs?: number
}): PayoutClaimRetryCandidate | null {
  const { claim, operation, payout, tranche } = input
  if (!operation || !payout || !tranche ||
    claim.source_kind !== 'SETTLEMENT_TRANCHE' || claim.provider !== 'STRIPE' ||
    claim.status !== 'FAILED_RECONCILED' || claim.transfer_status !== 'FAILED_RECONCILED' ||
    claim.provider_transfer_id != null || !claim.payout_id || !claim.provider_destination_id ||
    !claim.order_id || !claim.source_id || !claim.amount || !claim.currency ||
    operation.claim_id !== claim.id || operation.status !== 'FAILED_RETURNED' ||
    operation.provider !== 'STRIPE' || operation.provider_transfer_id != null ||
    !text(operation.provider_source_transaction_id) || !text(operation.final_failure_reference) ||
    !text(operation.funds_return_reference)?.startsWith('NOT_SENT:') ||
    !text(operation.funds_return_confirmed_at) ||
    Number(operation.operation_number) < 1 || Number(operation.operation_number) >= 3 ||
    operation.provider_destination_id !== claim.provider_destination_id ||
    operation.currency !== claim.currency || Number(operation.amount) !== Number(claim.amount) ||
    payout.id !== claim.payout_id || payout.status !== 'FAILED' || payout.payout_purpose !== 'SETTLEMENT_TRANCHE' ||
    payout.provider !== 'STRIPE' ||
    payout.order_id !== claim.order_id || Number(payout.amount) !== Number(claim.amount) ||
    payout.currency !== claim.currency || payout.provider_destination_id !== claim.provider_destination_id ||
    tranche.id !== claim.source_id || tranche.status !== 'BLOCKED' || tranche.order_id !== claim.order_id ||
    tranche.payout_id !== payout.id || Number(tranche.amount) !== Number(claim.amount) || tranche.currency !== claim.currency ||
    input.authorizedPriorOperationId === operation.id) return null

  const confirmedAt = String(operation.funds_return_confirmed_at)
  const availableAt = payoutClaimRetryAvailableAt(confirmedAt)
  if (!availableAt) return null
  const latestTerminalRequest = input.requests
    .filter((request) => ['FAILED', 'REJECTED', 'CANCELLED'].includes(String(request.status)))
    .sort((left, right) => Date.parse(String(right.created_at)) - Date.parse(String(left.created_at)))[0]
  const currentRequest = input.requests.find((request) => ['PENDING_APPROVAL', 'APPROVED', 'EXECUTING'].includes(String(request.status)))

  return {
    claimId: String(claim.id),
    orderId: String(claim.order_id),
    orderReference: input.orderReference ?? null,
    trancheId: String(claim.source_id),
    amount: Number(claim.amount),
    currency: String(claim.currency),
    confirmedAt,
    availableAt,
    graceElapsed: isPayoutClaimRetryGraceElapsed(confirmedAt, input.nowMs),
    request: currentRequest && typeof currentRequest.id === 'string'
      ? { id: currentRequest.id, reference: String(currentRequest.reference ?? 'Money Desk request'), status: String(currentRequest.status) }
      : null,
  }
}

/**
 * Re-read the claim, enforce the grace window, and create the two-person
 * Money Desk review under a key scoped to this exact prior operation. The
 * retry RPC and its triggers remain authoritative at execution time.
 */
export async function preparePayoutClaimRetry(
  client: any,
  input: {
    claimId: string
    reason: string
    actor: PreparedClaimRetryActor
    grantId: string
    correlationId: string
    nowMs?: number
  },
): Promise<
  | { ok: true; snapshot: PreparedClaimRetrySnapshot; request: PreparedClaimRetryRequest }
  | { ok: false; code: ClaimRetryPreparationError }
> {
  const reason = input.reason.trim()
  if (reason.length < 12 || reason.length > 1_000) return { ok: false, code: 'INVALID_REASON' }
  const prepared = await readPreparedClaimRetrySnapshot(client, input.claimId, input.nowMs)
  if (!prepared.ok) return prepared

  const snapshot = prepared.snapshot
  const submitted = await client.rpc('submit_money_desk_request', {
    p_idempotency_key: payoutClaimRetryIdempotencyKey(snapshot),
    p_jit_grant_id: input.grantId,
    p_actor_email: input.actor.email.toLowerCase(),
    p_actor_subject: input.actor.subject,
    p_actor_role: input.actor.role.toUpperCase(),
    p_action_type: 'POST_RELEASE_RECOVERY',
    p_target_type: 'PAYOUT_CLAIM_RETRY',
    p_target_id: snapshot.claimId,
    p_order_id: snapshot.orderId,
    p_case_id: null,
    p_amount: snapshot.amount,
    p_currency: snapshot.currency,
    p_amount_usd_equivalent: null,
    p_usd_equivalent_source: null,
    p_reason: reason,
    p_action_payload: {
      schemaVersion: 'payout-claim-retry/v1',
      claimId: snapshot.claimId,
      trancheId: snapshot.trancheId,
      priorOperationId: snapshot.priorOperationId,
      nextOperationNumber: snapshot.nextOperationNumber,
      provider: snapshot.provider,
      destinationId: snapshot.destinationId,
      sourceTransaction: snapshot.sourceTransaction,
      finalFailureReference: snapshot.finalFailureReference,
      fundsReturnReference: snapshot.fundsReturnReference,
    },
    p_correlation_id: input.correlationId,
  })
  if (submitted.error) return { ok: false, code: 'REQUEST_SUBMISSION_FAILED' }
  const row = submitted.data && typeof submitted.data === 'object' && !Array.isArray(submitted.data)
    ? submitted.data as Record<string, unknown>
    : null
  if (typeof row?.requestId !== 'string' || typeof row.status !== 'string') {
    return { ok: false, code: 'REQUEST_SUBMISSION_FAILED' }
  }
  const requiredApprovalCount = typeof row.requiredApprovalCount === 'number'
    ? row.requiredApprovalCount
    : null
  if (requiredApprovalCount !== 2) {
    return { ok: false, code: 'REQUEST_SUBMISSION_FAILED' }
  }
  return {
    ok: true,
    snapshot,
    request: {
      requestId: row.requestId,
      reference: typeof row.reference === 'string' ? row.reference : null,
      status: row.status,
      requiredApprovalCount,
      riskLevel: typeof row.riskLevel === 'string' ? row.riskLevel : null,
      duplicate: row.duplicate === true,
    },
  }
}
