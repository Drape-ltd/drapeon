import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { prepareBachsRefundRecovery } from '../../../packages/shared/src/bachs-refund-recovery-preparation.ts'
import { BachsRequestError, getBachsClient } from '../_shared/bachs.ts'
import {
  createBachsRefundRecoveryTransfer,
  findBachsRefundRecoveryTransfer,
} from '../_shared/bachs-operations.ts'
import { authorizeCronRequest } from '../_shared/cron.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl, supabaseProjectEnvironment } from '../_shared/env.ts'
import { log } from '../_shared/logger.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'

const FN = 'recover-bachs-refund-balance'
const BodySchema = z.object({ moneyDeskRequestId: uuid, moneyDeskAttemptId: uuid })
const json = (body: Record<string, unknown>, status: number, cors: HeadersInit) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

Deno.serve(async (request) => {
  const cors = getCorsHeaders(request)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const unauthorized = await authorizeCronRequest(request, FN, cors)
  if (unauthorized) return unauthorized
  const parsed = parseBody(BodySchema, await request.json().catch(() => ({})))
  if (!parsed.ok) return json({ ok: false, error: 'INVALID_REQUEST' }, 400, cors)

  try {
    const supabaseUrl = getSupabaseUrl()
    const environment = Deno.env.get('DRAPE_OPS_ENV')?.trim().toLowerCase()
    if (environment !== 'development' || supabaseProjectEnvironment(supabaseUrl) !== 'DEVELOPMENT') {
      return json({ ok: false, error: 'DEV_ONLY' }, 403, cors)
    }
    const client = createClient(supabaseUrl, getServiceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const [requestResult, attemptResult] = await Promise.all([
      client.from('money_desk_requests')
        .select('id,status,action_type,target_type,target_id,order_id,amount,currency,reason,action_payload,requester_subject,required_approval_count,approval_count,approved_at,idempotency_key')
        .eq('id', parsed.data.moneyDeskRequestId).maybeSingle(),
      client.from('money_desk_execution_attempts')
        .select('id,request_id,status,provider_reference')
        .eq('id', parsed.data.moneyDeskAttemptId).maybeSingle(),
    ])
    const moneyRequest = requestResult.data
    const executionAttempt = attemptResult.data
    if (requestResult.error || attemptResult.error || !moneyRequest || !executionAttempt ||
      executionAttempt.request_id !== moneyRequest.id ||
      moneyRequest.action_type !== 'OTHER_REVIEWED' || moneyRequest.target_type !== 'BACHS_REFUND_RECOVERY') {
      return json({ ok: false, error: 'REVIEW_REQUEST_MISMATCH' }, 409, cors)
    }
    if (moneyRequest.status === 'SUCCEEDED' && executionAttempt.status === 'SUCCEEDED' &&
      executionAttempt.provider_reference?.startsWith('tr_')) {
      return json({ ok: true, duplicate: true, providerReference: executionAttempt.provider_reference }, 200, cors)
    }
    if (moneyRequest.status !== 'EXECUTING' || executionAttempt.status !== 'PROCESSING' ||
      moneyRequest.required_approval_count !== 2 || moneyRequest.approval_count < 2 || !moneyRequest.approved_at) {
      return json({ ok: false, error: 'TWO_PERSON_REVIEW_REQUIRED' }, 409, cors)
    }
    const decisionResult = await client.from('money_desk_decisions')
      .select('approver_subject').eq('request_id', moneyRequest.id).eq('decision', 'APPROVE')
    const independentApprovers = new Set((decisionResult.data ?? [])
      .map((decision) => decision.approver_subject)
      .filter((subject): subject is string => typeof subject === 'string' && subject !== moneyRequest.requester_subject))
    if (decisionResult.error || independentApprovers.size < 2) {
      return json({ ok: false, error: 'INDEPENDENT_APPROVALS_MISSING' }, 409, cors)
    }

    const payload = record(moneyRequest.action_payload)
    const claimId = String(payload.refundClaimId ?? '')
    const opsIssueId = String(payload.opsIssueId ?? '')
    const [claimResult, issueResult] = await Promise.all([
      client.from('order_payment_refund_claims')
        .select('id,payment_id,order_id,provider,currency,refund_amount,status,refund_context')
        .eq('id', moneyRequest.target_id).maybeSingle(),
      client.from('ops_issues').select('id,order_id,status,issue_type,dedupe_key')
        .eq('id', opsIssueId).maybeSingle(),
    ])
    const claim = claimResult.data
    const issue = issueResult.data
    if (claimResult.error || issueResult.error || !claim || !issue || claim.id !== claimId) {
      return json({ ok: false, error: 'REFUND_RECOVERY_CASE_UNAVAILABLE' }, 409, cors)
    }
    const [paymentResult, attemptHistoryResult, orderResult, previousRequestResult] = await Promise.all([
      client.from('order_payments')
        .select('id,order_id,provider,provider_payment_id,currency,status')
        .eq('id', claim.payment_id).maybeSingle(),
      client.from('order_payment_refund_attempts')
        .select('id,status,provider_evidence').eq('refund_claim_id', claim.id)
        .order('attempt_number', { ascending: false }).limit(1).maybeSingle(),
      client.from('orders').select('reference,payout_destination_id')
        .eq('id', claim.order_id).maybeSingle(),
      client.from('money_desk_requests').select('id')
        .eq('action_type', 'OTHER_REVIEWED').eq('target_type', 'BACHS_REFUND_RECOVERY')
        .eq('target_id', claim.id).neq('id', moneyRequest.id).limit(1),
    ])
    const payment = paymentResult.data
    const failedAttempt = attemptHistoryResult.data
    const order = orderResult.data
    if (paymentResult.error || attemptHistoryResult.error || orderResult.error || previousRequestResult.error ||
      !payment || !failedAttempt || !order?.payout_destination_id || (previousRequestResult.data?.length ?? 0) > 0) {
      return json({ ok: false, error: 'REFUND_RECOVERY_SOURCE_CONFLICT' }, 409, cors)
    }
    const destinationResult = await client.from('payout_destinations')
      .select('provider,provider_account_ref,currency,active,transfers_enabled')
      .eq('id', order.payout_destination_id).maybeSingle()
    const destination = destinationResult.data
    if (destinationResult.error || !destination) return json({ ok: false, error: 'PINNED_DESTINATION_UNAVAILABLE' }, 409, cors)
    const payoutClaimsResult = await client.from('payout_claims')
      .select('amount,currency,status,provider_destination_id')
      .eq('order_id', claim.order_id).eq('provider', 'BACHS')
      .eq('status', 'TRANSFERRED').eq('provider_destination_id', destination.provider_account_ref)
    if (payoutClaimsResult.error) return json({ ok: false, error: 'TRANSFER_HISTORY_UNAVAILABLE' }, 503, cors)
    const transferredAmount = (payoutClaimsResult.data ?? [])
      .filter((row) => row.currency === claim.currency)
      .reduce((sum, row) => sum + (Number.isSafeInteger(row.amount) ? row.amount : 0), 0)
    const confirmation = {
      orderReference: String(payload.orderReference ?? ''),
      amount: Number(payload.refundAmount),
      currency: String(payload.currency ?? ''),
    }
    const prepared = prepareBachsRefundRecovery({
      claim: { id: claim.id, paymentId: claim.payment_id, orderId: claim.order_id,
        provider: claim.provider, currency: claim.currency, refundAmount: claim.refund_amount,
        status: claim.status, refundContext: claim.refund_context },
      payment: { id: payment.id, orderId: payment.order_id, provider: payment.provider,
        providerPaymentId: payment.provider_payment_id, currency: payment.currency, status: payment.status },
      failedAttempt: { id: failedAttempt.id, status: failedAttempt.status,
        providerEvidence: failedAttempt.provider_evidence },
      issue: { id: issue.id, orderId: issue.order_id, issueType: issue.issue_type,
        status: issue.status, dedupeKey: issue.dedupe_key },
      destination: { provider: destination.provider, providerAccountRef: destination.provider_account_ref,
        currency: destination.currency, active: destination.active, transfersEnabled: destination.transfers_enabled },
      transferredAmount,
      orderReference: order.reference,
      latestRequest: null,
      confirmation,
    })
    if (!prepared.ok || prepared.targetId !== moneyRequest.target_id ||
      prepared.amount !== moneyRequest.amount || prepared.currency !== moneyRequest.currency ||
      prepared.idempotencyKey !== moneyRequest.idempotency_key ||
      payload.sourceAccountId !== destination.provider_account_ref ||
      payload.recoveryAmount !== prepared.amount || payload.paymentId !== payment.id ||
      payload.failedAttemptId !== failedAttempt.id) {
      return json({ ok: false, error: prepared.ok ? 'REVIEWED_AMOUNT_OR_IDENTITY_MISMATCH' : prepared.code }, 409, cors)
    }

    const bachs = getBachsClient()
    const transferGroup = `refund-recovery:${claim.id}`
    const transferMetadata = {
      drapeon_refund_claim_id: claim.id,
      drapeon_money_desk_request_id: moneyRequest.id,
      drapeon_refund_attempt_id: failedAttempt.id,
    }
    const submissionMarker = `BACHS_REFUND_RECOVERY_SUBMISSION:${executionAttempt.id}`
    const existingReference = executionAttempt.provider_reference
    let transfer: Awaited<ReturnType<typeof createBachsRefundRecoveryTransfer>> | null = null

    // A retry of an interrupted execution is read-only. The persisted transfer
    // ID or submission marker prevents another POST, including after Bachs'
    // idempotency window expires.
    if (existingReference) {
      let lookup: Awaited<ReturnType<typeof findBachsRefundRecoveryTransfer>>
      try {
        lookup = await findBachsRefundRecoveryTransfer(bachs, {
          connectedAccountId: destination.provider_account_ref,
          transferGroup,
          metadata: transferMetadata,
          expectedAmountMinor: prepared.amount,
          currency: prepared.currency,
          expectedTransferId: existingReference.startsWith('tr_') ? existingReference : null,
        })
      } catch {
        return json({ ok: true, pending: true, providerReference: existingReference }, 202, cors)
      }
      if (lookup.kind !== 'FOUND') {
        await client.from('ops_audit_logs').insert({
          issue_id: issue.id, action_taken: 'BACHS_REFUND_RECOVERY_TRANSFER_RECONCILIATION_PENDING',
          performed_by: null, performed_role: 'SYSTEM',
          reason: 'The prior Bachs transfer attempt has no uniquely confirmed provider transfer yet. No replacement transfer was sent.',
          before_state: { status: issue.status },
          after_state: { provider_reference_state: lookup.kind, refund_claim_id: claim.id },
        })
        return json({ ok: true, pending: true, providerReference: existingReference }, 202, cors)
      }
      transfer = lookup.transfer
    } else {
      // Search before the first POST as a protection against a transfer created
      // by an earlier runner whose local result did not persist.
      let lookup: Awaited<ReturnType<typeof findBachsRefundRecoveryTransfer>>
      try {
        lookup = await findBachsRefundRecoveryTransfer(bachs, {
          connectedAccountId: destination.provider_account_ref,
          transferGroup,
          metadata: transferMetadata,
          expectedAmountMinor: prepared.amount,
          currency: prepared.currency,
        })
      } catch {
        return json({ ok: true, pending: true, providerReference: null }, 202, cors)
      }
      if (lookup.kind === 'FOUND') {
        transfer = lookup.transfer
      } else if (lookup.kind !== 'NOT_FOUND') {
        await client.from('ops_audit_logs').insert({
          issue_id: issue.id, action_taken: 'BACHS_REFUND_RECOVERY_TRANSFER_RECONCILIATION_PENDING',
          performed_by: null, performed_role: 'SYSTEM',
          reason: 'Bachs transfer history is ambiguous or incomplete. No recovery transfer was sent.',
          before_state: { status: issue.status },
          after_state: { provider_reference_state: lookup.kind, refund_claim_id: claim.id },
        })
        return json({ ok: true, pending: true, providerReference: null }, 202, cors)
      } else {
        // Commit the intent before provider I/O. If the response is lost, a
        // later reconciliation lists by immutable claim metadata and never POSTs.
        const marker = await client.from('money_desk_execution_attempts')
          .update({ provider_reference: submissionMarker })
          .eq('id', executionAttempt.id).eq('status', 'PROCESSING')
          .is('provider_reference', null).select('id').maybeSingle()
        if (marker.error || !marker.data?.id) {
          return json({ ok: false, error: 'RECOVERY_PROVIDER_INTENT_NOT_RECORDED' }, 503, cors)
        }
        try {
          transfer = await createBachsRefundRecoveryTransfer(bachs, {
            sourceAccountId: destination.provider_account_ref,
            amountMinor: prepared.amount,
            currency: prepared.currency,
            transferGroup,
            description: `Refund recovery for order ${order.reference}`,
            metadata: transferMetadata,
            idempotencyKey: prepared.idempotencyKey,
          })
        } catch (error) {
          if (error instanceof BachsRequestError && !error.uncertainWrite &&
            error.status !== null && error.status >= 400 && error.status < 500) {
            return json({ ok: false, error: 'RECOVERY_PROVIDER_REJECTED_NO_MOVEMENT' }, 409, cors)
          }
          return json({ ok: true, pending: true, providerReference: submissionMarker }, 202, cors)
        }
      }
    }

    if (!transfer) {
      return json({ ok: true, pending: true, providerReference: submissionMarker }, 202, cors)
    }
    const savedTransferId = await client.from('money_desk_execution_attempts')
      .update({ provider_reference: transfer.id })
      .eq('id', executionAttempt.id).eq('status', 'PROCESSING')
      .select('id').maybeSingle()
    if (savedTransferId.error || !savedTransferId.data?.id) {
      // Keep this Money Desk execution PROCESSING. Its next invocation can
      // recover by claim metadata without issuing a second provider POST.
      return json({ ok: true, pending: true, providerReference: transfer.id }, 202, cors)
    }
    if (transfer.status !== 'paid') {
      await client.from('ops_audit_logs').insert({
        issue_id: issue.id, action_taken: 'BACHS_REFUND_RECOVERY_TRANSFER_PENDING',
        performed_by: null, performed_role: 'SYSTEM', reason: 'Provider transfer has not reached paid status; do not retry the customer refund yet.',
        before_state: { status: issue.status },
        after_state: { provider_transfer_id: transfer.id, amount: prepared.amount,
          currency: prepared.currency, provider_status: transfer.status },
      })
      return json({ ok: true, pending: true, providerReference: transfer.id }, 202, cors)
    }
    const audit = await client.from('ops_audit_logs').insert({
      issue_id: issue.id, action_taken: 'BACHS_REFUND_RECOVERY_TRANSFER_CONFIRMED',
      performed_by: null, performed_role: 'SYSTEM', reason: 'Bachs confirmed the reviewed connected-account recovery transfer.',
      before_state: { status: issue.status },
      after_state: { provider_transfer_id: transfer.id, amount: prepared.amount,
        currency: prepared.currency, provider_status: transfer.status },
    })
    if (audit.error) return json({ ok: true, pending: true, providerReference: transfer.id }, 202, cors)
    return json({ ok: true, providerReference: transfer.id, pending: false }, 200, cors)
  } catch (error) {
    log('error', FN, 'recovery.failed', { code: error instanceof Error ? error.name : 'UNKNOWN' })
    return json({ ok: false, error: 'RECOVERY_UNAVAILABLE' }, 503, cors)
  }
})
