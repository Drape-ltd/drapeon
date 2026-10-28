import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeCronRequest } from '../_shared/cron.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { createPaystackTransfer, finalizePaystackTransfer, resendPaystackTransferOtp, verifyPaystackTransfer } from '../_shared/paystack.ts'
import { Sentry } from '../_shared/sentry.ts'
import { createStripeTransfer } from '../_shared/stripe.ts'
import { completeTipPayout, holdTipPayout, type ReleasableTip } from '../_shared/tip-payout.ts'
import { loadAcceptedOrderPayoutRoute, loadAcceptedOrderPayoutRouteForReconciliation } from '../_shared/order-payout-destination.ts'
import { createBachsClaimedPayoutProvider } from '../_shared/bachs-claimed-payout.ts'
import { createStripeClaimedPayoutProvider } from '../_shared/stripe-claimed-payout.ts'
import { executeClaimedTipTransfer } from '../_shared/tip-payout-execution.ts'
import { reserveTipMoneyOperation, bindTipPayoutClaim } from '../_shared/tip-money-claims.ts'
import { bachsSandboxCheckoutEnabled } from '../_shared/payment-routes.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
import { isBachsCheckoutPhaseReady } from '../_shared/bachs-collection.ts'
import { resolveTipPayoutGate } from '../_shared/tip-payout.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'
import { resolveOrderPayoutProvider } from '../../../packages/shared/src/order-payout-route.ts'

const FN = 'release-order-tip'
const Body = z.object({
  tipId: uuid,
  action: z.enum(['RELEASE', 'FINALIZE_PAYSTACK_OTP', 'RESEND_PAYSTACK_OTP']).optional(),
  otp: z.string().trim().min(4).max(12).optional(),
})
const json = (body: unknown, status: number, cors: HeadersInit) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  let tipId: string | null = null
  let payoutId: string | null = null
  let tipClaimId: string | null = null
  let tipRecord: ReleasableTip | null = null
  let requestedAction: 'RELEASE' | 'FINALIZE_PAYSTACK_OTP' | 'RESEND_PAYSTACK_OTP' = 'RELEASE'
  try {
    const unauthorized = await authorizeCronRequest(req, FN, cors)
    if (unauthorized) return unauthorized
    const parsed = parseBody(Body, await req.json().catch(() => ({})))
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400, cors)
    tipId = parsed.data.tipId
    requestedAction = parsed.data.action ?? 'RELEASE'
    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    const { data: tip, error: tipError } = await supabase.from('order_tips')
      .select('id,order_id,customer_id,tailor_id,amount,currency,status,payment_id,correlation_id,ledger_transaction_id,payout_id,payout_provider_reference')
      .eq('id', tipId).maybeSingle()
    if (tipError) throw tipError
    if (!tip) return json({ ok: false, error: 'Tip was not found.' }, 404, cors)
    tipRecord = tip as ReleasableTip
    if (parsed.data.action === 'FINALIZE_PAYSTACK_OTP' || parsed.data.action === 'RESEND_PAYSTACK_OTP') {
      if ((parsed.data.action === 'FINALIZE_PAYSTACK_OTP' && !parsed.data.otp) || !['PROCESSING', 'PAID_OUT'].includes(tip.status) || !tip.payout_id) {
        return json({ ok: false, error: 'This tip payout is not awaiting Paystack approval.' }, 409, cors)
      }
      const { data: payout, error: payoutError } = await supabase.from('payouts')
        .select('id,provider,status,provider_response')
        .eq('id', tip.payout_id)
        .maybeSingle()
      if (payoutError) throw payoutError
      const providerResponse = payout?.provider_response && typeof payout.provider_response === 'object'
        ? payout.provider_response as Record<string, unknown>
        : {}
      const transfer = providerResponse.transfer && typeof providerResponse.transfer === 'object'
        ? providerResponse.transfer as Record<string, unknown>
        : providerResponse
      let transferCode = typeof transfer.transfer_code === 'string' ? transfer.transfer_code.trim() : ''
      let verifiedTransfer: Record<string, unknown> | null = null
      if ((!transferCode || parsed.data.action === 'RESEND_PAYSTACK_OTP') && tip.payout_provider_reference) {
        verifiedTransfer = await verifyPaystackTransfer(tip.payout_provider_reference) as Record<string, unknown>
        transferCode = typeof verifiedTransfer.transfer_code === 'string' ? verifiedTransfer.transfer_code.trim() : ''
      }
      if (!payout?.id || payout.provider !== 'PAYSTACK' || !['PROCESSING', 'PAID'].includes(payout.status) || !transferCode) {
        return json({ ok: false, error: 'Paystack transfer approval details are unavailable.' }, 409, cors)
      }
      if (parsed.data.action === 'RESEND_PAYSTACK_OTP') {
        const verifiedStatus = String(verifiedTransfer?.status ?? transfer.status ?? '').trim().toLowerCase()
        if (verifiedStatus !== 'otp') {
          return json({ ok: false, error: `This transfer is ${verifiedStatus || 'not awaiting OTP'} and cannot receive another OTP.` }, 409, cors)
        }
        await resendPaystackTransferOtp(transferCode)
        const now = new Date().toISOString()
        await supabase.from('payouts').update({
          status: 'PROCESSING',
          provider_transfer_status: 'PROCESSING',
          bank_settlement_status: 'PENDING',
          provider_response: {
            ...providerResponse,
            ...(verifiedTransfer ? { verified_transfer: verifiedTransfer } : {}),
            otp_resent_at: now,
          },
        }).eq('id', payout.id)
        if (tip.status === 'PAID_OUT') {
          const { data: correctedTip, error: correctionError } = await supabase.from('order_tips').update({
            status: 'PROCESSING',
            paid_out_at: null,
            failure_reason: null,
            updated_at: now,
          }).eq('id', tip.id).eq('status', 'PAID_OUT').select('id').maybeSingle()
          if (correctionError) throw correctionError
          if (correctedTip?.id) {
            await supabase.from('order_tip_events').insert({
              tip_id: tip.id,
              event_type: 'TIP_PAYOUT_STATE_CORRECTED',
              actor_role: 'SYSTEM',
              payload: { payout_id: payout.id, from: 'PAID_OUT', to: 'PROCESSING', reason: 'PROVIDER_OTP_NOT_TERMINAL' },
              correlation_id: tip.correlation_id,
            })
            await audit(supabase, {
              event: 'tip.payout_state_corrected',
              actor_role: 'SYSTEM',
              order_id: tip.order_id,
              severity: 'warn',
              payload: { function: FN, tip_id: tip.id, payout_id: payout.id, provider_status: verifiedStatus, correlation_id: tip.correlation_id },
            })
          }
        }
        return json({ ok: true, pending: true, otpResent: true, tipId: tip.id, payoutId: payout.id }, 202, cors)
      }
      const finalized = await finalizePaystackTransfer({ transferCode, otp: parsed.data.otp! })
      const providerReference = finalized.reference ?? finalized.transfer_code ?? transferCode
      const finalProviderResponse = {
        ...providerResponse,
        ...(verifiedTransfer ? { verified_transfer: verifiedTransfer } : {}),
        transfer: finalized,
        otp_finalized_at: new Date().toISOString(),
      }
      if (finalized.status !== 'success') {
        await supabase.from('payouts').update({
          status: 'PROCESSING',
          provider_transfer_status: 'PROCESSING',
          bank_settlement_status: 'PENDING',
          provider_payout_id: providerReference,
          provider_response: finalProviderResponse,
        }).eq('id', payout.id)
        return json({ ok: true, pending: true, tipId: tip.id, payoutId: payout.id, providerReference, providerStatus: finalized.status ?? 'processing' }, 202, cors)
      }
      const completed = await completeTipPayout(supabase, {
        tip: tipRecord,
        payoutId: payout.id,
        provider: 'PAYSTACK',
        providerReference,
        providerResponse: finalProviderResponse,
      })
      return json({ ok: true, tipId: tip.id, payoutId: payout.id, providerReference, ledgerTransactionId: completed.ledgerTransactionId }, 200, cors)
    }

    const { data: existingTipClaim, error: existingTipClaimError } = await supabase.from('tip_money_operation_claims')
      .select('id,status,request_key,provider,provider_operation_id,payout_id,operation_kind')
      .eq('tip_id', tip.id).eq('operation_kind', 'PAYOUT').maybeSingle()
    if (existingTipClaimError) throw existingTipClaimError
    if (existingTipClaim?.id) {
      // Preserve the claim before any route/provider reads so an exception can
      // never mark an already-started transfer as terminally failed.
      tipClaimId = existingTipClaim.id
      payoutId = existingTipClaim.payout_id ?? null
    }
    if (tip.status === 'PAID_OUT' && !existingTipClaim?.id) return json({ ok: true, existing: true, tipId: tip.id, payoutId: tip.payout_id, providerReference: tip.payout_provider_reference }, 200, cors)

    const { data: profile } = await supabase.from('tailor_profiles')
      .select('id,payout_account_verified,payout_reverification_required,paystack_recipient_code,stripe_connect_account_id')
      .eq('user_id', tip.tailor_id).maybeSingle()
    if (!profile?.id && !existingTipClaim?.payout_id) return json({ ok: false, error: 'Tailor payout account is not verified.' }, 409, cors)
    const { data: order, error: orderError } = await supabase.from('orders')
      .select('id,tailor_profile_id,accepted_route_snapshot_at,charge_provider_snapshot,charge_currency_snapshot,legal_entity_snapshot,payout_destination_id,tailor_payout_currency_locked,tailor_payout_provider_locked,tailor_paystack_recipient_code_locked,tailor_stripe_connect_account_id_locked')
      .eq('id', tip.order_id).maybeSingle()
    if (orderError) throw orderError
    if (!order) return json({ ok: false, error: 'Order payout route is unavailable.' }, 409, cors)
    const reconcilesExistingClaim = existingTipClaim?.id != null && existingTipClaim.status !== 'RESERVED'
    let acceptedPayoutRoute = reconcilesExistingClaim
      ? null
      : await loadAcceptedOrderPayoutRoute(supabase, order)
    if (reconcilesExistingClaim) {
      if (!existingTipClaim.payout_id || !order.accepted_route_snapshot_at) {
        throw new Error('TIP_CLAIM_RECONCILIATION_SNAPSHOT_MISSING')
      }
      const { data: claimedPayout, error: claimedPayoutError } = await supabase.from('payouts')
        .select('id_text,provider,provider_destination_id,amount,currency,payout_purpose,source_payment_id')
        .eq('id_text', existingTipClaim.payout_id)
        .maybeSingle()
      if (claimedPayoutError) throw claimedPayoutError
      if (!claimedPayout?.id_text || claimedPayout.payout_purpose !== 'TIP'
        || claimedPayout.source_payment_id !== tip.payment_id || claimedPayout.amount !== tip.amount
        || claimedPayout.currency !== tip.currency || claimedPayout.provider !== existingTipClaim.provider
        || claimedPayout.provider !== order.charge_provider_snapshot) {
        throw new Error('TIP_CLAIMED_PAYOUT_IDENTITY_MISMATCH')
      }
      // Once the DB start gate has run, a fresh capability failure must not
      // prevent lookup of the already-pinned provider operation. No new send
      // can be authorized from this identity-only route.
      acceptedPayoutRoute = await loadAcceptedOrderPayoutRouteForReconciliation(
        supabase,
        order,
        claimedPayout.provider_destination_id,
      )
    }
    if (acceptedPayoutRoute && acceptedPayoutRoute.payoutCurrency !== tip.currency) return json({ ok: false, error: 'Tip currency does not match the accepted payout destination.' }, 409, cors)
    const provider = acceptedPayoutRoute?.provider ?? resolveOrderPayoutProvider(order)
    if (!provider) return json({ ok: false, error: 'The order has no verified payout provider.' }, 409, cors)

    const tipGate = resolveTipPayoutGate({
      provider,
      bachsPathReady: isBachsCheckoutPhaseReady('TIP'),
      existingClaimStatus: existingTipClaim?.status ?? null,
    })
    if (tipGate === 'BLOCK_UNSUPPORTED_BACHS') {
      await createOrRefreshOpsIssue(supabase, {
        issueType: 'PAYOUT_FAILED',
        severity: 'HIGH',
        source: FN,
        actorRole: 'SYSTEM',
        orderId: tip.order_id,
        relatedEntityType: 'ORDER_TIP',
        relatedEntityId: tip.id,
        provider: 'BACHS',
        title: 'Bachs tip payout is not enabled',
        description: 'A Bachs tip reached payout processing before the complete tip collection, payout, and refund path was enabled. No transfer was sent.',
        recommendedAction: 'Keep the tip in review. Reconcile the captured charge and refund options; do not enable Bachs tips until the complete route is proven.',
        dedupeKey: `bachs-tip-path-not-ready:${tip.id}`,
        queueKey: 'money-desk',
        persistWhenRoutineDisabled: true,
        metadata: {
          tip_id: tip.id,
          payment_id: tip.payment_id,
          payout_claim_status: existingTipClaim?.status ?? null,
          blocked_phase: 'TIP',
        },
      })
      await audit(supabase, {
        event: 'tip.payout.blocked_unsupported_bachs_path',
        actor_role: 'SYSTEM',
        order_id: tip.order_id,
        severity: 'error',
        payload: { function: FN, tip_id: tip.id, payment_id: tip.payment_id, correlation_id: tip.correlation_id },
      })
      return json({ ok: true, blocked: true, tipId: tip.id, reason: 'BACHS_TIP_PATH_NOT_READY' }, 202, cors)
    }

    if (acceptedPayoutRoute && (provider === 'STRIPE' || provider === 'BACHS')) {
      if (provider === 'BACHS' && !reconcilesExistingClaim && !bachsSandboxCheckoutEnabled({
        supabaseUrl: getSupabaseUrl(),
        flag: Deno.env.get('BACHS_SANDBOX_CHECKOUT_ENABLED'),
      })) {
        return json({ ok: false, error: 'Bachs tip payouts are unavailable outside the Dev sandbox route.' }, 409, cors)
      }
      if (!reconcilesExistingClaim && (tip.status !== 'PAYOUT_PENDING' || profile?.payout_reverification_required === true)) {
        return json({ ok: false, error: 'Only captured tips with a ready payout destination can be released.' }, 409, cors)
      }
      if (provider === 'STRIPE' && !reconcilesExistingClaim
        && (!profile?.payout_account_verified || profile.payout_reverification_required === true)) {
        return json({ ok: false, error: 'Tailor payout account is not verified.' }, 409, cors)
      }
      const { data: sourcePayment, error: sourcePaymentError } = await supabase.from('order_payments')
        .select('id,order_id,phase,provider,status,amount,currency,refunded_amount')
        .eq('id', tip.payment_id).maybeSingle()
      if (sourcePaymentError) throw sourcePaymentError
      if (!sourcePayment?.id || sourcePayment.order_id !== tip.order_id || sourcePayment.phase !== 'TIP'
        || sourcePayment.provider !== provider || sourcePayment.amount !== tip.amount
        || sourcePayment.currency !== tip.currency
        || (!reconcilesExistingClaim && (sourcePayment.status !== 'SUCCEEDED' || (sourcePayment.refunded_amount ?? 0) > 0))) {
        return json({ ok: false, error: 'The tip charge is not in a releasable captured state.' }, 409, cors)
      }

      const requestKey = `tip:${tip.id}:payout`
      const reservation = await reserveTipMoneyOperation(supabase, {
        tipId: tip.id,
        kind: 'PAYOUT',
        key: requestKey,
      })
      if (reservation.outcome === 'BLOCKED_BY_REFUND') {
        return json({ ok: false, error: 'This tip is under an approved refund review.' }, 409, cors)
      }
      if (reservation.outcome === 'NOT_RELEASABLE' || !reservation.claim_id) {
        return json({ ok: false, error: 'This tip is not available for payout.' }, 409, cors)
      }
      tipClaimId = reservation.claim_id
      const { data: claim, error: claimError } = await supabase.from('tip_money_operation_claims')
        .select('id,status,request_key,provider,provider_operation_id,payout_id,operation_kind')
        .eq('id', reservation.claim_id).maybeSingle()
      if (claimError) throw claimError
      if (!claim?.id || claim.operation_kind !== 'PAYOUT' || claim.request_key !== requestKey || claim.provider !== provider) {
        throw new Error('The reserved TIP payout claim does not match its accepted route.')
      }

      let claimPayoutId = claim.payout_id
      if (!claimPayoutId) {
        const { data: priorPayout, error: priorPayoutError } = await supabase.from('payouts')
          .select('id_text,provider,provider_destination_id,amount,currency,payout_purpose,source_payment_id')
          .eq('payout_purpose', 'TIP').eq('source_payment_id', tip.payment_id)
          .maybeSingle()
        if (priorPayoutError) throw priorPayoutError
        if (priorPayout?.id_text) {
          if (priorPayout.provider !== provider || priorPayout.provider_destination_id !== acceptedPayoutRoute.providerAccountRef
            || priorPayout.amount !== tip.amount || priorPayout.currency !== tip.currency) {
            throw new Error('An existing TIP payout row conflicts with the accepted destination snapshot.')
          }
          claimPayoutId = priorPayout.id_text
        } else {
          if (!profile?.id) throw new Error('TIP_PAYOUT_PROFILE_REQUIRED_FOR_NEW_PAYOUT')
          const { data: createdPayout, error: createPayoutError } = await supabase.from('payouts').insert({
            tailor_profile_id: profile.id,
            order_id: tip.order_id,
            amount: tip.amount,
            currency: tip.currency,
            provider,
            status: 'PROCESSING',
            payout_purpose: 'TIP',
            source_payment_id: tip.payment_id,
            provider_response: { function: FN, tip_id: tip.id, claim_id: claim.id },
            provider_transfer_status: 'PROCESSING',
            bank_settlement_status: 'PENDING',
            provider_destination_id: acceptedPayoutRoute.providerAccountRef,
          }).select('id_text').single()
          if (createPayoutError) throw createPayoutError
          claimPayoutId = createdPayout.id_text
        }
        await bindTipPayoutClaim(supabase, {
          claimId: claim.id,
          payoutId: claimPayoutId,
          provider,
          destinationId: acceptedPayoutRoute.providerAccountRef,
        })
      }
      payoutId = claimPayoutId
      const transferIdentity = {
        destinationAccountId: acceptedPayoutRoute.providerAccountRef,
        amountMinor: tip.amount,
        currency: tip.currency,
        transferGroup: `order:${tip.order_id}`,
        description: `Drapeon customer tip ${tip.id}`,
        claimKey: requestKey,
      }
      const providerAdapter = provider === 'BACHS'
        ? createBachsClaimedPayoutProvider(transferIdentity)
        : createStripeClaimedPayoutProvider({
          ...transferIdentity,
          orderId: tip.order_id,
          payoutId: claimPayoutId,
        })
      const execution = await executeClaimedTipTransfer({
        supabase,
        claimId: claim.id,
        requestKey,
        providerName: provider,
        provider: providerAdapter,
        onTerminalConflict: async (status, evidence) => {
          await createOrRefreshOpsIssue(supabase, {
            issueType: 'PAYOUT_FAILED',
            severity: 'CRITICAL',
            source: FN,
            actorRole: 'SYSTEM',
            orderId: tip.order_id,
            provider,
            relatedEntityType: 'ORDER_TIP',
            relatedEntityId: tip.id,
            title: 'Tip transfer needs provider reconciliation',
            description: `Provider evidence conflicted with the durable tip payout state (${status}).`,
            recommendedAction: 'Inspect the exact claim and provider transfer. Never send a second transfer while the result is uncertain.',
            dedupeKey: `tip-provider-reconcile:${claim.id}`,
            persistWhenRoutineDisabled: true,
            metadata: { tip_id: tip.id, claim_id: claim.id, payout_id: claimPayoutId, evidence },
          })
        },
        finalize: async (transferId, evidence) => {
          if (provider === 'STRIPE') {
            const { data: finalized, error: finalizeError } = await supabase.rpc('finalize_claimed_stripe_tip_payout', {
              p_tip_id: tip.id,
              p_claim_id: claim.id,
              p_payout_id: claimPayoutId,
              p_provider_transfer_id: transferId,
              p_provider_response: evidence,
            })
            if (finalizeError) throw finalizeError
            if (!finalized || !['COMPLETED', 'EXISTING'].includes(finalized.outcome)
              || finalized.tip_id !== tip.id || finalized.payout_id !== claimPayoutId
              || finalized.provider_transfer_id !== transferId) {
              throw new Error('Stripe did not finalize the exact claimed tip payout.')
            }
          }
          const providerResponse = evidence && typeof evidence === 'object'
            ? evidence as Record<string, unknown>
            : { provider: provider, transfer_id: transferId }
          await completeTipPayout(supabase, {
            tip: tipRecord!,
            payoutId: claimPayoutId,
            provider,
            providerReference: transferId,
            providerResponse,
            claimId: claim.id,
          })
        },
      })
      if (execution.kind === 'PENDING') {
        const observedProviderReference = execution.transferId ?? claim.provider_operation_id ?? null
        const patch: Record<string, unknown> = {
          status: 'PROCESSING',
          provider_transfer_status: 'PROCESSING',
          bank_settlement_status: 'PENDING',
          provider_response: { function: FN, tip_id: tip.id, claim_id: claim.id, state: execution.reason },
        }
        if (observedProviderReference) patch.provider_payout_id = observedProviderReference
        const { error: payoutUpdateError } = await supabase.from('payouts').update(patch).eq('id_text', claimPayoutId)
        if (payoutUpdateError) throw payoutUpdateError
        const { error: tipUpdateError } = await supabase.from('order_tips').update({
          status: 'PROCESSING', payout_id: claimPayoutId,
          ...(observedProviderReference ? { payout_provider_reference: observedProviderReference } : {}),
          updated_at: new Date().toISOString(),
        }).eq('id', tip.id).in('status', ['PAYOUT_PENDING', 'PROCESSING'])
        if (tipUpdateError) throw tipUpdateError
        return json({ ok: true, pending: true, tipId: tip.id, payoutId: claimPayoutId,
          providerReference: observedProviderReference }, 202, cors)
      }
      if (execution.kind === 'BLOCKED') {
        return json({ ok: true, pending: true, blocked: true, tipId: tip.id, payoutId: claimPayoutId }, 202, cors)
      }
      return json({ ok: true, tipId: tip.id, payoutId: claimPayoutId,
        providerReference: execution.transferId }, 200, cors)
    }

    if (!profile?.id) return json({ ok: false, error: 'Tailor payout account is not verified.' }, 409, cors)
    if (tip.status === 'PAID_OUT') return json({ ok: true, existing: true, tipId: tip.id, payoutId: tip.payout_id, providerReference: tip.payout_provider_reference }, 200, cors)
    if (tip.status !== 'PAYOUT_PENDING') return json({ ok: false, error: 'Only captured tips can be released.' }, 409, cors)
    if (profile.payout_account_verified !== true || profile.payout_reverification_required === true) return json({ ok: false, error: 'Tailor payout account is not verified.' }, 409, cors)
    const recipient = acceptedPayoutRoute
      ? (provider === 'PAYSTACK' ? acceptedPayoutRoute.providerAccountRef : null)
      : (order.tailor_paystack_recipient_code_locked || profile.paystack_recipient_code)
    const account = acceptedPayoutRoute
      ? (provider === 'STRIPE' ? acceptedPayoutRoute.providerAccountRef : null)
      : (order.tailor_stripe_connect_account_id_locked || profile.stripe_connect_account_id)
    if (provider === 'PAYSTACK' && !recipient) return json({ ok: false, error: 'Paystack recipient is missing.' }, 409, cors)
    if (provider === 'STRIPE' && !account) return json({ ok: false, error: 'Stripe Connect account is missing.' }, 409, cors)
    const { data: payout, error: payoutError } = await supabase.from('payouts').insert({
      tailor_profile_id: profile.id, order_id: tip.order_id, amount: tip.amount, currency: tip.currency,
      provider, status: 'PROCESSING', payout_purpose: 'TIP', source_payment_id: tip.payment_id, provider_response: { function: FN, tip_id: tip.id },
      provider_transfer_status: 'PROCESSING', bank_settlement_status: provider === 'STRIPE' ? 'PENDING' : 'NOT_APPLICABLE',
      provider_destination_id: provider === 'STRIPE' ? account : recipient,
    }).select('id').single()
    if (payoutError) throw payoutError
    payoutId = payout.id
    let providerReference: string
    let providerResponse: Record<string, unknown>
    if (provider === 'PAYSTACK') {
      const transfer = await createPaystackTransfer({ amount: tip.amount, recipientCode: recipient!, reason: 'Drapeon customer tip', reference: `DRAPE-TIP-PAYOUT-${tip.id}`, currency: tip.currency })
      providerReference = transfer.reference ?? transfer.transfer_code ?? `DRAPE-TIP-PAYOUT-${tip.id}`
      providerResponse = { function: FN, tip_id: tip.id, transfer }
      const providerStatus = String(transfer.status ?? '').trim().toLowerCase()
      await supabase.from('payouts').update({
        status: providerStatus === 'success' ? 'PAID' : 'PROCESSING',
        provider_payout_id: providerReference,
        provider_transfer_status: providerStatus === 'success' ? 'PAID_TO_BANK' : 'PROCESSING',
        bank_settlement_status: providerStatus === 'success' ? 'PAID' : 'PENDING',
        provider_response: providerResponse,
      }).eq('id', payout.id)
      if (providerStatus !== 'success') {
        const now = new Date().toISOString()
        await supabase.from('order_tips').update({
          status: 'PROCESSING',
          payout_id: payout.id,
          payout_provider_reference: providerReference,
          updated_at: now,
        }).eq('id', tip.id).eq('status', 'PAYOUT_PENDING')
        await supabase.from('order_tip_events').insert({
          tip_id: tip.id,
          event_type: 'TIP_PAYOUT_PROCESSING',
          actor_role: 'SYSTEM',
          payload: { payout_id: payout.id, provider, provider_reference: providerReference, provider_status: providerStatus || 'processing', requires_otp: providerStatus === 'otp' },
          correlation_id: tip.correlation_id,
        })
        return json({ ok: true, pending: true, requiresOtp: providerStatus === 'otp', tipId: tip.id, payoutId: payout.id, providerReference, providerStatus: providerStatus || 'processing' }, 202, cors)
      }
    } else {
      const transfer = await createStripeTransfer({ amount: tip.amount, currency: tip.currency, destinationAccountId: account!, idempotencyKey: `DRAPE-TIP-PAYOUT-${tip.id}`, transferGroup: `order:${tip.order_id}`, metadata: { order_id: tip.order_id, tip_id: tip.id, payout_id: payout.id } })
      providerReference = transfer.id
      providerResponse = { function: FN, tip_id: tip.id, transfer }
    }
    const completed = await completeTipPayout(supabase, {
      tip: tipRecord,
      payoutId: payout.id,
      provider,
      providerReference,
      providerResponse,
    })
    return json({ ok: true, tipId: tip.id, payoutId: payout.id, providerReference, ledgerTransactionId: completed.ledgerTransactionId }, 200, cors)
  } catch (error) {
    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    const failure = error instanceof Error ? error.message : String(error)
    if (tipRecord && requestedAction === 'RELEASE' && !tipClaimId) {
      await holdTipPayout(supabase, { tip: tipRecord, payoutId, failure })
    }
    if (tipClaimId && tipRecord) {
      await createOrRefreshOpsIssue(supabase, {
        issueType: 'PAYOUT_FAILED',
        severity: 'HIGH',
        source: FN,
        actorRole: 'SYSTEM',
        orderId: tipRecord.order_id,
        relatedEntityType: 'ORDER_TIP',
        relatedEntityId: tipRecord.id,
        title: 'Tip payout needs claim reconciliation',
        description: 'The durable tip payout claim remains linked to this tip; a failure during processing must not trigger a new transfer.',
        recommendedAction: 'Retry the release worker in reconciliation mode and inspect the provider state using the same claim key. Do not create another payout.',
        dedupeKey: `tip-claim-execution:${tipClaimId}`,
        persistWhenRoutineDisabled: true,
        metadata: { tip_id: tipRecord.id, payout_id: payoutId, claim_id: tipClaimId, error: failure },
      })
    }
    await Sentry.captureMessage('Order tip release failed', { level: 'error', tags: { function: FN, failure_class: 'tip_release' }, extra: { tip_id: tipId, payout_id: payoutId, error: error instanceof Error ? error.message : String(error) } })
    log('error', FN, 'failed', { tip_id: tipId, payout_id: payoutId, error: error instanceof Error ? error.message : String(error) })
    return json({ ok: false, error: error instanceof Error ? error.message : 'Tip payout failed.' }, 500, cors)
  }
})
