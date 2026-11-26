/** One service-authenticated checkout for the exact, immutable Phase 4 proof.
 * The public resolver and route are never enabled by this function. */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeCronRequest } from '../_shared/cron.ts'
import { getPaymentReturnUrl, getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { resolveControlledProofPaymentRoute } from '../_shared/payment-routes.ts'
import { prepareCommercialPricingReservation } from '../_shared/commercial-ledger.ts'
import { createSupabaseBachsCheckoutStore, prepareBachsCheckoutAttempt } from '../_shared/bachs-checkout-attempt.ts'
import { createBachsCheckout, getBachsCheckout } from '../_shared/bachs-operations.ts'
import { getBachsClient } from '../_shared/bachs.ts'
import { PAYMENT_PENDING_TIMEOUT_MINUTES } from '../_shared/payment-expiry-safety.ts'
import { CURRENT_TAILOR_TERMS_VERSION } from '../_shared/payment-route-acceptance.ts'
import { parsePhase4ProofRequest } from '../_shared/phase4-proof-request.ts'
import { isBachsCheckoutPhaseReady } from '../_shared/bachs-collection.ts'
import { paymentRouteCardIssuerAllowed } from '../../../packages/shared/src/currency-config.ts'
import { upsertPreparedPaymentAttempt } from '../_shared/payment-ledger.ts'
import type { PreparedCommercialPricing } from '../_shared/commercial-ledger.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'

const FN = 'phase4-proof-payment'
const ALLOWED_HOSTS = new Set([
  'pqptfuqogvrajozfsqzi.supabase.co',
  'wkfsrunetmgjdtcurmoj.supabase.co',
])

function response(status: number, code: string, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ code, ...extra }), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

Deno.serve(async (req) => {
  const unauthorized = await authorizeCronRequest(req, FN, {})
  if (unauthorized) return unauthorized
  const supabaseUrl = getSupabaseUrl()
  if (!ALLOWED_HOSTS.has(new URL(supabaseUrl).hostname) ||
    Deno.env.get('PHASE4_PROOF_ACTION_ENABLED') !== 'true') {
    return response(409, 'PHASE4_PROOF_ACTION_DISABLED')
  }
  let proofId: string
  try {
    const body = await req.json()
    const parsed = parsePhase4ProofRequest(body)
    if (!parsed) return response(400, 'PHASE4_PROOF_ID_REQUIRED')
    proofId = parsed
  } catch { return response(400, 'PHASE4_PROOF_ID_REQUIRED') }

  const db = createClient(supabaseUrl, getServiceRoleKey())
  // Expiry is enforced by every RPC even if this bounded sweep has not run.
  const expired = await db.rpc('expire_phase4_payment_proofs', { p_limit: 100 })
  if (expired.error) return response(503, 'PHASE4_PROOF_EXPIRY_UNAVAILABLE')
  const { data: proof, error: proofError } = await db.from('phase4_payment_proofs')
    .select('id,customer_id,tailor_profile_id,order_id,amount_minor,currency,country_code,route_id,route_version,expires_at,state,payment_attempt_id')
    .eq('id', proofId).maybeSingle()
  if (proofError || !proof || !['ARMED', 'SNAPSHOTTED', 'CHECKOUT_RESERVED'].includes(proof.state) ||
    Date.parse(proof.expires_at) <= Date.now()) return response(409, 'PHASE4_PROOF_UNAVAILABLE')

  const { data: order, error: orderError } = await db.from('orders')
    .select('id,customer_id,tailor_profile_id,active_quote_id,active_quote_version,stage,order_kind,delivery_method,delivery_country_code,currency,tailor_payout_currency_locked,payment_route_id,payment_route_version,total_amount')
    .eq('id', proof.order_id).maybeSingle()
  const { data: tailor, error: tailorError } = await db.from('tailor_profiles')
    .select('id,payout_country_code,payout_currency')
    .eq('id', proof.tailor_profile_id).maybeSingle()
  if (orderError || tailorError || !order || !tailor ||
    order.customer_id !== proof.customer_id || order.tailor_profile_id !== proof.tailor_profile_id ||
    order.currency !== 'NGN' || proof.currency !== 'NGN' || proof.country_code !== 'NG') {
    return response(409, 'PHASE4_PROOF_TUPLE_CHANGED')
  }
  const tailorCountry = String(tailor.payout_country_code ?? '').toUpperCase()
  const deliveryCountry = order.delivery_method === 'LOCAL_COLLECTION'
    ? tailorCountry : String(order.delivery_country_code ?? '').toUpperCase()
  const payoutCurrency = String(order.tailor_payout_currency_locked ?? tailor.payout_currency ?? '').toUpperCase()

  // Apply the ordinary route, delivery and destination resolver to only the
  // selected disabled route. The database rechecks the tuple transactionally.
  let resolution
  try {
    resolution = await resolveControlledProofPaymentRoute({
      supabase: db, supabaseUrl, routeId: proof.route_id, routeVersion: proof.route_version,
      tailorProfileId: proof.tailor_profile_id, tailorCountryCode: tailorCountry,
      customerChargeCurrency: 'NGN', tailorPayoutCurrency: payoutCurrency,
      deliveryCountryCode: deliveryCountry,
    })
  } catch { return response(503, 'PHASE4_PROOF_READINESS_UNAVAILABLE') }
  if (!resolution.available || resolution.route.provider !== 'BACHS') {
    return response(409, 'PHASE4_PROOF_READINESS_FAILED')
  }
  if (!isBachsCheckoutPhaseReady('INITIAL_ORDER') || !paymentRouteCardIssuerAllowed({
    provider: 'BACHS', confirmedCardIssuerCountries: [], cardIssuerCountryCode: null,
    enforceCardIssuerCountryGate: Deno.env.get('BACHS_CARD_ISSUER_GATE_ENABLED')?.trim().toLowerCase() === 'true',
  })) return response(409, 'PHASE4_PROOF_PAYMENT_PATH_NOT_READY')
  if (proof.state === 'ARMED') {
    if (order.stage !== 'QUOTE_SENT' || order.order_kind !== 'CUSTOM' || !order.active_quote_id) {
      return response(409, 'PHASE4_PROOF_ORDER_CHANGED')
    }
    const accepted = await db.rpc('accept_phase4_payment_proof', {
      p_proof_id: proofId,
      p_delivery_rule_id: resolution.deliveryRule.id,
      p_delivery_rule_version: resolution.deliveryRule.version,
      p_destination_id: resolution.destination.id,
      p_delivery_country_code: deliveryCountry,
      p_terms_version: CURRENT_TAILOR_TERMS_VERSION,
    })
    if (accepted.error) return response(409, 'PHASE4_PROOF_ACCEPTANCE_REFUSED')
  }
  const checkout = await db.rpc('authorize_phase4_proof_checkout', {
    p_proof_id: proofId, p_order_id: proof.order_id, p_amount_minor: proof.amount_minor,
    p_currency: 'NGN', p_phase: 'INITIAL_ORDER', p_method: 'NGN_CARD',
  })
  if (checkout.error) return response(409, 'PHASE4_PROOF_CHECKOUT_REFUSED')

  const idempotencyKey = `DRAPE-PAY-${proof.order_id}-Q${order.active_quote_version}`
  let attemptId = proof.payment_attempt_id as string | null
  let newPricing: PreparedCommercialPricing | null = null
  try {
    if (!attemptId) {
      const pricing = await prepareCommercialPricingReservation(db, {
        idempotencyKey: `checkout-pricing:${idempotencyKey}`, orderId: proof.order_id,
        phase: 'INITIAL_ORDER', currency: 'NGN', amount: proof.amount_minor,
      })
      if (pricing.skipped) return response(409, 'PHASE4_PROOF_PRICING_UNAVAILABLE')
      newPricing = pricing
      const reserved = await db.from('order_payments').insert({
        order_id: proof.order_id, phase: 'INITIAL_ORDER', provider: 'BACHS',
        currency: 'NGN', amount: proof.amount_minor, status: 'INITIATED',
        idempotency_key: idempotencyKey, provider_request_state: 'RESERVED',
        provider_response: { function: FN, route_id: proof.route_id, proof_id: proofId },
        policy_version: pricing.reservation.policyVersion,
        pricing_version: pricing.reservation.pricingVersion,
        correlation_id: pricing.reservation.correlationId,
        pricing_reservation_id: pricing.reservation.id,
      }).select('id').maybeSingle()
      if (reserved.error || !reserved.data?.id) {
        const existing = await db.from('order_payments')
          .select('id,order_id,phase,provider,currency,amount,idempotency_key')
          .eq('idempotency_key', idempotencyKey).maybeSingle()
        if (existing.error || !existing.data || existing.data.order_id !== proof.order_id ||
          existing.data.phase !== 'INITIAL_ORDER' || existing.data.provider !== 'BACHS' ||
          existing.data.currency !== 'NGN' || existing.data.amount !== proof.amount_minor) {
          return response(409, 'PHASE4_PROOF_ATTEMPT_CONFLICT')
        }
        attemptId = existing.data.id
      } else attemptId = reserved.data.id
      const bound = await db.rpc('bind_phase4_proof_attempt', {
        p_proof_id: proofId, p_attempt_id: attemptId,
      })
      if (bound.error || bound.data !== true) return response(409, 'PHASE4_PROOF_ATTEMPT_REFUSED')
    }
    if (!attemptId) return response(503, 'PHASE4_PROOF_ATTEMPT_UNAVAILABLE')
    const authUser = await db.auth.admin.getUserById(proof.customer_id)
    const email = authUser.data.user?.email?.trim()
    if (authUser.error || !email) return response(409, 'PHASE4_PROOF_CUSTOMER_EMAIL_MISSING')
    // The audit kill switch may have fired while pricing was prepared. Recheck
    // immediately before the first provider write; retries use the same key.
    const latestAuthorization = await db.rpc('authorize_phase4_proof_checkout', {
      p_proof_id: proofId, p_order_id: proof.order_id, p_amount_minor: proof.amount_minor,
      p_currency: 'NGN', p_phase: 'INITIAL_ORDER', p_method: 'NGN_CARD',
    })
    if (latestAuthorization.error) return response(409, 'PHASE4_PROOF_CHECKOUT_REFUSED')
    const store = createSupabaseBachsCheckoutStore(db)
    const prepared = await prepareBachsCheckoutAttempt({
      attempt: await store.load(attemptId),
      expiresInMinutes: PAYMENT_PENDING_TIMEOUT_MINUTES,
      store,
      gateway: {
        create: ({ attempt, expiresInMinutes }) => createBachsCheckout(getBachsClient(), {
          amountMinor: attempt.amount, currency: attempt.currency, customerEmail: email,
          reference: attempt.idempotency_key, successUrl: getPaymentReturnUrl(),
          cancelUrl: getPaymentReturnUrl(), expiresInMinutes,
          paymentMethodTypes: ['NGN_CARD'], idempotencyKey: attempt.idempotency_key,
          metadata: { order_id: proof.order_id, payment_phase: 'INITIAL_ORDER' },
        }),
        retrieve: (checkoutId) => getBachsCheckout(getBachsClient(), checkoutId),
      },
    })
    if (prepared.state !== 'READY' || prepared.checkout.status.toLowerCase() !== 'open') {
      await createOrRefreshOpsIssue(db, {
        issueType: 'PAYMENT_BLOCKED', severity: 'HIGH', source: FN,
        actorRole: 'SYSTEM', orderId: proof.order_id,
        relatedEntityType: 'order_payment', relatedEntityId: attemptId,
        provider: 'BACHS', title: 'Controlled proof checkout needs review',
        description: 'The saved Bachs checkout request did not return an open session. Reconcile the original attempt before any retry.',
        recommendedAction: 'Inspect the saved checkout and original idempotency key; do not create a replacement payment identity.',
        dedupeKey: `phase4-proof-checkout-review:${attemptId}`,
        queueKey: 'money-desk', persistWhenRoutineDisabled: true,
      })
      return response(409, 'PHASE4_PROOF_CHECKOUT_REVIEW_REQUIRED')
    }
    await upsertPreparedPaymentAttempt(db, {
      orderId: proof.order_id, phase: 'INITIAL_ORDER', provider: 'BACHS',
      currency: 'NGN', amount: proof.amount_minor, idempotencyKey,
      providerPaymentId: prepared.checkout.checkout_id,
      providerCheckoutUrl: prepared.checkout.checkout_url,
      providerResponse: { checkout_id: prepared.checkout.checkout_id, existing: prepared.reused, phase4_proof_id: proofId },
      status: 'PENDING', preparedCommercialPricing: newPricing,
    })
    const { error: orderWriteError } = await db.from('orders').update({
      payment_provider: 'BACHS', payment_intent_id: prepared.checkout.checkout_id,
      payment_checkout_url: prepared.checkout.checkout_url,
    }).eq('id', proof.order_id)
    if (orderWriteError) return response(503, 'PHASE4_PROOF_ORDER_BIND_FAILED')
    return response(200, 'PHASE4_PROOF_CHECKOUT_READY', {
      proofId, orderId: proof.order_id, attemptId,
      checkoutId: prepared.checkout.checkout_id,
    })
  } catch {
    // An uncertain provider write must remain on its original attempt/key.
    if (attemptId) {
      try {
        await createOrRefreshOpsIssue(db, {
          issueType: 'PAYMENT_BLOCKED', severity: 'HIGH', source: FN,
          actorRole: 'SYSTEM', orderId: proof.order_id,
          relatedEntityType: 'order_payment', relatedEntityId: attemptId,
          provider: 'BACHS', title: 'Controlled proof checkout outcome uncertain',
          description: 'The checkout may exist at Bachs. Reconcile the saved request before a retry.',
          recommendedAction: 'Retrieve or reconcile the original checkout; do not submit a new idempotency key.',
          dedupeKey: `phase4-proof-checkout-review:${attemptId}`,
          queueKey: 'money-desk', persistWhenRoutineDisabled: true,
        })
      } catch { /* Keep the original attempt blocked even if Ops is unavailable. */ }
    }
    return response(503, 'PHASE4_PROOF_CHECKOUT_REVIEW_REQUIRED')
  }
})
