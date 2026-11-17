import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeCronRequest } from '../_shared/cron.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getStripeSecretKey, getSupabaseUrl } from '../_shared/env.ts'
import { log } from '../_shared/logger.ts'
import { listStripeRefundsForPaymentIntent } from '../_shared/stripe.ts'
import { confirmedTipRefundEvidence } from '../_shared/tip-refund-reconciliation.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'

const FN = 'reconcile-dev-tip-refund'
const BodySchema = z.object({ moneyDeskRequestId: uuid, moneyDeskAttemptId: uuid })
const json = (body: Record<string, unknown>, status: number, cors: HeadersInit) =>
  new Response(JSON.stringify(body), { status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

Deno.serve(async (request) => {
  const cors = getCorsHeaders(request)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const unauthorized = await authorizeCronRequest(request, FN, cors)
  if (unauthorized) return unauthorized
  const parsed = parseBody(BodySchema, await request.json().catch(() => ({})))
  if (!parsed.ok) return json({ ok: false, error: 'INVALID_REQUEST' }, 400, cors)

  try {
    const url = getSupabaseUrl()
    if (Deno.env.get('DRAPE_OPS_ENV')?.trim().toLowerCase() !== 'development' ||
        !getStripeSecretKey().startsWith('sk_test_') ||
        new URL(url).hostname !== 'pqptfuqogvrajozfsqzi.supabase.co') {
      return json({ ok: false, error: 'DEV_TEST_ONLY' }, 403, cors)
    }
    const client = createClient(url, getServiceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const requestResult = await client.from('money_desk_requests')
      .select('id,status,action_type,target_type,target_id,order_id,amount,currency,action_payload')
      .eq('id', parsed.data.moneyDeskRequestId).maybeSingle()
    const attemptResult = await client.from('money_desk_execution_attempts')
      .select('id,request_id,status').eq('id', parsed.data.moneyDeskAttemptId).maybeSingle()
    const moneyRequest = requestResult.data
    const attempt = attemptResult.data
    if (requestResult.error || attemptResult.error || !moneyRequest || !attempt ||
        attempt.request_id !== moneyRequest.id || moneyRequest.action_type !== 'OTHER_REVIEWED' ||
        moneyRequest.target_type !== 'TIP_REFUND_RECONCILIATION' ||
        !['EXECUTING', 'SUCCEEDED'].includes(moneyRequest.status) ||
        !['PROCESSING', 'SUCCEEDED'].includes(attempt.status)) {
      return json({ ok: false, error: 'REVIEW_NOT_EXECUTING' }, 409, cors)
    }
    const tipResult = await client.from('order_tips')
      .select('id,order_id,payment_id,amount,currency').eq('id', moneyRequest.target_id).maybeSingle()
    const tip = tipResult.data
    if (tipResult.error || !tip?.payment_id || tip.order_id !== moneyRequest.order_id ||
        tip.amount !== moneyRequest.amount || tip.currency !== moneyRequest.currency) {
      return json({ ok: false, error: 'TIP_TARGET_MISMATCH' }, 409, cors)
    }
    const paymentResult = await client.from('order_payments')
      .select('id,order_id,phase,provider,provider_payment_id,amount,currency')
      .eq('id', tip.payment_id).maybeSingle()
    const payment = paymentResult.data
    if (paymentResult.error || !payment || payment.phase !== 'TIP' ||
        payment.provider !== 'STRIPE' || payment.order_id !== tip.order_id ||
        payment.amount !== tip.amount || payment.currency !== tip.currency ||
        payment.id !== moneyRequest.action_payload?.paymentId ||
        payment.provider_payment_id !== moneyRequest.action_payload?.paymentIntentId ||
        typeof payment.provider_payment_id !== 'string' ||
        !payment.provider_payment_id.startsWith('pi_')) {
      return json({ ok: false, error: 'TIP_PAYMENT_MISMATCH' }, 409, cors)
    }
    let refunds
    try {
      refunds = await listStripeRefundsForPaymentIntent(payment.provider_payment_id)
    } catch (error) {
      log('error', FN, 'provider.lookup_failed', { code: error instanceof Error ? error.name : 'UNKNOWN' })
      return json({ ok: false, error: 'PROVIDER_UNAVAILABLE' }, 503, cors)
    }
    const proof = confirmedTipRefundEvidence({
      refundId: String(moneyRequest.action_payload?.providerRefundId ?? ''),
      paymentIntentId: payment.provider_payment_id,
      amount: tip.amount,
    }, refunds, new Date().toISOString())
    if (!proof.ok) return json({ ok: false, error: proof.code }, 409, cors)
    const completed = await client.rpc('complete_dev_reviewed_tip_refund_reconciliation', {
      p_request_id: moneyRequest.id,
      p_attempt_id: attempt.id,
      p_provider_evidence: proof.evidence,
    })
    if (completed.error || completed.data?.ok !== true) {
      log('error', FN, 'recovery.rejected', { code: completed.error?.code ?? 'INVALID_RESULT' })
      return json({ ok: false, error: 'TIP_RECOVERY_REJECTED' }, 409, cors)
    }
    return json({ ok: true, providerReference: proof.evidence.refund_id,
      journalId: completed.data.journalId, duplicate: completed.data.duplicate === true }, 200, cors)
  } catch (error) {
    log('error', FN, 'recovery.failed', { code: error instanceof Error ? error.name : 'UNKNOWN' })
    return json({ ok: false, error: 'TIP_RECOVERY_UNAVAILABLE' }, 503, cors)
  }
})
