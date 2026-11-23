import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeCronRequest } from '../_shared/cron.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getStripeSecretKey, getSupabaseUrl } from '../_shared/env.ts'
import { failedStripeRefundEvidence } from '../_shared/failed-refund-journal-recovery.ts'
import { log } from '../_shared/logger.ts'
import { listStripeRefundsForPaymentIntent } from '../_shared/stripe.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'

const FN = 'recover-failed-refund-journal'
const BodySchema = z.object({ moneyDeskRequestId: uuid, moneyDeskAttemptId: uuid })
const json = (body: Record<string, unknown>, status: number, cors: HeadersInit) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

Deno.serve(async (request) => {
  const cors = getCorsHeaders(request)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const unauthorized = await authorizeCronRequest(request, FN, cors)
  if (unauthorized) return unauthorized
  const parsed = parseBody(BodySchema, await request.json().catch(() => ({})))
  if (!parsed.ok) return json({ ok: false, error: 'INVALID_REQUEST' }, 400, cors)

  try {
    const environment = Deno.env.get('DRAPE_OPS_ENV')?.trim().toLowerCase()
    const key = getStripeSecretKey()
    if ((environment === 'development' && !key.startsWith('sk_test_')) ||
        (environment === 'production' && !key.startsWith('sk_live_')) ||
        !['development', 'production'].includes(environment ?? '')) {
      return json({ ok: false, error: 'STRIPE_MODE_MISMATCH' }, 503, cors)
    }
    const client = createClient(getSupabaseUrl(), getServiceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const requestResult = await client.from('money_desk_requests')
      .select('id,status,action_type,target_type,target_id,order_id,amount,currency,action_payload')
      .eq('id', parsed.data.moneyDeskRequestId).maybeSingle()
    const attemptResult = await client.from('money_desk_execution_attempts')
      .select('id,request_id,status').eq('id', parsed.data.moneyDeskAttemptId).maybeSingle()
    const moneyRequest = requestResult.data
    const attempt = attemptResult.data
    if (requestResult.error || attemptResult.error ||
        !moneyRequest || !attempt || attempt.request_id !== moneyRequest.id ||
        moneyRequest.action_type !== 'OTHER_REVIEWED' ||
        moneyRequest.target_type !== 'FAILED_REFUND_JOURNAL' ||
        !['EXECUTING', 'SUCCEEDED'].includes(moneyRequest.status) ||
        !['PROCESSING', 'SUCCEEDED'].includes(attempt.status)) {
      return json({ ok: false, error: 'REVIEW_NOT_EXECUTING' }, 409, cors)
    }
    const refundResult = await client.from('order_payment_provider_refunds')
      .select('id,payment_id,provider,provider_refund_id,amount,status')
      .eq('id', moneyRequest.target_id).maybeSingle()
    const refund = refundResult.data
    if (refundResult.error || !refund || refund.provider !== 'STRIPE' ||
        refund.status !== 'FAILED' ||
        moneyRequest.action_payload?.providerRefundId !== refund.provider_refund_id) {
      return json({ ok: false, error: 'FAILED_REFUND_TARGET_MISMATCH' }, 409, cors)
    }
    const paymentResult = await client.from('order_payments')
      .select('id,order_id,provider,status,provider_payment_id,amount,currency')
      .eq('id', refund.payment_id).maybeSingle()
    const payment = paymentResult.data
    if (paymentResult.error || !payment || payment.provider !== 'STRIPE' ||
        !['SUCCEEDED', 'PARTIAL_REFUND'].includes(payment.status) ||
        payment.id !== moneyRequest.action_payload?.paymentId ||
        payment.order_id !== moneyRequest.order_id ||
        refund.amount !== moneyRequest.amount ||
        payment.currency !== moneyRequest.currency ||
        typeof payment.provider_payment_id !== 'string' ||
        !payment.provider_payment_id.startsWith('pi_')) {
      return json({ ok: false, error: 'FAILED_REFUND_PAYMENT_MISMATCH' }, 409, cors)
    }

    let refunds
    try {
      refunds = await listStripeRefundsForPaymentIntent(payment.provider_payment_id)
    } catch (error) {
      log('error', FN, 'provider.lookup_failed', {
        code: error && typeof error === 'object' && 'stripeCode' in error
          ? String(error.stripeCode) : 'NETWORK_OR_RESPONSE',
      })
      return json({ ok: false, error: 'PROVIDER_UNAVAILABLE' }, 503, cors)
    }
    const proof = failedStripeRefundEvidence({
      refundId: refund.provider_refund_id,
      paymentIntentId: payment.provider_payment_id,
      amount: refund.amount,
    }, refunds, new Date().toISOString())
    if (!proof.ok) return json({ ok: false, error: proof.code }, 409, cors)

    const completed = await client.rpc('complete_reviewed_failed_refund_journal_recovery', {
      p_request_id: moneyRequest.id,
      p_attempt_id: attempt.id,
      p_provider_evidence: proof.evidence,
    })
    if (completed.error || completed.data?.ok !== true) {
      log('error', FN, 'recovery.rejected', { code: completed.error?.code ?? 'INVALID_RESULT' })
      return json({ ok: false, error: 'RECOVERY_REJECTED' }, 409, cors)
    }
    return json({ ok: true, providerReference: refund.provider_refund_id,
      reversalId: completed.data.reversalId, duplicate: completed.data.duplicate === true }, 200, cors)
  } catch (error) {
    log('error', FN, 'recovery.failed', { code: error instanceof Error ? error.name : 'UNKNOWN' })
    return json({ ok: false, error: 'RECOVERY_UNAVAILABLE' }, 503, cors)
  }
})
