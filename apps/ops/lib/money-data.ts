import 'server-only'

import { MONEY_DESK_ACTION_LABELS, isMoneyDeskActionType } from '@drape/shared/money-desk'
import { buildPayoutClaimRetryCandidate } from '@drape/shared/payout-claim-retry-preparation'
import { invokeOpsReadBroker, requiresOpsEdgeBroker } from '../../web/lib/ops-edge-broker'
import { createServiceRoleClient } from '../../web/lib/server-supabase'

export type MoneyDecision = { id: string; requestId: string; decision: string; approverEmail: string; approverRole: string; reason: string; createdAt: string }
export type MoneyAttempt = { id: string; requestId: string; status: string; executorEmail: string; executorRole: string; providerReference: string | null; failureCode: string | null; failureSummary: string | null; correlationId: string; startedAt: string; completedAt: string | null }
export type MoneyRequest = {
  id: string; reference: string; actionType: string; actionLabel: string; status: string; targetType: string; targetId: string
  orderId: string | null; orderReference: string | null; amount: number | null; currency: string | null; reason: string
  requesterEmail: string; requesterRole: string; riskLevel: string; riskReasons: string[]; requiredApprovalCount: number
  approvalCount: number; policyVersion: string | null; correlationId: string; executionOutcome: string | null; providerReference: string | null
  createdAt: string; updatedAt: string; decisions: MoneyDecision[]; attempts: MoneyAttempt[]
}
export type MoneyData = {
  requests: MoneyRequest[]
  payouts: Array<{ id: string; orderId: string | null; status: string; amount: number; currency: string; provider: string; processedAt: string | null }>
  tranches: Array<{ id: string; orderId: string; code: string; status: string; amount: number; currency: string; eligibleAt: string | null; correlationId: string }>
  retryCandidates: Array<NonNullable<ReturnType<typeof buildPayoutClaimRetryCandidate>>>
  payoutSummary: { pending: number; blocked: number; processing: number }
  settlementSummary: { eligible: number; requested: number; blocked: number }
  observedAt: string
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export async function loadMoneyData(orderId?: string): Promise<MoneyData> {
  if (orderId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)) throw new Error('Invalid order filter.')
  if (requiresOpsEdgeBroker()) {
    const data = await invokeOpsReadBroker<MoneyData>('money', { orderId })
    return {
      ...data,
      payouts: Array.isArray(data.payouts) ? data.payouts : [],
      tranches: Array.isArray(data.tranches) ? data.tranches : [],
      retryCandidates: Array.isArray(data.retryCandidates) ? data.retryCandidates : [],
      requests: data.requests.map((request) => ({
        ...request,
        actionLabel: isMoneyDeskActionType(request.actionType) ? MONEY_DESK_ACTION_LABELS[request.actionType] : request.actionType,
      })),
    }
  }
  const client = createServiceRoleClient()
  if (!client) throw new Error('Money Desk is unavailable because the server database client is not configured.')

  const requestsQuery = client.from('money_desk_requests').select('id,reference,action_type,status,target_type,target_id,order_id,amount,currency,reason,requester_email,requester_role,risk_level,risk_reasons,required_approval_count,approval_count,policy_version,correlation_id,execution_outcome,provider_reference,created_at,updated_at').order('created_at', { ascending: false }).limit(150)
  const payoutsQuery = client.from('payouts').select('id,order_id,status,amount,currency,provider,processed_at').in('status', ['PENDING', 'PROCESSING', 'BLOCKED', 'FAILED']).limit(500)
  const tranchesQuery = client.from('order_settlement_tranches').select('id,order_id,code,status,amount,currency,eligible_at,correlation_id').in('status', ['ELIGIBLE', 'RELEASE_REQUESTED', 'BLOCKED']).limit(500)
  const retryClaimsQuery = client.from('payout_claims')
    .select('id,source_kind,source_id,order_id,provider,provider_destination_id,currency,amount,status,transfer_status,payout_id,provider_transfer_id')
    .eq('source_kind', 'SETTLEMENT_TRANCHE').eq('provider', 'STRIPE')
    .eq('status', 'FAILED_RECONCILED').eq('transfer_status', 'FAILED_RECONCILED')
    .is('provider_transfer_id', null).limit(100)
  if (orderId) {
    requestsQuery.eq('order_id', orderId)
    payoutsQuery.eq('order_id', orderId)
    tranchesQuery.eq('order_id', orderId)
    retryClaimsQuery.eq('order_id', orderId)
  }
  const [requestResult, payoutResult, trancheResult] = await Promise.all([requestsQuery, payoutsQuery, tranchesQuery])
  if (requestResult.error) throw new Error(`Money Desk requests are unavailable: ${requestResult.error.message}`)
  const requestIds = (requestResult.data ?? []).map((row) => String(row.id))
  const [decisionResult, attemptResult] = await Promise.all([
    requestIds.length ? client.from('money_desk_decisions').select('id,request_id,decision,approver_email,approver_role,reason,created_at').in('request_id', requestIds).order('created_at', { ascending: false }).limit(500) : { data: [], error: null },
    requestIds.length ? client.from('money_desk_execution_attempts').select('id,request_id,status,executor_email,executor_role,provider_reference,failure_code,failure_summary,correlation_id,started_at,completed_at').in('request_id', requestIds).order('started_at', { ascending: false }).limit(500) : { data: [], error: null },
  ])

  const retryClaimsResult = await retryClaimsQuery
  if (retryClaimsResult.error) throw new Error(`Claimed payout retry candidates are unavailable: ${retryClaimsResult.error.message}`)
  const retryClaimRows = retryClaimsResult.data ?? []
  const retryClaimIds = retryClaimRows.map((row) => String(row.id))
  const retryPayoutIds = retryClaimRows.map((row) => text(row.payout_id)).filter((value): value is string => Boolean(value))
  const retryTrancheIds = retryClaimRows.map((row) => String(row.source_id))
  const [retryOperations, retryPayouts, retryTranches] = retryClaimIds.length ? await Promise.all([
    client.from('payout_provider_operations').select('id,claim_id,operation_number,provider,provider_destination_id,currency,amount,status,provider_source_transaction_id,final_failure_reference,funds_return_reference,funds_return_confirmed_at,provider_transfer_id').in('claim_id', retryClaimIds).order('operation_number', { ascending: false }).limit(300),
    client.from('payouts').select('id,order_id,status,payout_purpose,amount,currency,provider,provider_destination_id').in('id', retryPayoutIds).limit(100),
    client.from('order_settlement_tranches').select('id,order_id,status,payout_id,amount,currency').in('id', retryTrancheIds).limit(100),
  ]) : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }]
  for (const result of [retryOperations, retryPayouts, retryTranches]) {
    if (result.error) throw new Error(`Claimed payout retry evidence is unavailable: ${result.error.message}`)
  }

  for (const [label, result] of [['Money Desk requests', requestResult], ['Money Desk decisions', decisionResult], ['Money Desk attempts', attemptResult], ['Payout summary', payoutResult], ['Settlement summary', trancheResult]] as const) {
    if (result.error) throw new Error(`${label} is unavailable: ${result.error.message}`)
  }

  const orderIds = [...new Set([
    ...(requestResult.data ?? []).map((row) => text(row.order_id)),
    ...retryClaimRows.map((row) => text(row.order_id)),
  ].filter((value): value is string => Boolean(value)))]
  const orderResult = orderIds.length > 0 ? await client.from('orders').select('id,reference').in('id', orderIds) : { data: [], error: null }
  if (orderResult.error) throw new Error(`Money Desk order context is unavailable: ${orderResult.error.message}`)
  const orders = new Map((orderResult.data ?? []).map((row) => [String(row.id), text(row.reference)]))
  const retryOperationIds = [...new Set((retryOperations.data ?? []).map((row) => String(row.id)))]
  const [retryRequests, retryAuthorizations] = retryClaimIds.length ? await Promise.all([
    client.from('money_desk_requests').select('id,reference,status,target_id,idempotency_key,created_at')
      .eq('action_type', 'POST_RELEASE_RECOVERY').eq('target_type', 'PAYOUT_CLAIM_RETRY').in('target_id', retryClaimIds).limit(500),
    retryOperationIds.length ? client.from('payout_claim_retry_authorizations').select('id,prior_operation_id').in('prior_operation_id', retryOperationIds).limit(300) : { data: [], error: null },
  ]) : [{ data: [], error: null }, { data: [], error: null }]
  for (const result of [retryRequests, retryAuthorizations]) {
    if (result.error) throw new Error(`Claimed payout retry review data is unavailable: ${result.error.message}`)
  }
  const decisions = (decisionResult.data ?? []).map((row) => ({ id: String(row.id), requestId: String(row.request_id), decision: String(row.decision), approverEmail: String(row.approver_email), approverRole: String(row.approver_role), reason: String(row.reason), createdAt: String(row.created_at) }))
  const attempts = (attemptResult.data ?? []).map((row) => ({ id: String(row.id), requestId: String(row.request_id), status: String(row.status), executorEmail: String(row.executor_email), executorRole: String(row.executor_role), providerReference: text(row.provider_reference), failureCode: text(row.failure_code), failureSummary: text(row.failure_summary), correlationId: String(row.correlation_id), startedAt: String(row.started_at), completedAt: text(row.completed_at) }))
  const retryPayoutById = new Map((retryPayouts.data ?? []).map((row) => [String(row.id), row]))
  const retryTrancheById = new Map((retryTranches.data ?? []).map((row) => [String(row.id), row]))
  const latestRetryOperation = new Map<string, Record<string, unknown>>()
  for (const operation of retryOperations.data ?? []) {
    const key = String(operation.claim_id)
    if (!latestRetryOperation.has(key) || Number(operation.operation_number) > Number(latestRetryOperation.get(key)?.operation_number)) latestRetryOperation.set(key, operation)
  }
  const retryRequestsByClaim = new Map<string, Record<string, unknown>[]>()
  for (const request of retryRequests.data ?? []) {
    const key = String(request.target_id)
    retryRequestsByClaim.set(key, [...(retryRequestsByClaim.get(key) ?? []), request])
  }
  const authorizedOperationIds = new Set((retryAuthorizations.data ?? []).map((row) => String(row.prior_operation_id)))
  const nowMs = Date.now()
  const retryCandidates = retryClaimRows.map((claim) => buildPayoutClaimRetryCandidate({
    claim: claim as unknown as Record<string, unknown>,
    operation: latestRetryOperation.get(String(claim.id)) ?? null,
    payout: retryPayoutById.get(String(claim.payout_id)) as unknown as Record<string, unknown> | undefined ?? null,
    tranche: retryTrancheById.get(String(claim.source_id)) as unknown as Record<string, unknown> | undefined ?? null,
    requests: retryRequestsByClaim.get(String(claim.id)) ?? [],
    authorizedPriorOperationId: latestRetryOperation.get(String(claim.id)) && authorizedOperationIds.has(String(latestRetryOperation.get(String(claim.id))?.id))
      ? String(latestRetryOperation.get(String(claim.id))?.id)
      : null,
    orderReference: orders.get(String(claim.order_id)) ?? null,
    nowMs,
  })).filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
  const payoutStatuses = (payoutResult.data ?? []).map((row) => String(row.status).toUpperCase())
  const trancheStatuses = (trancheResult.data ?? []).map((row) => String(row.status).toUpperCase())

  return {
    requests: (requestResult.data ?? []).map((row) => {
      const actionType = String(row.action_type)
      const orderId = text(row.order_id)
      return {
        id: String(row.id), reference: String(row.reference), actionType, actionLabel: isMoneyDeskActionType(actionType) ? MONEY_DESK_ACTION_LABELS[actionType] : actionType,
        status: String(row.status), targetType: String(row.target_type), targetId: String(row.target_id), orderId, orderReference: orderId ? orders.get(orderId) ?? null : null,
        amount: typeof row.amount === 'number' ? row.amount : null, currency: text(row.currency), reason: String(row.reason), requesterEmail: String(row.requester_email), requesterRole: String(row.requester_role),
        riskLevel: String(row.risk_level), riskReasons: Array.isArray(row.risk_reasons) ? row.risk_reasons.map(String) : [], requiredApprovalCount: Number(row.required_approval_count), approvalCount: Number(row.approval_count), policyVersion: text(row.policy_version),
        correlationId: String(row.correlation_id), executionOutcome: text(row.execution_outcome), providerReference: text(row.provider_reference), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
        decisions: decisions.filter((decision) => decision.requestId === String(row.id)), attempts: attempts.filter((attempt) => attempt.requestId === String(row.id)),
      }
    }),
    payouts: (payoutResult.data ?? []).map((row) => ({ id: String(row.id), orderId: text(row.order_id), status: String(row.status), amount: Number(row.amount), currency: String(row.currency), provider: String(row.provider), processedAt: text(row.processed_at) })),
    tranches: (trancheResult.data ?? []).map((row) => ({ id: String(row.id), orderId: String(row.order_id), code: String(row.code), status: String(row.status), amount: Number(row.amount), currency: String(row.currency), eligibleAt: text(row.eligible_at), correlationId: String(row.correlation_id) })),
    retryCandidates,
    payoutSummary: { pending: payoutStatuses.filter((status) => status === 'PENDING').length, blocked: payoutStatuses.filter((status) => ['BLOCKED', 'FAILED'].includes(status)).length, processing: payoutStatuses.filter((status) => status === 'PROCESSING').length },
    settlementSummary: { eligible: trancheStatuses.filter((status) => status === 'ELIGIBLE').length, requested: trancheStatuses.filter((status) => status === 'RELEASE_REQUESTED').length, blocked: trancheStatuses.filter((status) => status === 'BLOCKED').length },
    observedAt: new Date().toISOString(),
  }
}
