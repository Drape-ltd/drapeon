import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { ProviderAdapter, ProviderResult } from './claimed-payout-execution.ts'
import {
  blockTipPayoutIdentityConflict,
  recordTipMoneyOperationOutcome,
  startTipMoneyOperationProviderCall,
  type TipClaimStatus,
} from './tip-money-claims.ts'

export type TipPayoutExecutionResult =
  | { kind: 'CONFIRMED'; transferId: string; lateSuccess: boolean }
  | { kind: 'PENDING'; reason: 'PROVIDER_PENDING' | 'PROVIDER_UNKNOWN'; transferId?: string | null }
  | { kind: 'BLOCKED'; reason: 'PROVIDER_IDENTITY_CONFLICT' }

type StartResult = Awaited<ReturnType<typeof startTipMoneyOperationProviderCall>>

type ExecutionDependencies = {
  start: typeof startTipMoneyOperationProviderCall
  record: typeof recordTipMoneyOperationOutcome
  blockIdentityConflict: typeof blockTipPayoutIdentityConflict
}

const database: ExecutionDependencies = {
  start: startTipMoneyOperationProviderCall,
  record: recordTipMoneyOperationOutcome,
  blockIdentityConflict: blockTipPayoutIdentityConflict,
}

function hasInFlightOrTerminalStatus(status: TipClaimStatus | undefined) {
  return status === 'PROVIDER_PENDING' || status === 'SUCCEEDED' || status === 'FAILED_RECONCILED'
}

async function recordUncertain(
  supabase: SupabaseClient,
  input: {
    claimId: string
    provider: string
    previousStatus?: TipClaimStatus
    evidence: Record<string, unknown>
  },
  deps: ExecutionDependencies,
) {
  // An unknown lookup cannot regress an existing pending or terminal provider
  // result. Preserve that durable evidence and let the watchdog retry the read.
  if (hasInFlightOrTerminalStatus(input.previousStatus)) return
  await deps.record(supabase, {
    claimId: input.claimId,
    status: 'PROVIDER_UNKNOWN',
    provider: input.provider,
    evidence: input.evidence,
  })
}

/**
 * Runs the provider side of a TIP payout only after the DB start gate commits.
 * Every re-entry after that point is lookup-only, including after the provider's
 * idempotency retention expires. `finalize` is called only after identity
 * verification and durable SUCCEEDED evidence.
 */
export async function executeClaimedTipTransfer(
  input: {
    supabase: SupabaseClient
    claimId: string
    requestKey: string
    providerName: string
    provider: Pick<ProviderAdapter, 'send' | 'lookup' | 'verify'>
    finalize: (transferId: string, evidence: Record<string, unknown>) => Promise<void>
    onTerminalConflict?: (status: TipClaimStatus, evidence: Record<string, unknown>) => Promise<void>
  },
  deps: ExecutionDependencies = database,
): Promise<TipPayoutExecutionResult> {
  const start: StartResult = await deps.start(input.supabase, input.claimId)
  const priorStatus = start.status
  if (priorStatus === 'BLOCKED_IDENTITY') {
    return { kind: 'BLOCKED', reason: 'PROVIDER_IDENTITY_CONFLICT' }
  }
  if (start.provider && start.provider !== input.providerName) {
    const evidence = {
      identity_conflict: true,
      expected_provider: input.providerName,
      claimed_provider: start.provider,
    }
    if (priorStatus === 'SUCCEEDED' || priorStatus === 'FAILED_RECONCILED') {
      await input.onTerminalConflict?.(priorStatus, evidence)
      return { kind: 'BLOCKED', reason: 'PROVIDER_IDENTITY_CONFLICT' }
    }
    await deps.blockIdentityConflict(input.supabase, {
      claimId: input.claimId,
      provider: input.providerName,
      evidence,
    })
    return { kind: 'BLOCKED', reason: 'PROVIDER_IDENTITY_CONFLICT' }
  }

  let result: ProviderResult
  try {
    result = start.action === 'SEND'
      ? await input.provider.send(input.requestKey)
      : await input.provider.lookup(input.requestKey, start.provider_operation_id)
  } catch (error) {
    await recordUncertain(input.supabase, {
      claimId: input.claimId,
      provider: input.providerName,
      previousStatus: priorStatus,
      evidence: {
        stage: start.action,
        error: error instanceof Error ? error.message : String(error),
      },
    }, deps)
    return { kind: 'PENDING', reason: 'PROVIDER_UNKNOWN', transferId: start.provider_operation_id }
  }

  if (result.kind === 'UNKNOWN') {
    await recordUncertain(input.supabase, {
      claimId: input.claimId,
      provider: input.providerName,
      previousStatus: priorStatus,
      evidence: result.evidence,
    }, deps)
    if (priorStatus === 'FAILED_RECONCILED' || priorStatus === 'SUCCEEDED') {
      await input.onTerminalConflict?.(priorStatus, result.evidence)
    }
    return { kind: 'PENDING', reason: 'PROVIDER_UNKNOWN', transferId: start.provider_operation_id }
  }

  if (result.kind === 'PENDING') {
    if (priorStatus === 'FAILED_RECONCILED' || priorStatus === 'SUCCEEDED') {
      const evidence = { ...result.evidence, unexpected_nonterminal_after_terminal: true }
      await input.onTerminalConflict?.(priorStatus, evidence)
      return { kind: 'PENDING', reason: 'PROVIDER_UNKNOWN', transferId: start.provider_operation_id }
    }
    input.provider.verify(result)
    await deps.record(input.supabase, {
      claimId: input.claimId,
      status: 'PROVIDER_PENDING',
      provider: input.providerName,
      providerOperationId: result.transferId ?? start.provider_operation_id,
      evidence: result.evidence,
    })
    return { kind: 'PENDING', reason: 'PROVIDER_PENDING', transferId: result.transferId ?? start.provider_operation_id }
  }

  try {
    input.provider.verify(result)
    if (start.provider_operation_id && result.transferId !== start.provider_operation_id) {
      throw new Error('Provider returned a different TIP transfer than the stored operation.')
    }
  } catch (error) {
    const evidence = {
      ...result.evidence,
      identity_conflict: true,
      verification_error: error instanceof Error ? error.message : String(error),
    }
    if (priorStatus === 'SUCCEEDED' || priorStatus === 'FAILED_RECONCILED') {
      await input.onTerminalConflict?.(priorStatus, evidence)
    } else {
      await deps.blockIdentityConflict(input.supabase, {
        claimId: input.claimId,
        provider: input.providerName,
        evidence,
      })
    }
    return { kind: 'BLOCKED', reason: 'PROVIDER_IDENTITY_CONFLICT' }
  }

  const lateSuccess = priorStatus === 'FAILED_RECONCILED'
  await deps.record(input.supabase, {
    claimId: input.claimId,
    status: 'SUCCEEDED',
    provider: input.providerName,
    providerOperationId: result.transferId,
    evidence: {
      ...result.evidence,
      ...(lateSuccess ? { late_success_after_failure: true } : {}),
    },
  })
  await input.finalize(result.transferId, result.evidence)
  return { kind: 'CONFIRMED', transferId: result.transferId, lateSuccess }
}
