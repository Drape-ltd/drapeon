import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  recordPayoutAttemptOutcome,
  reservePayoutClaim,
  startPayoutAttempt,
  type PayoutAttemptAction,
  type PayoutClaimIdentity,
  type PayoutClaimReservation,
} from './payout-claims.ts'
import { sanitizeTelemetryValue } from './telemetry-scrub.ts'
import { createOrRefreshOpsIssue } from './ops-issues.ts'

export type ProviderResult =
  | { kind: 'CONFIRMED'; transferId: string; evidence: Record<string, unknown> }
  | { kind: 'PENDING'; transferId?: string | null; evidence: Record<string, unknown> }
  | { kind: 'UNKNOWN'; evidence: Record<string, unknown> }

export type ClaimedPayoutResult =
  | { kind: 'CONFIRMED'; claimId: string; transferId: string }
  | { kind: 'PENDING'; claimId: string; reason: 'PROVIDER_PENDING' | 'PROVIDER_UNKNOWN' | 'RECONCILE_FIRST' }
  | { kind: 'BLOCKED'; claimId: string; reason?: 'PROVIDER_IDENTITY_CONFLICT' }

export type ProviderAdapter = {
  send: (key: string, operation?: PayoutProviderOperation) => Promise<ProviderResult>
  lookup: (key: string, knownTransferId: string | null, operation?: PayoutProviderOperation) => Promise<ProviderResult>
  verify: (result: ProviderResult, operation?: PayoutProviderOperation) => void
}

export type PayoutProviderOperation = {
  id: string
  number: number
  provider: string
  destinationId: string
  currency: string
  amount: number
  idempotencyKey: string
  transferId: string | null
  reviewedCorrectionId: string | null
  moneyDeskRequestId: string | null
}

function operationFromAction(
  action: PayoutAttemptAction,
  claim: PayoutClaimIdentity,
): PayoutProviderOperation {
  if (!action.claim_operation_id || !Number.isInteger(action.operation_number)
    || !action.provider_idempotency_key || !action.provider || !action.provider_destination_id
    || !action.currency || !Number.isSafeInteger(action.amount) || action.amount! <= 0) {
    throw new Error('Payout start did not return a complete provider operation identity')
  }
  if (action.provider !== claim.provider || action.currency !== claim.currency
    || action.amount !== claim.amount) {
    throw new Error('Provider operation changes the frozen provider, amount, or currency')
  }
  const expectedKey = action.operation_number === 1
    ? claim.providerIdempotencyKey
    : `${claim.businessKey}:op:${action.operation_number}`
  if (action.provider_idempotency_key !== expectedKey) {
    throw new Error('Provider operation does not use its fixed operation-specific key')
  }
  if ((action.operation_number === 1 && (action.reviewed_correction_id || action.money_desk_request_id))
    || (action.operation_number! > 1
      && (!action.reviewed_correction_id || !action.money_desk_request_id))) {
    throw new Error('Replacement payout operation is missing reviewed correction evidence')
  }
  if (action.operation_number === 1 && action.provider_destination_id !== claim.destinationId) {
    throw new Error('Initial provider operation changes the frozen payout destination')
  }
  return {
    id: action.claim_operation_id,
    number: action.operation_number!,
    provider: action.provider,
    destinationId: action.provider_destination_id,
    currency: action.currency,
    amount: action.amount!,
    idempotencyKey: action.provider_idempotency_key,
    transferId: action.provider_transfer_id ?? null,
    reviewedCorrectionId: action.reviewed_correction_id ?? null,
    moneyDeskRequestId: action.money_desk_request_id ?? null,
  }
}

type ClaimDependencies = {
  reserve: typeof reservePayoutClaim
  start: typeof startPayoutAttempt
  record: typeof recordPayoutAttemptOutcome
  blockConflict: (supabase: SupabaseClient, input: {
    attemptId: string; evidence: Record<string, unknown>
  }) => Promise<void>
  blockLateConflict: (supabase: SupabaseClient, input: {
    claimId: string; evidence: Record<string, unknown>
  }) => Promise<void>
  lateConflict: (supabase: SupabaseClient, input: {
    claimId: string; identity: PayoutClaimIdentity; evidence: Record<string, unknown>
  }) => Promise<void>
}

export async function queueLatePayoutConflict(
  supabase: SupabaseClient,
  input: { claimId: string; identity: PayoutClaimIdentity; evidence: Record<string, unknown> },
  persistIssue: typeof createOrRefreshOpsIssue = createOrRefreshOpsIssue,
): Promise<void> {
  const issue = await persistIssue(supabase, {
    issueType: 'PAYOUT_FAILED', severity: 'CRITICAL',
    source: 'claimed-payout-execution', orderId: input.identity.orderId,
    relatedEntityType: 'PAYOUT_CLAIM', relatedEntityId: input.claimId,
    provider: input.identity.provider,
    title: 'Confirmed payout changed before ledger completion',
    description: 'Provider transfer evidence changed after confirmation; local payout completion was held.',
    recommendedAction: 'Reconcile the exact provider transfer and bank-withdrawal state before completing or replacing this earning.',
    dedupeKey: `payout-late-provider-conflict:${input.claimId}`,
    queueKey: 'money-desk',
    persistWhenRoutineDisabled: true,
    metadata: {
      claim_id: input.claimId,
      provider_evidence: sanitizeTelemetryValue(input.evidence),
    },
  })
  if (!issue) throw new Error('Late payout conflict could not be queued for Ops')
}

const database: ClaimDependencies = {
  reserve: reservePayoutClaim,
  start: startPayoutAttempt,
  record: recordPayoutAttemptOutcome,
  blockConflict: async (supabase, input) => {
    const { data, error } = await supabase.rpc('block_payout_claim_identity_conflict', {
      p_attempt_id: input.attemptId, p_evidence: input.evidence,
    })
    if (error || data?.outcome !== 'BLOCKED') {
      throw new Error(error?.message ?? 'Payout identity conflict could not be blocked and queued for Ops')
    }
  },
  blockLateConflict: async (supabase, input) => {
    const { data, error } = await supabase.rpc('block_confirmed_payout_identity_conflict', {
      p_claim_id: input.claimId, p_evidence: input.evidence,
    })
    if (error || !['BLOCKED', 'EXISTING'].includes(data?.outcome)
      || data?.claim_id !== input.claimId) {
      throw new Error(error?.message ?? 'Confirmed payout conflict could not be durably blocked')
    }
  },
  lateConflict: queueLatePayoutConflict,
}

/** The caller must create/reuse its payout row before this function and make
 * complete() idempotent. Neither the provider request nor ledger completion
 * runs inside a database lock. A missing lookup is UNKNOWN, not permission to
 * replay a transfer outside the provider's idempotency-retention window. */
export async function executeClaimedPayout(
  supabase: SupabaseClient,
  identity: PayoutClaimIdentity,
  provider: ProviderAdapter,
  complete: (transferId: string) => Promise<void>,
  deps: ClaimDependencies = database,
  options: { reconcileOnly?: boolean } = {},
): Promise<ClaimedPayoutResult> {
  if (options.reconcileOnly) {
    throw new Error('Reconciliation requires an existing reserved payout claim')
  }
  const claim = await deps.reserve(supabase, identity)
  return executeReservedPayout(supabase, identity, claim, provider, complete, deps, options)
}

/** Resume a claim reserved by a more restrictive source-specific transaction.
 * In particular, a provider-started operation must not re-run its creation
 * guard after the source payment or Money Desk request changes. */
export async function executeReservedPayout(
  supabase: SupabaseClient,
  identity: PayoutClaimIdentity,
  claim: PayoutClaimReservation,
  provider: ProviderAdapter,
  complete: (transferId: string) => Promise<void>,
  deps: Omit<ClaimDependencies, 'reserve'> = database,
  options: { reconcileOnly?: boolean } = {},
): Promise<ClaimedPayoutResult> {
  if (claim.provider_idempotency_key !== identity.providerIdempotencyKey
    || !claim.claim_id) {
    throw new Error('Reserved payout does not match the frozen provider operation')
  }
  if (claim.status === 'FAILED_RECONCILED' || claim.status === 'BLOCKED') {
    return { kind: 'BLOCKED', claimId: claim.claim_id }
  }
  // A reconcile-only caller must not reserve the first provider attempt. The
  // database start RPC changes RESERVED to PROVIDER_UNKNOWN before returning
  // PROVIDER_CALL, so checking that action afterward would be too late.
  if (options.reconcileOnly && claim.status === 'RESERVED') {
    throw new Error('Reconciliation cannot initiate another provider transfer')
  }
  const action: PayoutAttemptAction = await deps.start(supabase, claim)
  if (action.action === 'BLOCKED') return { kind: 'BLOCKED', claimId: claim.claim_id }
  if (action.action === 'RECONCILE_FIRST') {
    return { kind: 'PENDING', claimId: claim.claim_id, reason: 'RECONCILE_FIRST' }
  }
  if (action.action === 'DONE') {
    const operation = operationFromAction(action, identity)
    if (!action.provider_transfer_id) throw new Error('Confirmed claim has no provider transfer reference')
    let current: ProviderResult
    try {
      current = await provider.lookup(operation.idempotencyKey, action.provider_transfer_id, operation)
    } catch {
      return { kind: 'PENDING', claimId: claim.claim_id, reason: 'PROVIDER_UNKNOWN' }
    }
    if (current.kind !== 'CONFIRMED') {
      return { kind: 'PENDING', claimId: claim.claim_id,
        reason: current.kind === 'PENDING' ? 'PROVIDER_PENDING' : 'PROVIDER_UNKNOWN' }
    }
    try {
      provider.verify(current, operation)
      if (current.transferId !== action.provider_transfer_id) {
        throw new Error('Provider transfer reference changed after payout confirmation')
      }
    } catch (error) {
      const evidence = { ...current.evidence, identity_conflict: true,
        confirmed_transfer_id: action.provider_transfer_id,
        verification_error: error instanceof Error ? error.message : String(error) }
      await deps.blockLateConflict(supabase, { claimId: claim.claim_id, evidence })
      await deps.lateConflict(supabase, { claimId: claim.claim_id, identity,
        evidence })
      return { kind: 'BLOCKED', claimId: claim.claim_id, reason: 'PROVIDER_IDENTITY_CONFLICT' }
    }
    await complete(action.provider_transfer_id)
    return { kind: 'CONFIRMED', claimId: claim.claim_id, transferId: action.provider_transfer_id }
  }
  if (!action.attempt_id || action.provider_idempotency_key !== identity.providerIdempotencyKey) {
    // The claim key is the immutable business key for operation 1. A reviewed
    // correction receives its own deterministic operation key under that claim.
    const expectedOperationKey = action.operation_number === 1
      ? identity.providerIdempotencyKey
      : `${identity.businessKey}:op:${action.operation_number}`
    if (!action.attempt_id || action.provider_idempotency_key !== expectedOperationKey) {
      throw new Error('Claim attempt did not preserve the provider operation key')
    }
  }
  const operation = operationFromAction(action, identity)
  if (options.reconcileOnly && action.action === 'PROVIDER_CALL') {
    throw new Error('Reconciliation cannot initiate another provider transfer')
  }

  let result: ProviderResult
  try {
    result = action.action === 'PROVIDER_CALL'
      ? await provider.send(operation.idempotencyKey, operation)
      : await provider.lookup(operation.idempotencyKey, operation.transferId, operation)
  } catch (error) {
    await deps.record(supabase, {
      attemptId: action.attempt_id,
      status: 'PROVIDER_UNKNOWN',
      evidence: { stage: action.action, error: error instanceof Error ? error.message : String(error) },
    })
    return { kind: 'PENDING', claimId: claim.claim_id, reason: 'PROVIDER_UNKNOWN' }
  }

  try {
    provider.verify(result, operation)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await deps.blockConflict(supabase, {
      attemptId: action.attempt_id,
      evidence: { ...result.evidence, identity_conflict: true, verification_error: message },
    })
    return { kind: 'BLOCKED', claimId: claim.claim_id, reason: 'PROVIDER_IDENTITY_CONFLICT' }
  }

  if (result.kind === 'CONFIRMED') {
    if (!result.transferId) throw new Error('Provider confirmation lacks a transfer ID')
    await deps.record(supabase, {
      attemptId: action.attempt_id, status: 'SUCCEEDED',
      providerTransferId: result.transferId,
      evidence: result.evidence,
    })
    await complete(result.transferId)
    return { kind: 'CONFIRMED', claimId: claim.claim_id, transferId: result.transferId }
  }
  await deps.record(supabase, {
    attemptId: action.attempt_id,
    status: result.kind === 'PENDING' ? 'PROVIDER_PENDING' : 'PROVIDER_UNKNOWN',
    providerTransferId: result.kind === 'PENDING' ? result.transferId : null,
    evidence: result.evidence,
  })
  return { kind: 'PENDING', claimId: claim.claim_id,
    reason: result.kind === 'PENDING' ? 'PROVIDER_PENDING' : 'PROVIDER_UNKNOWN' }
}
