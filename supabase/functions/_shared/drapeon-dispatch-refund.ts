import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { minorUnitsToMajorNumber } from '../../../packages/shared/src/money-units.ts'
import { partiallyRefundOrderPayments, type ExactRefundRestoration } from './payment-refunds.ts'
import { createOrRefreshOpsIssue, resolveOpsIssueByDedupeKey } from './ops-issues.ts'
import { Sentry } from './sentry.ts'
import { enqueueBackgroundJob } from './jobs.ts'
import { enqueueDispatchReconciliation } from './drapeon-dispatch-reconciliation.ts'
import { enqueueOrderEventEmailJob, enqueuePushJob, enqueueSmsJob } from './side-effect-jobs.ts'

type FulfillmentRun = {
  id: string
  order_id: string
  customer_refund_amount: number
  customer_refund_tax_amount: number
  customer_refund_status: string
  currency: string
  correlation_id: string
}
function restorationFor(run: FulfillmentRun): ExactRefundRestoration {
  return {
    refundResolutionId: `dispatch-refund:${run.id}`,
    tailorWorkAmount: 0,
    platformFeeAmount: 0,
    taxAmount: run.customer_refund_tax_amount,
    fulfillmentAmount: run.customer_refund_amount,
    consultationAmount: 0,
    promotionAmount: 0,
    drapeonFundedAmount: 0,
  }
}

async function notifyDispatchRefund(
  supabase: SupabaseClient,
  input: { orderId: string; runId: string; succeeded: boolean; amount?: number; currency?: string },
) {
  const { data: order, error } = await supabase.from('orders')
    .select('id,reference,customer_id,tailor_id,stage,currency,total_amount,garment_type,delivery_method')
    .eq('id', input.orderId)
    .maybeSingle()
  if (error) throw error
  if (!order?.id || !order.customer_id) return
  const amountLabel = input.amount != null && input.currency
    ? `${input.currency} ${minorUnitsToMajorNumber(input.amount, input.currency).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : 'the unused delivery amount'
  const title = input.succeeded ? 'Delivery refund completed' : 'Delivery refund needs attention'
  const body = input.succeeded
    ? `${amountLabel} for order ${order.reference} has reached a confirmed refund outcome. Your order remains available in Drapeon.`
    : `${amountLabel} for order ${order.reference} is still protected. Drapeon is checking the provider outcome; do not submit another payment or refund request.`
  const source = 'drapeon-dispatch-refund'
  const terminal = input.succeeded ? 'succeeded' : 'failed'
  await Promise.all([
    enqueuePushJob(supabase, {
      userId: order.customer_id,
      orderId: order.id,
      source,
      idempotencyKey: `dispatch-refund:${input.runId}:${terminal}:customer:push`,
      priority: input.succeeded ? 40 : 10,
      notification: {
        title,
        body,
        preferenceKey: 'orderUpdates',
        interruptionLevel: input.succeeded ? 'active' : 'time-sensitive',
        data: { destination: 'ORDER', orderId: order.id, section: 'dispatch' },
      },
    }),
    enqueueOrderEventEmailJob(supabase, {
      order,
      recipientUserId: order.customer_id,
      audience: 'CUSTOMER',
      subject: title,
      headline: title,
      body,
      ctaLabel: 'View delivery status',
      action: input.succeeded ? 'REFUND_COMPLETED' : 'REFUND_REVIEW',
      source,
      idempotencyKey: `dispatch-refund:${input.runId}:${terminal}:customer:email`,
      priority: input.succeeded ? 40 : 10,
    }),
    ...(!input.succeeded
      ? [enqueueSmsJob(supabase, {
          userId: order.customer_id,
          audience: 'CUSTOMER',
          event: 'DISPATCH_REFUND_REVIEW',
          body,
          source,
          orderId: order.id,
          idempotencyKey: `dispatch-refund:${input.runId}:${terminal}:customer:sms`,
          priority: 10,
        })]
      : []),
  ])
}

export async function enqueueDispatchRefundIfDue(
  supabase: SupabaseClient,
  input: { runId: string; orderId: string; actorId?: string | null; actorRole?: string },
) {
  const { data, error } = await supabase.from('order_fulfillment_runs')
    .select('id,customer_refund_amount,customer_refund_tax_amount,customer_refund_status')
    .eq('id', input.runId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data?.id) throw new Error('The fulfillment run was not found.')
  const refundTotal = Number(data.customer_refund_amount ?? 0) + Number(data.customer_refund_tax_amount ?? 0)
  if (refundTotal <= 0 || !['QUEUED', 'FAILED'].includes(String(data.customer_refund_status))) {
    return { queued: false, refundTotal }
  }
  await enqueueBackgroundJob(supabase, {
    jobType: 'PROCESS_DISPATCH_REFUND',
    eventType: 'dispatch.refund_requested',
    aggregateType: 'order_fulfillment_run',
    aggregateId: input.runId,
    orderId: input.orderId,
    actorId: input.actorId ?? null,
    actorRole: input.actorRole ?? 'SYSTEM',
    idempotencyKey: `dispatch-refund:${input.runId}:${refundTotal}`,
    payload: { runId: input.runId, refundTotal },
    priority: 10,
    maxAttempts: 8,
  })
  return { queued: true, refundTotal }
}

export async function markDispatchRefundTerminal(
  supabase: SupabaseClient,
  input: { resolutionId: string | null; succeeded: boolean; providerReference?: string | null },
) {
  if (!input.resolutionId?.startsWith('dispatch-refund:')) return false
  const runId = input.resolutionId.slice('dispatch-refund:'.length)
  if (!runId) return false
  if (input.succeeded && !input.providerReference?.startsWith('re_')) {
    throw new Error('A successful dispatch refund requires its Stripe refund ID.')
  }
  if (!input.succeeded && input.providerReference) {
    const { data: activeRetries, error: activeError } = await supabase
      .from('dispatch_refund_retry_operations')
      .select('id,status,prior_refund_id')
      .eq('run_id', runId)
      .eq('prior_refund_id', input.providerReference)
      .in('status', ['QUEUED', 'PROCESSING', 'PENDING', 'SUCCEEDED'])
      .limit(1)
    if (activeError) throw new Error(activeError.message)
    if (activeRetries?.length) return false
  }
  const now = new Date().toISOString()
  let update = supabase.from('order_fulfillment_runs')
    .update({
      customer_refund_status: input.succeeded ? 'SUCCEEDED' : 'FAILED',
      customer_refunded_at: input.succeeded ? now : null,
      customer_provider_refund_id: input.succeeded ? input.providerReference : null,
      funding_status: input.succeeded ? 'READY_TO_RECONCILE' : 'EXCEPTION',
      updated_at: now,
    })
    .eq('id', runId)
  if (!input.succeeded) update = update.neq('customer_refund_status', 'SUCCEEDED')
  const { data: run, error } = await update
    .select('id,order_id,correlation_id,customer_refund_amount,customer_refund_tax_amount,currency')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!run?.id) return false
  if (!input.succeeded) {
    if (input.providerReference) await completeReviewedDispatchRefundAttempt(supabase, {
      runId, refundId: input.providerReference, status: 'FAILED', providerStatus: 'FAILED',
    })
    return true
  }

  const { error: eventError } = await supabase.from('order_fulfillment_events').upsert({
    run_id: run.id,
    order_id: run.order_id,
    event_type: 'REFUND_COMPLETED',
    source: 'SYSTEM',
    actor_role: 'SYSTEM',
    idempotency_key: `dispatch-refund-completed:${run.id}`,
    customer_note: 'The unused delivery amount has been returned to the customer.',
    occurred_at: now,
    correlation_id: run.correlation_id,
    payload: { providerReference: input.providerReference ?? null },
  }, { onConflict: 'idempotency_key', ignoreDuplicates: true })
  if (eventError) throw new Error(eventError.message)
  await resolveOpsIssueByDedupeKey(supabase, `dispatch-refund-failed:${run.id}`, {
    provider_refund_id: input.providerReference ?? null,
  })
  if (input.providerReference) {
    const { data: reviewedOperation, error: reviewedError } = await supabase
      .from('dispatch_refund_retry_operations')
      .select('id,prior_refund_id')
      .eq('run_id', run.id)
      .eq('provider_refund_id', input.providerReference)
      .maybeSingle()
    if (reviewedError) throw new Error(reviewedError.message)
    if (reviewedOperation?.prior_refund_id) {
      await resolveOpsIssueByDedupeKey(supabase,
        `stripe-refund-failed:${reviewedOperation.prior_refund_id}`, {
          recovered_by_refund_id: input.providerReference,
          reviewed_operation_id: reviewedOperation.id,
        })
    }
  }
  await notifyDispatchRefund(supabase, {
    orderId: run.order_id,
    runId: run.id,
    succeeded: true,
    amount: Number(run.customer_refund_amount ?? 0) + Number(run.customer_refund_tax_amount ?? 0),
    currency: String(run.currency),
  })
  await enqueueDispatchReconciliation(supabase, {
    runId: run.id,
    orderId: run.order_id,
    sourceId: `refund:${input.providerReference ?? 'terminal'}`,
  })
  await completeReviewedDispatchRefundAttempt(supabase, {
    runId, refundId: input.providerReference!, status: 'SUCCEEDED',
  })
  return true
}

/** Complete only the execution bound to this verified, terminal Stripe refund. */
export async function completeReviewedDispatchRefundAttempt(
  supabase: SupabaseClient,
  input: { runId: string; refundId: string; status: 'SUCCEEDED' | 'FAILED'; providerStatus?: string },
) {
  const { data: operation, error: operationError } = await supabase
    .from('dispatch_refund_retry_operations')
    .select('id,money_desk_request_id,status,provider_refund_id')
    .eq('run_id', input.runId).eq('provider_refund_id', input.refundId).maybeSingle()
  if (operationError) throw new Error(operationError.message)
  if (!operation) return false
  if (operation.status !== input.status || operation.provider_refund_id !== input.refundId) {
    throw new Error('The reviewed dispatch operation is not in the verified terminal state.')
  }
  const { data: attempt, error: attemptError } = await supabase
    .from('money_desk_execution_attempts')
    .select('id,status,provider_reference')
    .eq('request_id', operation.money_desk_request_id)
    .order('started_at', { ascending: false }).limit(1).maybeSingle()
  if (attemptError) throw new Error(attemptError.message)
  if (!attempt?.id) throw new Error('The reviewed dispatch refund has no Money Desk execution attempt.')
  if (attempt.status !== 'PROCESSING') {
    if (attempt.status === input.status && attempt.provider_reference === input.refundId) return true
    throw new Error('The Money Desk attempt conflicts with the terminal Stripe refund.')
  }
  const { data: result, error: completeError } = await supabase.rpc('complete_money_desk_execution', {
    p_attempt_id: attempt.id,
    p_status: input.status,
    p_provider_reference: input.refundId,
    p_failure_code: input.status === 'FAILED' ? 'PROVIDER_REFUND_FAILED' : null,
    p_failure_summary: input.status === 'FAILED'
      ? `Stripe reported the reviewed refund ${input.providerStatus ?? 'failed'}.` : null,
  })
  if (completeError) throw new Error(completeError.message)
  if (result?.status !== input.status) throw new Error('Money Desk did not record the terminal Stripe refund.')
  return true
}

export async function processDispatchRefund(
  supabase: SupabaseClient,
  runId: string,
  dispatchRetryOperationId?: string | null,
  deps: {
    refundPayments?: typeof partiallyRefundOrderPayments
    markTerminal?: typeof markDispatchRefundTerminal
  } = {},
) {
  const { data, error } = await supabase.from('order_fulfillment_runs')
    .select('id,order_id,customer_refund_amount,customer_refund_tax_amount,customer_refund_status,currency,correlation_id')
    .eq('id', runId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data?.id) throw new Error('The fulfillment run was not found.')
  const run = data as FulfillmentRun
  const amount = run.customer_refund_amount + run.customer_refund_tax_amount
  const reviewed = dispatchRetryOperationId
    ? await supabase.from('dispatch_refund_retry_operations')
      .select('id,run_id,payment_id,money_desk_request_id,prior_refund_id,idempotency_key,status,provider_refund_id')
      .eq('id', dispatchRetryOperationId).maybeSingle()
    : null
  if (reviewed?.error) throw new Error(reviewed.error.message)
  const operation = reviewed?.data ?? null
  if (dispatchRetryOperationId && (!operation || operation.run_id !== run.id ||
      !operation.prior_refund_id?.startsWith('re_') ||
      !operation.idempotency_key || !operation.payment_id)) {
    throw new Error('The reviewed dispatch retry is missing its immutable operation binding.')
  }
  if (operation) {
    const { data: request, error: requestError } = await supabase.from('money_desk_requests')
      .select('id,action_type,target_type,target_id,order_id,amount,currency,status')
      .eq('id', operation.money_desk_request_id).maybeSingle()
    if (requestError || !request?.id || request.action_type !== 'CUSTOMER_REFUND' ||
        request.target_type !== 'DISPATCH_REFUND_RETRY' || request.target_id !== run.id ||
        request.order_id !== run.order_id || request.amount !== amount ||
        request.currency !== run.currency || !['EXECUTING', 'SUCCEEDED'].includes(request.status)) {
      throw new Error('The reviewed dispatch retry no longer matches the approved Money Desk snapshot.')
    }
    if (operation.status === 'SUCCEEDED') {
      if (!operation.provider_refund_id) {
        throw new Error('The reviewed operation is marked successful without a Stripe refund ID.')
      }
      if (run.customer_refund_status !== 'SUCCEEDED') {
        await (deps.markTerminal ?? markDispatchRefundTerminal)(supabase, {
          resolutionId: `dispatch-refund:${run.id}`,
          succeeded: true,
          providerReference: operation.provider_refund_id,
        })
      } else {
        await completeReviewedDispatchRefundAttempt(supabase, {
          runId: run.id, refundId: operation.provider_refund_id, status: 'SUCCEEDED',
        })
      }
      return { ok: true, skipped: true, reason: 'REVIEWED_REFUND_ALREADY_RECORDED' }
    }
    if (operation.status === 'FAILED') {
      if (operation.provider_refund_id && run.customer_refund_status === 'FAILED') {
        await completeReviewedDispatchRefundAttempt(supabase, {
          runId: run.id, refundId: operation.provider_refund_id,
          status: 'FAILED', providerStatus: 'failed or canceled',
        })
      }
      throw new Error('The reviewed provider refund failed; a new Money Desk approval is required.')
    }
    if (!['QUEUED', 'PROCESSING', 'PENDING'].includes(operation.status) ||
        run.customer_refund_status === 'SUCCEEDED') {
      throw new Error('The reviewed dispatch retry conflicts with the current refund state.')
    }
    if (operation.status === 'QUEUED') {
      const { error: claimError } = await supabase.from('dispatch_refund_retry_operations')
        .update({ status: 'PROCESSING' }).eq('id', operation.id).eq('status', 'QUEUED')
      if (claimError) throw new Error(claimError.message)
    }
  }
  if (amount <= 0 || run.customer_refund_status === 'SUCCEEDED') {
    return { ok: true, skipped: true, reason: amount <= 0 ? 'NO_REFUND_DUE' : 'ALREADY_REFUNDED' }
  }

  const { error: startError } = await supabase.from('order_fulfillment_runs').update({
    customer_refund_status: 'PROCESSING',
    updated_at: new Date().toISOString(),
  }).eq('id', run.id).neq('customer_refund_status', 'SUCCEEDED')
  if (startError) throw new Error(startError.message)

  let providerRefundId: string | null = null
  let terminalProviderFailure = false
  let terminalProviderSuccess = false
  let failedPaymentId: string | null = null
  try {
    const result = await (deps.refundPayments ?? partiallyRefundOrderPayments)(supabase, {
      orderId: run.order_id,
      amount,
      reason: 'Automatic Drapeon Dispatch reconciliation for unused customer-funded fulfillment.',
      actorRole: 'SYSTEM',
      allowedPhases: ['INITIAL_ORDER'],
      exactRestoration: restorationFor(run),
      paymentAttemptId: operation?.payment_id,
      operationContext: operation ? {
        kind: 'DISPATCH_REFUND_RETRY',
        moneyDeskRequestId: operation.money_desk_request_id,
        dispatchRetryOperationId: operation.id,
        priorRefundId: operation.prior_refund_id,
        paymentAttemptId: operation.payment_id,
        idempotencyKey: operation.idempotency_key,
      } : undefined,
    })
    const pending = result.pendingAttempts.length > 0
    providerRefundId = pending
      ? result.pendingAttempts[0]?.providerRefundId ?? null
      : result.refundedAttempts[0]?.providerRefundId ?? null
    if (pending && result.pendingAttempts.some((attempt) =>
      ['FAILED', 'CANCELED'].includes(attempt.status.toUpperCase()))) {
      terminalProviderFailure = true
      failedPaymentId = result.pendingAttempts[0]?.id ?? null
      throw new Error('The reviewed Stripe refund failed or was canceled; it cannot be retried without another approval.')
    }
    if (pending) {
      const { error: pendingError } = await supabase.from('order_fulfillment_runs').update({
        customer_refund_status: 'PENDING',
        funding_status: 'REFUND_PENDING',
        updated_at: new Date().toISOString(),
      }).eq('id', run.id).neq('customer_refund_status', 'SUCCEEDED')
      if (pendingError) throw new Error(pendingError.message)
      if (operation) {
        const { error: operationError } = await supabase.from('dispatch_refund_retry_operations')
          .update({ status: 'PENDING', provider_refund_id: providerRefundId })
          .eq('id', operation.id).in('status', ['PROCESSING', 'PENDING'])
        if (operationError) throw new Error(operationError.message)
      }
    } else {
      terminalProviderSuccess = Boolean(providerRefundId && result.refundedAttempts.length)
      if (operation) {
        if (!providerRefundId) throw new Error('The reviewed dispatch refund has no provider refund ID.')
        const { error: operationError } = await supabase.from('dispatch_refund_retry_operations')
          .update({ status: 'SUCCEEDED', provider_refund_id: providerRefundId })
          .eq('id', operation.id).in('status', ['PROCESSING', 'PENDING', 'SUCCEEDED'])
        if (operationError) throw new Error(operationError.message)
      }
      await (deps.markTerminal ?? markDispatchRefundTerminal)(supabase, {
        resolutionId: `dispatch-refund:${run.id}`,
        succeeded: true,
        providerReference: providerRefundId,
      })
    }
    return { ok: true, pending, amount, currency: run.currency }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    if (terminalProviderSuccess) {
      await createOrRefreshOpsIssue(supabase, {
        issueType: 'REFUND_FAILED', severity: 'CRITICAL',
        source: 'drapeon-dispatch-refund', actorRole: 'SYSTEM',
        orderId: run.order_id, provider: 'STRIPE',
        title: 'Confirmed dispatch refund needs finalization',
        description: 'Stripe returned a successful refund, but a later local finalization step failed.',
        recommendedAction: 'Reconcile the exact Stripe refund and ledger before replaying the finalizer. Do not send another refund.',
        dedupeKey: `dispatch-refund-finalization:${run.id}:${providerRefundId}`,
        metadata: { run_id: run.id, refund_id: providerRefundId, error: message },
      })
      throw cause
    }
    if (operation && terminalProviderFailure) {
      const { error: operationError } = await supabase.from('dispatch_refund_retry_operations')
        .update({ status: 'FAILED', provider_refund_id: providerRefundId })
        .eq('id', operation.id).in('status', ['QUEUED', 'PROCESSING', 'PENDING'])
      if (operationError) throw new Error(operationError.message)
    }
    if (terminalProviderFailure && providerRefundId && failedPaymentId) {
      await createOrRefreshOpsIssue(supabase, {
        issueType: 'REFUND_FAILED', severity: 'CRITICAL',
        source: 'drapeon-dispatch-refund', actorRole: 'SYSTEM',
        orderId: run.order_id, provider: 'STRIPE',
        title: operation ? 'Reviewed Stripe dispatch refund failed' : 'Stripe dispatch refund failed',
        description: 'The customer refund reached a failed or canceled provider outcome.',
        recommendedAction: 'Match this exact Stripe refund and returned funds before preparing a new Money Desk operation. Do not replay the previous provider request.',
        dedupeKey: `stripe-refund-failed:${providerRefundId}`,
        metadata: {
          payment_id: failedPaymentId,
          refund_id: providerRefundId,
          refund_amount: amount,
          refund_resolution_id: `dispatch-refund:${run.id}`,
          reviewed_operation_id: operation?.id ?? null,
        },
      })
    }
    const { error: failureError } = await supabase.from('order_fulfillment_runs').update({
      customer_refund_status: 'FAILED',
      funding_status: 'EXCEPTION',
      updated_at: new Date().toISOString(),
    }).eq('id', run.id).neq('customer_refund_status', 'SUCCEEDED')
    if (failureError) throw new Error(failureError.message)
    await createOrRefreshOpsIssue(supabase, {
      issueType: 'REFUND_FAILED',
      severity: 'HIGH',
      source: 'drapeon-dispatch-refund',
      actorRole: 'SYSTEM',
      orderId: run.order_id,
      relatedEntityType: 'ORDER_FULFILLMENT_RUN',
      relatedEntityId: run.id,
      title: 'Delivery reconciliation refund needs attention',
      description: 'The automatic unused-delivery refund did not reach a safe provider outcome.',
      recommendedAction: 'Inspect the fulfillment run, original payment and exact restoration. A failed or canceled Stripe refund needs a separately approved Money Desk recovery with a new provider attempt; do not replay it as a fresh request.',
      dedupeKey: `dispatch-refund-failed:${run.id}`,
      metadata: { run_id: run.id, refund_amount: amount, currency: run.currency, correlation_id: run.correlation_id, error: message },
    })
    await Sentry.captureMessage('Automatic Drapeon Dispatch refund failed', {
      level: 'error',
      tags: { component: 'drapeon-dispatch', operation: 'automatic-refund' },
      extra: { order_id: run.order_id, run_id: run.id, correlation_id: run.correlation_id, refund_amount: amount, error: message },
    })
    await notifyDispatchRefund(supabase, {
      orderId: run.order_id,
      runId: run.id,
      succeeded: false,
      amount,
      currency: run.currency,
    })
    if (operation && terminalProviderFailure && providerRefundId) {
      await completeReviewedDispatchRefundAttempt(supabase, {
        runId: run.id, refundId: providerRefundId, status: 'FAILED', providerStatus: 'failed or canceled',
      })
    }
    throw cause
  }
}
