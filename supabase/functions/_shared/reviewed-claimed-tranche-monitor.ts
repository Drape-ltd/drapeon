import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

type RetryRequest = {
  id: string
  target_id: string
  action_payload: unknown
  order_id: string | null
}

export type ReviewedRetryResumeDeps = {
  serviceRoleKey: string
  recordFailure: (request: RetryRequest) => Promise<boolean>
  closeUnstarted: (request: RetryRequest) => Promise<
    'CLOSED_NO_OPERATION' | 'ALREADY_TERMINAL' | 'PROVIDER_OPERATION_POSSIBLE'>
}

/** Resume the exact approved request after a crash or lost Edge response.
 * Provider reconciliation and terminal Money Desk completion remain in the
 * normal route-claim monitor; this sweep never creates a new review. */
export async function resumeReviewedClaimedTrancheAttempts(
  supabase: SupabaseClient,
  deps: ReviewedRetryResumeDeps,
) {
  const { data: requests, error } = await supabase
    .from('money_desk_requests')
    .select('id,target_id,action_payload,order_id')
    .eq('action_type', 'POST_RELEASE_RECOVERY')
    .eq('target_type', 'PAYOUT_CLAIM_RETRY')
    .eq('status', 'EXECUTING')
    .order('updated_at', { ascending: true })
    .limit(20)
  if (error) throw error
  let checked = 0
  let pending = 0
  let errors = 0
  for (const request of (requests ?? []) as RetryRequest[]) {
    const { data: attempt, error: attemptError } = await supabase
      .from('money_desk_execution_attempts')
      .select('id')
      .eq('request_id', request.id)
      .eq('status', 'PROCESSING')
      .limit(1)
      .maybeSingle()
    if (attemptError) throw attemptError
    if (!attempt?.id) continue
    checked += 1
    const payload = request.action_payload && typeof request.action_payload === 'object'
      && !Array.isArray(request.action_payload)
      ? request.action_payload as Record<string, unknown> : {}
    const trancheId = typeof payload.trancheId === 'string' ? payload.trancheId : null
    if (!trancheId || payload.claimId !== request.target_id) {
      errors += 1
      const close = await deps.closeUnstarted(request)
      if (close === 'PROVIDER_OPERATION_POSSIBLE' && !await deps.recordFailure(request)) {
        throw new Error('REVIEWED_RETRY_OPS_CASE_FAILED')
      }
      continue
    }
    const { data: claim, error: claimError } = await supabase
      .from('payout_claims')
      .select('status,source_kind,source_id')
      .eq('id', request.target_id)
      .maybeSingle()
    if (claimError) throw claimError
    if (claim?.source_kind !== 'SETTLEMENT_TRANCHE' || claim.source_id !== trancheId) {
      errors += 1
      const close = await deps.closeUnstarted(request)
      if (close === 'PROVIDER_OPERATION_POSSIBLE' && !await deps.recordFailure(request)) {
        throw new Error('REVIEWED_RETRY_OPS_CASE_FAILED')
      }
      continue
    }
    if (claim.status === 'TRANSFERRED') continue
    try {
      const { data, error: invokeError } = await supabase.functions.invoke(
        'release-settlement-tranche', {
          body: { trancheId, moneyDeskRequestId: request.id },
          headers: { Authorization: `Bearer ${deps.serviceRoleKey}`, apikey: deps.serviceRoleKey },
        },
      )
      const result = data && typeof data === 'object' ? data as Record<string, unknown> : {}
      if (invokeError || result.ok !== true) throw invokeError ??
        new Error('Reviewed retry Edge action has no confirmed outcome')
      pending += 1
    } catch {
      errors += 1
      const close = await deps.closeUnstarted(request)
      if (close === 'PROVIDER_OPERATION_POSSIBLE' && !await deps.recordFailure(request)) {
        throw new Error('REVIEWED_RETRY_OPS_CASE_FAILED')
      }
    }
  }
  return { checked, pending, errors }
}
