import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeCronRequest } from '../_shared/cron.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { createBachsClaimedPayoutProvider } from '../_shared/bachs-claimed-payout.ts'
import { createStripeClaimedPayoutProvider } from '../_shared/stripe-claimed-payout.ts'
import {
  executeReservedPayout,
  isNormalConcurrentPayoutLoser,
} from '../_shared/claimed-payout-execution.ts'
import { reviewedAdjustmentPayoutIdentity } from '../_shared/reviewed-adjustment-payout.ts'
import type { PayoutClaimReservation, PayoutClaimStatus } from '../_shared/payout-claims.ts'
import { createOrRefreshOpsIssue, resolveOpsIssueByDedupeKey } from '../_shared/ops-issues.ts'
import { enqueuePushJob } from '../_shared/side-effect-jobs.ts'
import { Sentry } from '../_shared/sentry.ts'
import {
  loadAcceptedOrderPayoutRoute,
  loadAcceptedOrderPayoutRouteForReconciliation,
} from '../_shared/order-payout-destination.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'

const FN = 'release-tailor-adjustment'
const Body = z.object({ adjustmentId: uuid, moneyDeskRequestId: uuid })
const json = (body: Record<string, unknown>, status: number, cors: HeadersInit) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })

function recordFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  let adjustmentId: string | null = null
  let orderId: string | null = null
  let claimId: string | null = null
  let provider: 'BACHS' | 'STRIPE' | null = null
  try {
    const unauthorized = await authorizeCronRequest(req, FN, cors)
    if (unauthorized) return unauthorized
    const parsed = parseBody(Body, await req.json().catch(() => ({})))
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400, cors)
    adjustmentId = parsed.data.adjustmentId
    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())

    const { data: adjustment, error: adjustmentError } = await supabase
      .from('commercial_adjustments')
      .select(
        'id,order_id,tailor_id,payment_id,amount_delta,currency,status,tailor_release_policy_version,correlation_id'
      )
      .eq('id', adjustmentId)
      .maybeSingle()
    if (adjustmentError) throw adjustmentError
    if (!adjustment?.id) return json({ ok: false, error: 'Adjustment was not found.' }, 404, cors)
    orderId = String(adjustment.order_id)

    const { data: request, error: requestError } = await supabase
      .from('money_desk_requests')
      .select(
        'id,status,action_type,target_type,target_id,order_id,amount,currency,approval_count,required_approval_count'
      )
      .eq('id', parsed.data.moneyDeskRequestId)
      .maybeSingle()
    if (requestError) throw requestError
    if (
      !request?.id ||
      request.action_type !== 'PAYOUT_RELEASE' ||
      request.target_type !== 'TAILOR_ADJUSTMENT' ||
      request.target_id !== adjustment.id ||
      request.order_id !== orderId ||
      request.approval_count !== request.required_approval_count
    ) {
      return json(
        { ok: false, error: 'An approved Money Desk adjustment release is required.' },
        409,
        cors
      )
    }

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(
        'id,id_text,reference,tailor_id,tailor_profile_id,accepted_route_snapshot_at,charge_provider_snapshot,charge_currency_snapshot,legal_entity_snapshot,payout_destination_id,payment_route_id,payment_route_version,tailor_terms_version_snapshot,tailor_payout_currency_locked'
      )
      .eq('id_text', orderId)
      .maybeSingle()
    if (orderError) throw orderError
    if (!order?.id || order.id_text !== orderId) {
      return json(
        { ok: false, error: 'The accepted order payout snapshot is unavailable.' },
        409,
        cors
      )
    }

    const { data: reservedRaw, error: reserveError } = await supabase.rpc(
      'reserve_reviewed_tailor_adjustment_payout',
      {
        p_adjustment_id: adjustment.id,
        p_money_desk_request_id: request.id,
        p_route_version: order.payment_route_version,
        p_tailor_terms_version: order.tailor_terms_version_snapshot,
      }
    )
    if (reserveError) throw reserveError
    const reserved = recordFrom(reservedRaw)
    const validStatuses = new Set<PayoutClaimStatus>([
      'RESERVED',
      'PROVIDER_UNKNOWN',
      'PROVIDER_PENDING',
      'TRANSFERRED',
      'WITHDRAWN',
      'FAILED_RECONCILED',
      'BLOCKED',
    ])
    if (
      !reserved ||
      !['RESERVED', 'EXISTING'].includes(String(reserved.outcome)) ||
      typeof reserved.claim_id !== 'string' ||
      !validStatuses.has(reserved.status as PayoutClaimStatus) ||
      typeof reserved.payout_id !== 'string' ||
      typeof reserved.provider_idempotency_key !== 'string' ||
      typeof reserved.provider_destination_id !== 'string' ||
      typeof reserved.provider !== 'string' ||
      typeof reserved.currency !== 'string' ||
      !Number.isSafeInteger(reserved.amount) ||
      Number(reserved.amount) <= 0
    ) {
      throw new Error('Adjustment reservation returned an incomplete payout identity.')
    }
    claimId = reserved.claim_id
    if (reserved.provider !== 'BACHS' && reserved.provider !== 'STRIPE') {
      throw new Error('The accepted adjustment payout provider is not supported.')
    }
    provider = reserved.provider

    const route =
      reserved.status === 'RESERVED'
        ? await loadAcceptedOrderPayoutRoute(supabase, order)
        : await loadAcceptedOrderPayoutRouteForReconciliation(
            supabase,
            order,
            reserved.provider_destination_id
          )
    if (
      !route ||
      route.provider !== reserved.provider ||
      route.providerAccountRef !== reserved.provider_destination_id ||
      route.payoutCurrency !== reserved.currency
    ) {
      throw new Error('Adjustment payout does not match its accepted provider destination.')
    }

    const identity = reviewedAdjustmentPayoutIdentity({
      id: reserved.claim_id,
      business_key: `adjustment:${adjustment.id}`,
      source_kind: 'TAILOR_ADJUSTMENT',
      source_id: adjustment.id,
      order_id: orderId,
      tailor_profile_id: String(order.tailor_profile_id),
      provider: reserved.provider,
      provider_destination_id: reserved.provider_destination_id,
      currency: reserved.currency,
      amount: Number(reserved.amount),
      route_version: String(order.payment_route_version ?? ''),
      earning_policy_version: String(adjustment.tailor_release_policy_version ?? ''),
      tailor_terms_version: order.tailor_terms_version_snapshot ?? null,
      provider_idempotency_key: reserved.provider_idempotency_key,
    })
    const { data: payout, error: payoutError } = await supabase
      .from('payouts')
      .select(
        'id,order_id,tailor_profile_id,tailor_adjustment_id,payout_purpose,source_payment_id,provider,provider_destination_id,amount,currency'
      )
      .eq('id', reserved.payout_id)
      .maybeSingle()
    if (payoutError) throw payoutError
    if (
      !payout?.id ||
      payout.order_id !== order.id ||
      payout.tailor_profile_id !== order.tailor_profile_id ||
      payout.tailor_adjustment_id !== adjustment.id ||
      payout.payout_purpose !== 'TAILOR_ADJUSTMENT' ||
      payout.source_payment_id !== adjustment.payment_id ||
      payout.provider !== identity.provider ||
      payout.provider_destination_id !== identity.destinationId ||
      payout.amount !== identity.amount ||
      payout.currency !== identity.currency
    ) {
      throw new Error('Adjustment payout row differs from its immutable claim.')
    }

    const reservation: PayoutClaimReservation = {
      outcome: reserved.outcome as PayoutClaimReservation['outcome'],
      claim_id: reserved.claim_id,
      status: reserved.status as PayoutClaimStatus,
      provider_idempotency_key: reserved.provider_idempotency_key,
      provider_transfer_id:
        typeof reserved.provider_transfer_id === 'string' ? reserved.provider_transfer_id : null,
      payout_id: reserved.payout_id,
    }
    const providerIdentity = {
      destinationAccountId: identity.destinationId,
      amountMinor: identity.amount,
      currency: identity.currency,
      transferGroup: `order:${orderId}`,
      description: `Drapeon adjustment ${adjustment.id}`,
      claimKey: identity.businessKey,
    }
    const adapter =
      identity.provider === 'BACHS'
        ? createBachsClaimedPayoutProvider(providerIdentity)
        : createStripeClaimedPayoutProvider({
            ...providerIdentity,
            orderId,
            payoutId: payout.id,
          })

    const result = await executeReservedPayout(
      supabase,
      identity,
      reservation,
      adapter,
      async (transferId) => {
        const { data, error } = await supabase.rpc('finalize_reviewed_adjustment_transfer', {
          p_adjustment_id: adjustment.id,
          p_claim_id: reservation.claim_id,
          p_provider_transfer_id: transferId,
        })
        if (error) throw error
        const finalized = recordFrom(data)
        if (
          !finalized ||
          !['COMPLETED', 'EXISTING'].includes(String(finalized.outcome)) ||
          finalized.claim_id !== reservation.claim_id ||
          finalized.provider_transfer_id !== transferId
        ) {
          throw new Error('Adjustment transfer finalization returned a conflicting receipt.')
        }
      },
      undefined,
      { reconcileOnly: reservation.status !== 'RESERVED' }
    )

    if (result.kind === 'CONFIRMED') {
      await resolveOpsIssueByDedupeKey(supabase, `tailor-adjustment-transfer:${adjustment.id}`, {
        outcome: 'CONFIRMED_TRANSFER',
        providerReference: result.transferId,
      })
      await audit(supabase, {
        event: 'commercial_adjustment.payout_transferred',
        actor_role: 'SYSTEM',
        order_id: orderId,
        payload: {
          function: FN,
          adjustment_id: adjustment.id,
          payout_claim_id: reservation.claim_id,
          payout_id: payout.id,
          money_desk_request_id: request.id,
          provider,
          provider_reference: result.transferId,
          currency: identity.currency,
          amount: identity.amount,
          correlation_id: adjustment.correlation_id,
        },
      })
      await enqueuePushJob(supabase, {
        userId: String(adjustment.tailor_id),
        orderId,
        source: FN,
        idempotencyKey: `tailor-adjustment-released:${adjustment.id}`,
        priority: 9,
        notification: {
          title: 'Adjustment earnings transferred',
          body: `Drapeon transferred ${identity.currency} earnings for this order change to your ${provider === 'BACHS' ? 'Bachs' : 'Stripe'} balance. Bank withdrawals are tracked separately.`,
          preferenceKey: 'paymentReleased',
          data: { orderId, commercialAdjustmentId: adjustment.id, url: '/account/earnings' },
          communication: {
            category: 'PAYOUT',
            purpose: 'TRANSACTIONAL',
            severity: 'NOTICE',
            mandatory: true,
            inApp: true,
            destinationKey: 'ORDER_DETAIL',
            destinationParams: { orderId },
            deduplicationKey: `tailor-adjustment-released:${adjustment.id}`,
          },
        },
      })
      return json({ ok: true, pending: false, providerReference: reservation.claim_id }, 200, cors)
    }

    if (result.kind === 'PENDING') {
      if (isNormalConcurrentPayoutLoser(result)) {
        return json(
          {
            ok: true,
            pending: true,
            alreadyInProgress: true,
            claimStatus: reservation.status,
            providerReference: reservation.claim_id,
          },
          200,
          cors
        )
      }
      await createOrRefreshOpsIssue(supabase, {
        issueType: 'SYSTEM_ALERT',
        severity: 'MEDIUM',
        source: FN,
        actorRole: 'SYSTEM',
        orderId,
        provider,
        relatedEntityType: 'PAYOUT_CLAIM',
        relatedEntityId: reservation.claim_id,
        queueKey: 'money-desk',
        title: `${provider === 'BACHS' ? 'Bachs' : 'Stripe'} adjustment transfer is awaiting confirmation`,
        description:
          'The adjustment payout remains linked to the same provider claim. Drapeon will look up this transfer and will not create a second earning transfer.',
        recommendedAction:
          'Check the saved provider transfer reference and allow the settlement monitor to reconcile its final status.',
        dedupeKey: `tailor-adjustment-transfer:${adjustment.id}`,
        persistWhenRoutineDisabled: true,
        metadata: {
          adjustment_id: adjustment.id,
          claim_id: reservation.claim_id,
          payout_id: payout.id,
        },
      })
      return json({ ok: true, pending: true, providerReference: reservation.claim_id }, 202, cors)
    }

    await createOrRefreshOpsIssue(supabase, {
      issueType: 'PAYOUT_FAILED',
      severity: 'HIGH',
      source: FN,
      actorRole: 'SYSTEM',
      orderId,
      provider,
      relatedEntityType: 'PAYOUT_CLAIM',
      relatedEntityId: reservation.claim_id,
      queueKey: 'money-desk',
      title: 'Adjustment payout is blocked for review',
      description:
        'The payout claim did not meet its immutable provider and earning checks. No replacement earning was created.',
      recommendedAction:
        'Review the exact accepted order snapshot and provider operation before taking another action.',
      dedupeKey: `tailor-adjustment-blocked:${adjustment.id}`,
      persistWhenRoutineDisabled: true,
      metadata: {
        adjustment_id: adjustment.id,
        claim_id: reservation.claim_id,
        payout_id: payout.id,
      },
    })
    return json({ ok: true, pending: true, providerReference: reservation.claim_id }, 202, cors)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Adjustment payout could not be reconciled.'
    log('error', FN, 'adjustment_payout.failed_closed', {
      adjustment_id: adjustmentId,
      order_id: orderId,
      claim_id: claimId,
      provider,
      error: message,
    })
    await Sentry.captureMessage(message, {
      level: 'error',
      tags: { function: FN, provider: provider ?? 'UNKNOWN' },
      extra: {
        adjustment_id: adjustmentId,
        order_id: orderId,
        claim_id: claimId,
      },
    })
    try {
      const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
      if (adjustmentId) {
        await createOrRefreshOpsIssue(supabase, {
          issueType: 'PAYOUT_FAILED',
          severity: 'HIGH',
          source: FN,
          actorRole: 'SYSTEM',
          orderId,
          provider,
          relatedEntityType: claimId ? 'PAYOUT_CLAIM' : 'TAILOR_ADJUSTMENT',
          relatedEntityId: claimId ?? adjustmentId,
          queueKey: 'money-desk',
          title: 'Adjustment payout needs reconciliation',
          description:
            'The reviewed adjustment release did not complete. The accepted earning and its payout claim remain unchanged.',
          recommendedAction:
            'Inspect the exact payout claim and provider status. Reconcile by lookup before any retry.',
          dedupeKey: `tailor-adjustment-error:${adjustmentId}`,
          persistWhenRoutineDisabled: true,
          metadata: { adjustment_id: adjustmentId, claim_id: claimId, error: message },
        })
      }
    } catch (issueError) {
      log('error', FN, 'adjustment_payout.ops_case_failed', {
        adjustment_id: adjustmentId,
        claim_id: claimId,
        error: issueError instanceof Error ? issueError.message : String(issueError),
      })
    }
    return json(
      { ok: false, error: 'Adjustment payout is under review. No new transfer will be sent.' },
      409,
      cors
    )
  }
})
