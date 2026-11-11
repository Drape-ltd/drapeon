import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { StripeRefund } from './stripe.ts'
import { resolveOpsIssueByDedupeKey } from './ops-issues.ts'

export async function hasConfirmedProviderRefund(
  supabase: SupabaseClient,
  paymentId: string,
  refundId: string,
) {
  const { data, error } = await supabase.from('order_payment_provider_refunds')
    .select('id,status')
    .eq('payment_id', paymentId).eq('provider_refund_id', refundId)
    .maybeSingle()
  if (error) throw error
  return data?.status === 'CONFIRMED'
}

export async function isRecoveredPriorDispatchRefund(
  supabase: SupabaseClient,
  input: { runId: string; refundId: string; hasConfirmedRefundRecord: boolean },
) {
  if (input.hasConfirmedRefundRecord) return false
  const { data, error } = await supabase.from('dispatch_refund_retry_operations')
    .select('id').eq('run_id', input.runId)
    .eq('prior_refund_id', input.refundId)
    .eq('status', 'SUCCEEDED').limit(1)
  if (error) throw error
  return Boolean(data?.length)
}

export async function recordReviewedDispatchRefundWebhookOutcome(
  supabase: SupabaseClient,
  input: { refund: StripeRefund; paymentId: string; resolutionId: string | null; status: string },
) {
  const operationId = input.refund.metadata?.dispatch_retry_operation_id?.trim()
  if (!operationId) return
  const { data: operation, error: lookupError } = await supabase
    .from('dispatch_refund_retry_operations')
    .select('id,run_id,payment_id,prior_refund_id,provider_refund_id,provider_evidence,status')
    .eq('id', operationId).maybeSingle()
  if (lookupError || !operation?.id || operation.payment_id !== input.paymentId ||
      input.resolutionId !== `dispatch-refund:${operation.run_id}` ||
      operation.prior_refund_id !== input.refund.metadata?.prior_refund_id ||
      operation.prior_refund_id === input.refund.id ||
      (operation.provider_refund_id && operation.provider_refund_id !== input.refund.id)) {
    throw new Error('Stripe refund webhook does not match its reviewed dispatch retry operation.')
  }
  const { data: run, error: runError } = await supabase.from('order_fulfillment_runs')
    .select('id,customer_refund_amount,customer_refund_tax_amount')
    .eq('id', operation.run_id).maybeSingle()
  if (runError || !run?.id ||
      Number(run.customer_refund_amount ?? 0) + Number(run.customer_refund_tax_amount ?? 0) !== input.refund.amount) {
    throw new Error('Stripe reviewed dispatch refund amount differs from the approved run.')
  }
  const next = input.status === 'succeeded' ? 'SUCCEEDED'
    : ['failed', 'canceled'].includes(input.status) ? 'FAILED' : 'PENDING'
  const { error: updateError } = await supabase.from('dispatch_refund_retry_operations')
    .update({ status: next, provider_refund_id: input.refund.id,
      provider_evidence: {
        ...(operation.provider_evidence && typeof operation.provider_evidence === 'object'
          ? operation.provider_evidence : {}),
        refundId: input.refund.id, status: input.status,
      } })
    .eq('id', operation.id)
    .in('status', next === 'SUCCEEDED'
      ? ['QUEUED', 'PROCESSING', 'PENDING', 'FAILED', 'SUCCEEDED']
      : next === 'FAILED' ? ['QUEUED', 'PROCESSING', 'PENDING', 'FAILED']
      : ['QUEUED', 'PROCESSING', 'PENDING'])
  if (updateError) throw new Error(updateError.message)
  if (next === 'SUCCEEDED') {
    await resolveOpsIssueByDedupeKey(supabase,
      `stripe-refund-failed:${operation.prior_refund_id}`, {
        recovered_by_refund_id: input.refund.id,
        reviewed_operation_id: operation.id,
      })
  }
}

