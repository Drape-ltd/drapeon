import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { bachsInitialCollectionReviewReason, matchBachsCollection, type BachsCollectionSucceeded } from '../_shared/bachs-collection.ts'
import { getBachsWebhookSecrets, getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { getClientIp, RATE_LIMITS, rateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { authorizeCronRequest } from '../_shared/cron.ts'
import { recordRejectedWebhook, enqueueVerifiedPaymentWebhook, loadQueuedPaymentWebhook } from '../_shared/payment-webhook.ts'
import { findPaymentAttemptByProviderPaymentId, markPaymentAttemptStatus, markWebhookEventProcessed } from '../_shared/payment-ledger.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
import { verifyBachsWebhookSignature } from '../_shared/bachs-webhook-signature.ts'
import { enqueueOrderConfirmationEmailJob } from '../_shared/payment-side-effects.ts'
import { paymentConfirmedStageNote, tailorPaymentConfirmedNotification } from '../_shared/payment-copy.ts'
import { sendPushToUser } from '../_shared/notify.ts'

const FN = 'bachs-webhook'

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void }

type BachsEvent = {
  id: string
  type: string
  organization_id?: string
  account?: string
  data?: Record<string, unknown>
}

type BachsOrder = {
  id: string
  reference: string | null
  stage: string
  order_kind: string | null
  customer_id: string | null
  tailor_id: string | null
  payment_provider: string | null
  payment_intent_id: string | null
  charge_provider_snapshot: string | null
  charge_currency_snapshot: string | null
  accepted_route_snapshot_at: string | null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function eventShape(value: unknown): value is BachsEvent {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    typeof (value as BachsEvent).id === 'string' && /^evt_[A-Za-z0-9]+$/.test((value as BachsEvent).id) &&
    typeof (value as BachsEvent).type === 'string' && (value as BachsEvent).type.length > 0 &&
    typeof (value as BachsEvent).data === 'object' && !!(value as BachsEvent).data && !Array.isArray((value as BachsEvent).data)
}

async function issueForEvent(
  supabase: SupabaseClient,
  input: { event: BachsEvent; orderId?: string | null; paymentId?: string | null; reason: string },
) {
  await createOrRefreshOpsIssue(supabase, {
    issueType: 'PAYMENT_BLOCKED', severity: 'HIGH', source: FN, actorRole: 'SYSTEM',
    provider: 'BACHS', orderId: input.orderId ?? null,
    relatedEntityType: input.paymentId ? 'order_payment' : 'payment_webhook_event',
    relatedEntityId: input.paymentId ?? input.event.id,
    title: 'Bachs payment needs Ops review',
    description: `Signed Bachs event ${input.event.type} was saved, but the payment cannot be safely completed automatically (${input.reason}).`,
    recommendedAction: 'Compare the signed Bachs event, saved payment attempt, accepted route snapshot and current order. Do not create another checkout or payout.',
    dedupeKey: `bachs-webhook-review:${input.event.id}`,
    queueKey: 'money-desk', persistWhenRoutineDisabled: true,
    metadata: { provider_event_id: input.event.id, provider_event_type: input.event.type, review_reason: input.reason },
  })
}

async function processQueuedEvent(supabase: SupabaseClient, webhookEventId: string) {
  const queued = await loadQueuedPaymentWebhook(supabase, { webhookEventId, provider: 'BACHS' })
  if (queued.processed_at) return { duplicate: true, processed: true }
  const event = queued.payload as unknown as BachsEvent
  if (!eventShape(event) || event.id !== queued.provider_event_id || event.type !== queued.event_type) {
    await issueForEvent(supabase, { event: { id: queued.provider_event_id, type: queued.event_type }, reason: 'stored_event_identity_mismatch' })
    await markWebhookEventProcessed(supabase, webhookEventId, { processingResult: 'event_identity_mismatch', reconciliationRequired: true })
    return { reviewRequired: true }
  }

  const data = event.data ?? {}
  if (event.type === 'collection.failed') {
    // Bachs documents this as an attempt-level failure; the checkout remains
    // open and can still succeed after a later payment-method retry.
    const platformAccountId = Deno.env.get('BACHS_PLATFORM_ACCOUNT_ID')?.trim() ?? ''
    if (!platformAccountId || event.organization_id !== platformAccountId || event.account) {
      await issueForEvent(supabase, { event, reason: !platformAccountId ? 'platform_account_id_missing' : 'collection_event_account_mismatch' })
      await markWebhookEventProcessed(supabase, webhookEventId, { processingResult: 'failed_collection_account_needs_review', reconciliationRequired: true })
      return { reviewRequired: true, reason: 'collection_event_account_mismatch' }
    }
    const checkoutId = typeof data.checkout_id === 'string' ? data.checkout_id : null
    const attempt = checkoutId ? await findPaymentAttemptByProviderPaymentId(supabase, 'BACHS', checkoutId) : null
    if (!attempt || attempt.phase !== 'INITIAL_ORDER' || attempt.idempotency_key !== data.reference) {
      await issueForEvent(supabase, { event, orderId: attempt?.order_id ?? null, paymentId: attempt?.id ?? null, reason: 'failed_collection_has_no_exact_checkout_attempt' })
      await markWebhookEventProcessed(supabase, webhookEventId, { orderId: attempt?.order_id ?? null, paymentId: attempt?.id ?? null, processingResult: 'failed_collection_needs_review', reconciliationRequired: true })
      return { reviewRequired: true }
    }
    await markWebhookEventProcessed(supabase, webhookEventId, { orderId: attempt.order_id, paymentId: attempt.id, processingResult: 'collection_attempt_failed_checkout_remains_open' })
    return { recorded: true, checkoutRemainsOpen: true }
  }

  if (event.type !== 'collection.succeeded') {
    await issueForEvent(supabase, { event, reason: 'event_type_not_yet_implemented' })
    await markWebhookEventProcessed(supabase, webhookEventId, { processingResult: 'event_type_needs_ops_review', reconciliationRequired: true })
    return { reviewRequired: true, unsupported: event.type }
  }

  const checkoutId = typeof data.checkout_id === 'string' ? data.checkout_id : null
  const attempt = checkoutId ? await findPaymentAttemptByProviderPaymentId(supabase, 'BACHS', checkoutId) : null
  const platformAccountId = Deno.env.get('BACHS_PLATFORM_ACCOUNT_ID')?.trim() ?? ''
  const matched = matchBachsCollection({
    event: event as unknown as BachsCollectionSucceeded,
    attempt,
    platformAccountId,
  })
  if (!attempt || matched.outcome !== 'MATCH') {
    const reason = !platformAccountId ? 'platform_account_id_missing' : matched.outcome.toLowerCase()
    await issueForEvent(supabase, { event, orderId: attempt?.order_id ?? null, paymentId: attempt?.id ?? null, reason })
    await markWebhookEventProcessed(supabase, webhookEventId, { orderId: attempt?.order_id ?? null, paymentId: attempt?.id ?? null, processingResult: `collection_${reason}`, reconciliationRequired: true })
    return { reviewRequired: true, reason }
  }

  if (attempt.provider_response && typeof attempt.provider_response === 'object') {
    const previousChargeId = typeof attempt.provider_response.bachs_charge_id === 'string' ? attempt.provider_response.bachs_charge_id : null
    if (previousChargeId && previousChargeId !== matched.chargeId) {
      await issueForEvent(supabase, { event, orderId: attempt.order_id, paymentId: attempt.id, reason: 'attempt_already_bound_to_another_charge' })
      await markWebhookEventProcessed(supabase, webhookEventId, { orderId: attempt.order_id, paymentId: attempt.id, processingResult: 'charge_id_conflict', reconciliationRequired: true })
      return { reviewRequired: true }
    }
  }

  if (attempt.status === 'SUCCEEDED') {
    const { data: existingCharge, error: chargeError } = await supabase.from('order_payments')
      .select('provider_charge_id').eq('id', attempt.id).maybeSingle()
    if (chargeError) throw chargeError
    if (existingCharge?.provider_charge_id && existingCharge.provider_charge_id !== matched.chargeId) {
      await issueForEvent(supabase, { event, orderId: attempt.order_id, paymentId: attempt.id, reason: 'saved_charge_id_conflict' })
      await markWebhookEventProcessed(supabase, webhookEventId, { orderId: attempt.order_id, paymentId: attempt.id, processingResult: 'charge_id_conflict', reconciliationRequired: true })
      return { reviewRequired: true }
    }
  }

  const { data: chargeBinding, error: bindError } = await supabase.from('order_payments')
    .update({ provider_charge_id: matched.chargeId })
    .eq('id', attempt.id).eq('provider', 'BACHS').eq('provider_payment_id', checkoutId)
    .or(`provider_charge_id.is.null,provider_charge_id.eq.${matched.chargeId}`)
    .select('id').maybeSingle()
  if (bindError) throw bindError
  if (!chargeBinding?.id) {
    await issueForEvent(supabase, { event, orderId: attempt.order_id, paymentId: attempt.id, reason: 'charge_id_bind_conflict' })
    await markWebhookEventProcessed(supabase, webhookEventId, { orderId: attempt.order_id, paymentId: attempt.id, processingResult: 'charge_id_bind_conflict', reconciliationRequired: true })
    return { reviewRequired: true }
  }

  const { data: orderData, error: orderError } = await supabase.from('orders')
    .select('id,reference,stage,order_kind,customer_id,tailor_id,payment_provider,payment_intent_id,charge_provider_snapshot,charge_currency_snapshot,accepted_route_snapshot_at')
    .eq('id', attempt.order_id).maybeSingle()
  if (orderError) throw orderError
  const order = orderData as BachsOrder | null
  const wasTerminal = attempt.status === 'FAILED' || attempt.status === 'CANCELED'
  // Record the accepted charge in the shared commercial ledger. The shared
  // status helper also updates phase-linked commercial records idempotently.
  const succeededAttempt = await markPaymentAttemptStatus(supabase, {
    provider: 'BACHS', providerPaymentId: checkoutId!, status: 'SUCCEEDED',
    providerResponse: { ...asRecord(attempt.provider_response), bachs_charge_id: matched.chargeId, bachs_event_id: event.id, id: event.id, type: event.type, data },
  })
  if (!succeededAttempt) throw new Error('Bachs collection matched but its payment attempt could not be advanced.')

  if (!order) {
    await issueForEvent(supabase, { event, orderId: attempt.order_id, paymentId: attempt.id, reason: 'order_missing' })
    await markWebhookEventProcessed(supabase, webhookEventId, { orderId: attempt.order_id, paymentId: attempt.id, processingResult: 'late_or_conflicting_success_needs_ops_review', reconciliationRequired: true })
    return { reviewRequired: true, reason: 'order_missing', moneyRecorded: true }
  }

  const reviewReason = bachsInitialCollectionReviewReason({
    attemptOrderId: attempt.order_id,
    orderId: order.id,
    attemptPhase: attempt.phase,
    attemptStatus: wasTerminal ? 'FAILED' : attempt.status,
    orderStage: order.stage,
    paymentProvider: order.payment_provider,
    paymentCheckoutId: order.payment_intent_id,
    succeededCheckoutId: checkoutId!,
    acceptedSnapshotAt: order.accepted_route_snapshot_at,
    snapshotProvider: order.charge_provider_snapshot,
    snapshotCurrency: order.charge_currency_snapshot,
    paymentCurrency: attempt.currency,
  })

  if (reviewReason) {
    await issueForEvent(supabase, { event, orderId: order?.id ?? attempt.order_id, paymentId: attempt.id, reason: reviewReason })
    await markWebhookEventProcessed(supabase, webhookEventId, { orderId: order?.id ?? attempt.order_id, paymentId: attempt.id, processingResult: 'late_or_conflicting_success_needs_ops_review', reconciliationRequired: true })
    await audit(supabase, { event: 'payment.provider_state_requires_ops_review', actor_role: 'SYSTEM', order_id: order?.id ?? attempt.order_id, severity: 'error', payload: { function: FN, provider: 'BACHS', provider_event_id: event.id, provider_checkout_id: checkoutId, provider_charge_id: matched.chargeId, reason: reviewReason } })
    return { reviewRequired: true, reason: reviewReason, moneyRecorded: true }
  }

  let changed = false
  if (order.stage !== 'CONFIRMED') {
    const { data: updated, error: updateError } = await supabase.from('orders').update({
      stage: 'CONFIRMED', stage_updated_at: new Date().toISOString(), payment_provider: 'BACHS',
      payment_intent_id: checkoutId, payment_checkout_url: null,
    }).eq('id', order.id).eq('stage', 'PAYMENT_PENDING').eq('payment_provider', 'BACHS')
      .eq('payment_intent_id', checkoutId).select('id').maybeSingle()
    if (updateError) throw updateError
    changed = !!updated?.id
    if (!changed) {
      await issueForEvent(supabase, { event, orderId: order.id, paymentId: attempt.id, reason: 'order_confirmation_compare_and_set_lost' })
      await markWebhookEventProcessed(supabase, webhookEventId, { orderId: order.id, paymentId: attempt.id, processingResult: 'payment_succeeded_order_update_requires_review', reconciliationRequired: true })
      return { reviewRequired: true }
    }
    const { error: stageError } = await supabase.from('order_stage_updates').insert({ order_id: order.id, stage: 'CONFIRMED', note: paymentConfirmedStageNote(order.order_kind) })
    if (stageError) throw stageError
    if (order.tailor_id) EdgeRuntime.waitUntil(sendPushToUser(supabase, order.tailor_id, { ...tailorPaymentConfirmedNotification(order.order_kind), preferenceKey: 'newOrders', data: { orderId: order.id } }))
    if (order.customer_id) EdgeRuntime.waitUntil(sendPushToUser(supabase, order.customer_id, {
      title: order.order_kind === 'READY_MADE' ? 'Order confirmed' : 'Payment confirmed',
      body: order.order_kind === 'READY_MADE' ? 'Your ready-made order is paid and the tailor can prepare it inside Drapeon.' : 'Your order is funded. The tailor can continue production inside Drapeon.',
      preferenceKey: 'paymentConfirmations', data: { orderId: order.id },
      communication: { category: 'PAYMENT', purpose: 'TRANSACTIONAL', severity: 'NOTICE', mandatory: true, inApp: true, destinationKey: 'ORDER_DETAIL', destinationParams: { orderId: order.id }, deduplicationKey: `payment-confirmed:${order.id}:${checkoutId}:customer` },
    }))
    await enqueueOrderConfirmationEmailJob(supabase, { order, phase: 'INITIAL_ORDER', source: FN, provider: 'BACHS' })
  }

  await markWebhookEventProcessed(supabase, webhookEventId, { orderId: order.id, paymentId: attempt.id, processingResult: changed ? 'confirmed' : 'already_confirmed' })
  await audit(supabase, { event: 'payment.confirmed', actor_role: 'SYSTEM', order_id: order.id, payload: { function: FN, provider: 'BACHS', event_id: event.id, checkout_id: checkoutId, charge_id: matched.chargeId, changed } })
  return { confirmed: true, changed }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors })

  const supabase: SupabaseClient = createClient(getSupabaseUrl(), getServiceRoleKey())
  const queuedWebhookEventId = req.headers.get('x-drape-webhook-event-id')?.trim() || null
  if (queuedWebhookEventId) {
    const unauthorized = await authorizeCronRequest(req, `${FN}:queued-replay`, cors)
    if (unauthorized) return unauthorized
    try {
      const result = await processQueuedEvent(supabase, queuedWebhookEventId)
      return new Response(JSON.stringify({ ok: true, ...result }), { headers: { ...cors, 'Content-Type': 'application/json' } })
    } catch (error) {
      log('error', FN, 'queued_event.failed', { error: error instanceof Error ? error.message : 'unknown' })
      return new Response('Webhook replay failed', { status: 500, headers: cors })
    }
  }

  const clientIp = getClientIp(req)
  const limit = await rateLimit(supabase, clientIp, FN, RATE_LIMITS.webhook.limit, RATE_LIMITS.webhook.windowMs, { ip: clientIp, userAgent: req.headers.get('user-agent') })
  if (!limit.allowed) return rateLimitExceededResponse(cors, limit.retryAfter)
  const rawBody = new Uint8Array(await req.arrayBuffer())
  const bodyText = new TextDecoder().decode(rawBody)
  const signatureHeader = req.headers.get('x-bachs-signature-v2') ?? req.headers.get('x-bachs-signature')
  let secrets: string[]
  try { secrets = getBachsWebhookSecrets() } catch (error) {
    log('error', FN, 'webhook.secret_unavailable', { error: error instanceof Error ? error.message : 'unknown' })
    return new Response('Webhook verification unavailable', { status: 503, headers: cors })
  }
  if (!signatureHeader || !await verifyBachsWebhookSignature({ rawBody, headers: req.headers, secret: secrets })) {
    await recordRejectedWebhook(supabase, {
      provider: 'BACHS', functionName: FN, rawPayload: bodyText,
      reason: signatureHeader ? 'invalid_signature' : 'missing_signature',
      signatureHeader, sourceIp: clientIp, userAgent: req.headers.get('user-agent'), endpointPath: '/v1/webhooks/bachs',
    })
    return new Response(signatureHeader ? 'Invalid Bachs signature' : 'Missing Bachs signature', { status: 401, headers: cors })
  }

  try {
    const event = JSON.parse(bodyText) as unknown
    if (!eventShape(event)) return new Response('Invalid Bachs event', { status: 400, headers: cors })
    const queued = await enqueueVerifiedPaymentWebhook(supabase, {
      provider: 'BACHS', providerEventId: event.id, eventType: event.type,
      payload: event as Record<string, unknown>, rawPayload: bodyText,
    })
    return new Response(JSON.stringify({ ok: true, accepted: true, duplicate: queued.duplicate, alreadyProcessed: queued.alreadyProcessed }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    if (error instanceof SyntaxError) return new Response('Invalid JSON payload', { status: 400, headers: cors })
    const message = error instanceof Error ? error.message : 'unknown'
    log('error', FN, 'webhook.enqueue_failed', { error: message })
    return new Response('Webhook intake unavailable', { status: 503, headers: cors })
  }
})
