import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeCronRequest } from '../_shared/cron.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { createOrRefreshOpsIssue, resolveOpsIssueByDedupeKey } from '../_shared/ops-issues.ts'
import { audit, log } from '../_shared/logger.ts'
import { enqueueOrderEventEmailJob, enqueuePushJob } from '../_shared/side-effect-jobs.ts'
import { enqueueBackgroundJob } from '../_shared/jobs.ts'
import { Sentry } from '../_shared/sentry.ts'
import { retrieveStripePayout, type StripePayout } from '../_shared/stripe.ts'
import { reconcileBachsTrancheClaim, type BachsTrancheClaimRow } from '../_shared/reconcile-bachs-tranche-claim.ts'
import { reserveSettlementTranchePayout } from '../_shared/claimed-tranche-payout.ts'

const FN = 'monitor-settlements'
const json = (body: Record<string, unknown>, status: number, cors: HeadersInit) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

type PendingStripeSettlement = {
  id: string
  order_id: string | null
  tailor_profile_id: string
  amount: number
  currency: string
  status: string
  provider_destination_id: string | null
  provider_bank_payout_id: string | null
  bank_settlement_status: string
  bank_settlement_expected_at: string | null
  initiated_at: string | null
}

function bankStatus(payout: StripePayout) {
  switch (payout.status?.toLowerCase()) {
    case 'paid': return 'PAID'
    case 'failed': return 'FAILED'
    case 'canceled': return 'CANCELED'
    case 'in_transit': return 'IN_TRANSIT'
    default: return 'PENDING'
  }
}

async function reconcileStaleStripeSettlement(
  supabase: SupabaseClient,
  payout: PendingStripeSettlement,
) {
  const issueKey = `stripe-bank-settlement-stale:${payout.id}`
  const startedAt = payout.bank_settlement_expected_at ?? payout.initiated_at
  const waitingHours = startedAt
    ? Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 3_600_000))
    : 0
  if (waitingHours < 24) return { stale: false, reconciled: false }

  let providerPayout: StripePayout | null = null
  if (payout.provider_destination_id && payout.provider_bank_payout_id) {
    try {
      providerPayout = await retrieveStripePayout({
        accountId: payout.provider_destination_id,
        payoutId: payout.provider_bank_payout_id,
      })
    } catch (error) {
      await Sentry.captureMessage('Stripe stale-settlement reconciliation failed', {
        level: 'error',
        tags: { function: FN, provider: 'STRIPE', failure_class: 'provider_retrieval' },
        extra: {
          payout_id: payout.id,
          order_id: payout.order_id,
          provider_bank_payout_id: payout.provider_bank_payout_id,
          error: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }

  const observed = providerPayout ? bankStatus(providerPayout) : payout.bank_settlement_status
  const nowIso = new Date().toISOString()
  if (providerPayout && ['PAID', 'FAILED', 'CANCELED'].includes(observed)) {
    const terminal = observed === 'PAID' ? 'PAID' : observed === 'FAILED' ? 'FAILED' : 'CANCELED'
    const { error: updateError } = await supabase.from('payouts').update({
      status: terminal,
      bank_settlement_status: observed,
      provider_transfer_status: observed === 'PAID' ? 'PAID_TO_BANK' : 'FAILED',
      bank_settlement_expected_at: providerPayout.arrival_date
        ? new Date(providerPayout.arrival_date * 1000).toISOString()
        : payout.bank_settlement_expected_at,
      bank_settlement_completed_at: observed === 'PAID' ? nowIso : null,
      bank_settlement_failed_at: observed === 'PAID' ? null : nowIso,
      bank_settlement_failure_code: observed === 'PAID' ? null : providerPayout.failure_code ?? observed,
      completed_at: observed === 'PAID' ? nowIso : null,
      failed_at: observed === 'PAID' ? null : nowIso,
      blocked_reason: observed === 'PAID' ? null : `STRIPE_BANK_PAYOUT_${observed}`,
      processed_at: nowIso,
    }).eq('id', payout.id)
    if (updateError) throw updateError
    await supabase.from('provider_payout_events').upsert({
      provider: 'STRIPE',
      provider_event_id: `reconciliation:${payout.provider_bank_payout_id}:${observed}`,
      event_type: 'payout.retrieved',
      provider_destination_id: payout.provider_destination_id,
      provider_bank_payout_id: payout.provider_bank_payout_id,
      payout_id: payout.id,
      tailor_profile_id: payout.tailor_profile_id,
      amount: providerPayout.amount,
      currency: providerPayout.currency.toUpperCase(),
      status: observed,
      arrival_at: providerPayout.arrival_date ? new Date(providerPayout.arrival_date * 1000).toISOString() : null,
      failure_code: providerPayout.failure_code ?? null,
      failure_message: providerPayout.failure_message ?? null,
      payload: { source: FN, provider_payout_id: providerPayout.id },
      occurred_at: nowIso,
      processed_at: nowIso,
    }, { onConflict: 'provider,provider_event_id' })
    await resolveOpsIssueByDedupeKey(supabase, issueKey, {
      payout_id: payout.id,
      provider_bank_payout_id: payout.provider_bank_payout_id,
      terminal_status: observed,
      reconciliation_source: FN,
    })
    await Sentry.captureMessage('Stripe stale settlement reached a terminal provider state', {
      level: observed === 'PAID' ? 'info' : 'error',
      tags: { function: FN, provider: 'STRIPE', bank_settlement_status: observed },
      extra: { payout_id: payout.id, order_id: payout.order_id, provider_bank_payout_id: payout.provider_bank_payout_id },
    })
    return { stale: true, reconciled: true }
  }

  const existing = await supabase.from('ops_issues').select('id').eq('dedupe_key', issueKey).maybeSingle()
  await createOrRefreshOpsIssue(supabase, {
    issueType: 'PAYOUT_FAILED',
    severity: waitingHours >= 72 ? 'CRITICAL' : 'HIGH',
    source: FN,
    actorRole: 'SYSTEM',
    orderId: payout.order_id,
    tailorProfileId: payout.tailor_profile_id,
    provider: 'STRIPE',
    relatedEntityType: 'payout',
    relatedEntityId: payout.id,
    title: 'Stripe bank settlement is overdue',
    description: `The connected-account transfer succeeded, but Stripe has not reported a terminal bank outcome after ${waitingHours} hours.`,
    recommendedAction: 'Open the exact Stripe bank payout, verify its provider status and destination health, then retry or remediate only through the reviewed payout workflow.',
    dedupeKey: issueKey,
    notifyOps: waitingHours >= 72,
    metadata: {
      payout_id: payout.id,
      provider_bank_payout_id: payout.provider_bank_payout_id,
      bank_settlement_status: observed,
      waiting_hours: waitingHours,
    },
  })
  if (!(existing.data as { id?: string } | null)?.id) {
    await Sentry.captureMessage('Stripe bank settlement became stale', {
      level: waitingHours >= 72 ? 'error' : 'warning',
      tags: { function: FN, provider: 'STRIPE', failure_class: 'stale_bank_settlement' },
      extra: { payout_id: payout.id, order_id: payout.order_id, provider_bank_payout_id: payout.provider_bank_payout_id, waiting_hours: waitingHours },
    })
  }
  const { data: profile } = await supabase.from('tailor_profiles').select('user_id').eq('id', payout.tailor_profile_id).maybeSingle()
  const tailorUserId = (profile as { user_id?: string | null } | null)?.user_id ?? null
  if (tailorUserId) {
    const body = 'Your released Stripe earnings have not reached a final bank status yet. Drapeon is checking the provider record; open Earnings for the latest status.'
    await enqueuePushJob(supabase, { userId: tailorUserId, orderId: payout.order_id, source: FN, idempotencyKey: `stripe-settlement-stale:${payout.id}:push`, priority: 8, notification: { title: 'Bank payout is taking longer', body, preferenceKey: 'paymentReleased', data: { url: '/earnings', payoutId: payout.id } } })
    await enqueueBackgroundJob(supabase, {
      eventType: 'STRIPE_SETTLEMENT_STALE', aggregateType: 'PAYOUT', aggregateId: payout.id,
      actorId: tailorUserId, actorRole: 'TAILOR', orderId: payout.order_id,
      idempotencyKey: `stripe-settlement-stale:${payout.id}:email`, jobType: 'SEND_ACCOUNT_EVENT_EMAIL', priority: 8,
      payload: {
        userId: tailorUserId,
        subject: 'Your bank payout is taking longer than expected',
        eyebrow: 'Payout update', headline: 'Bank payout update', body,
        ctaLabel: 'View earnings', webPath: '/account/earnings', appUrl: 'drape://earnings',
        details: [{ label: 'Provider', value: 'Stripe' }, { label: 'Status', value: 'Bank confirmation pending' }],
      },
    })
  }
  return { stale: true, reconciled: false }
}

async function reconcileBachsTrancheClaims(supabase: SupabaseClient) {
  const { data: claims, error } = await supabase.from('payout_claims')
    .select('id,source_kind,source_id,order_id,tailor_profile_id,provider,provider_destination_id,currency,amount,route_version,earning_policy_version,tailor_terms_version,provider_idempotency_key,status,provider_transfer_id,payout_id,payout_ledger_transaction_id')
    .eq('provider', 'BACHS')
    .eq('source_kind', 'SETTLEMENT_TRANCHE')
    .in('status', ['RESERVED', 'PROVIDER_UNKNOWN', 'PROVIDER_PENDING', 'TRANSFERRED'])
    .order('updated_at', { ascending: true })
    .limit(100)
  if (error) throw error
  let checked = 0
  let confirmed = 0
  let pending = 0
  let blocked = 0
  for (const raw of (claims ?? []) as BachsTrancheClaimRow[]) {
    checked += 1
    try {
      let reservation
      if (raw.status === 'RESERVED') {
        const { data: tranche, error: trancheError } = await supabase.from('order_settlement_tranches')
          .select('money_desk_request_id,orders:orders!inner(payment_route_version,tailor_terms_version_snapshot,payout_destination_id)')
          .eq('id', raw.source_id).maybeSingle()
        if (trancheError || !tranche?.money_desk_request_id) throw trancheError ?? new Error('Reserved tranche lacks its approved Money Desk request')
        const order = Array.isArray(tranche.orders) ? tranche.orders[0] : tranche.orders
        if (!order?.payment_route_version || !order.tailor_terms_version_snapshot || !order.payout_destination_id) {
          throw new Error('Reserved tranche lacks its accepted route snapshot')
        }
        reservation = await reserveSettlementTranchePayout(supabase, {
          trancheId: raw.source_id,
          tailorProfileId: raw.tailor_profile_id,
          moneyDeskRequestId: tranche.money_desk_request_id,
          provider: 'BACHS',
          providerDestinationId: raw.provider_destination_id,
          routeVersion: String(order.payment_route_version),
          tailorTermsVersion: order.tailor_terms_version_snapshot,
        })
        if (reservation.source_payment_changed) {
          await createOrRefreshOpsIssue(supabase, {
            issueType: 'PAYOUT_FAILED', severity: 'HIGH', source: FN, actorRole: 'SYSTEM',
            orderId: raw.order_id, provider: 'BACHS', relatedEntityType: 'PAYOUT_CLAIM',
            relatedEntityId: raw.id,
            title: 'Reserved Bachs tranche needs payment review',
            description: 'The source payment changed before a provider attempt was durably started. No new transfer was sent.',
            recommendedAction: 'Review the refund/dispute state and source payment before authorizing any payout action.',
            dedupeKey: `bachs-tranche-source-changed:${raw.source_id}`,
            persistWhenRoutineDisabled: true,
            metadata: { claim_id: raw.id, tranche_id: raw.source_id, payout_id: raw.payout_id },
          })
          blocked += 1
          continue
        }
      }
      const result = await reconcileBachsTrancheClaim(supabase, raw, reservation)
      if (result.kind === 'CONFIRMED') {
        confirmed += 1
        await resolveOpsIssueByDedupeKey(supabase, `bachs-tranche-pending:${raw.source_id}`, {
          outcome: 'CONFIRMED_PAID', payoutId: raw.payout_id, providerReference: result.transferId,
        })
        const { data: tranche, error: trancheError } = await supabase.from('order_settlement_tranches')
          .select('money_desk_request_id,order_settlement_plans!inner(customer_id,tailor_id)')
          .eq('id', raw.source_id).maybeSingle()
        if (trancheError) throw trancheError
        const plan = Array.isArray(tranche?.order_settlement_plans)
          ? tranche.order_settlement_plans[0] : tranche?.order_settlement_plans
        if (tranche?.money_desk_request_id) {
          const { data: attempt, error: attemptError } = await supabase.from('money_desk_execution_attempts')
            .select('id,status').eq('request_id', tranche.money_desk_request_id)
            .eq('status', 'PROCESSING').order('started_at', { ascending: false }).limit(1).maybeSingle()
          if (attemptError) throw attemptError
          if (attempt?.id) {
            const { error: completeError } = await supabase.rpc('complete_money_desk_execution', {
              p_attempt_id: attempt.id, p_status: 'SUCCEEDED',
              p_provider_reference: result.transferId,
              p_failure_code: null, p_failure_summary: null,
            })
            if (completeError) throw completeError
          }
        }
        if (plan?.tailor_id) {
          const eventSuffix = `tailor:${raw.source_id}`
          await enqueuePushJob(supabase, { userId: plan.tailor_id, orderId: raw.order_id, source: FN, idempotencyKey: `settlement-released:${eventSuffix}`, priority: 9, notification: { title: 'Earnings released', body: 'Drapeon transferred this verified milestone to your Bachs balance. Bank withdrawal status is tracked separately.', preferenceKey: 'paymentReleased', data: { orderId: raw.order_id, settlementTrancheId: raw.source_id }, communication: { category: 'PAYOUT', purpose: 'TRANSACTIONAL', severity: 'NOTICE', mandatory: true, inApp: true, destinationKey: 'ORDER_DETAIL', destinationParams: { orderId: raw.order_id }, deduplicationKey: `settlement-released:${eventSuffix}` } } })
          await enqueueOrderEventEmailJob(supabase, { recipientUserId: plan.tailor_id, audience: 'TAILOR', order: { id: raw.order_id }, subject: 'Drapeon released an earnings milestone', headline: 'Earnings released', body: 'The reviewed milestone is now in your Bachs balance. Bank withdrawals are tracked separately in Earnings.', ctaLabel: 'View order', source: FN, priority: 9, idempotencyKey: `settlement-released:${eventSuffix}` })
        }
        if (plan?.customer_id) {
          const eventSuffix = `customer:${raw.source_id}`
          await enqueuePushJob(supabase, { userId: plan.customer_id, orderId: raw.order_id, source: FN, idempotencyKey: `settlement-released:${eventSuffix}`, priority: 7, notification: { title: 'Payment protection updated', body: 'A verified order milestone was released to the tailor. Remaining stages stay protected.', preferenceKey: 'paymentReleased', data: { orderId: raw.order_id, settlementTrancheId: raw.source_id }, communication: { category: 'PAYOUT', purpose: 'TRANSACTIONAL', severity: 'NOTICE', mandatory: true, inApp: true, destinationKey: 'ORDER_DETAIL', destinationParams: { orderId: raw.order_id }, deduplicationKey: `settlement-released:${eventSuffix}` } } })
          await enqueueOrderEventEmailJob(supabase, { recipientUserId: plan.customer_id, audience: 'CUSTOMER', order: { id: raw.order_id }, subject: 'Your order payment protection was updated', headline: 'Verified milestone released', body: 'Drapeon released one verified milestone to the tailor. Any later settlement stages remain protected under the order timeline.', ctaLabel: 'View order', source: FN, priority: 7, idempotencyKey: `settlement-released:${eventSuffix}` })
        }
      } else if (result.kind === 'PENDING') {
        pending += 1
        const existing = await supabase.from('ops_issues').select('id').eq('dedupe_key', `bachs-tranche-pending:${raw.source_id}`).maybeSingle()
        await createOrRefreshOpsIssue(supabase, {
          issueType: 'SYSTEM_ALERT', severity: 'HIGH', source: FN, actorRole: 'SYSTEM',
          orderId: raw.order_id, provider: 'BACHS', relatedEntityType: 'PAYOUT_CLAIM',
          relatedEntityId: raw.id, title: 'Bachs tranche transfer is awaiting confirmation',
          description: 'The transfer is still pending. Drapeon is retrieving the same provider reference and will not create another transfer.',
          recommendedAction: 'Check the exact Bachs transfer status and keep the payout claim open until Bachs reports paid.',
          dedupeKey: `bachs-tranche-pending:${raw.source_id}`, notifyOps: !existing.data?.id,
          persistWhenRoutineDisabled: true,
          metadata: { claim_id: raw.id, payout_id: raw.payout_id, reason: result.reason },
        })
      } else {
        blocked += 1
      }
    } catch (error) {
      blocked += 1
      await createOrRefreshOpsIssue(supabase, {
        issueType: 'PAYOUT_FAILED', severity: 'HIGH', source: FN, actorRole: 'SYSTEM',
        orderId: raw.order_id, provider: 'BACHS', relatedEntityType: 'PAYOUT_CLAIM',
        relatedEntityId: raw.id, title: 'Bachs tranche transfer needs reconciliation',
        description: 'Drapeon could not verify the exact Bachs transfer. The payout claim remains reserved and will not be resent.',
        recommendedAction: 'Check Bachs by the saved transfer ID, then reconcile the claim and ledger before taking action.',
        dedupeKey: `bachs-tranche-reconcile:${raw.source_id}`, persistWhenRoutineDisabled: true,
        metadata: { claim_id: raw.id, payout_id: raw.payout_id, error: error instanceof Error ? error.message : String(error) },
      })
    }
  }
  return { checked, confirmed, pending, blocked }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const unauthorized = await authorizeCronRequest(req, FN, cors)
    if (unauthorized) return unauthorized
    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    const body = await req.json().catch(() => ({})) as { orderId?: unknown }
    const orderId = typeof body.orderId === 'string' && UUID_PATTERN.test(body.orderId) ? body.orderId : null
    if (body.orderId != null && !orderId) return json({ ok: false, error: 'A valid orderId is required.' }, 400, cors)
    let plansQuery = supabase.from('order_settlement_plans').select('id,order_id,tailor_id,customer_id,currency,status').in('status', ['ACTIVE','FROZEN'])
    if (orderId) plansQuery = plansQuery.eq('order_id', orderId)
    const { data: plans, error } = await plansQuery.limit(orderId ? 1 : 500)
    if (error) throw error
    let eligible = 0
    for (const plan of plans ?? []) {
      const { error: refreshError } = await supabase.rpc('refresh_order_settlement', { p_order_id: plan.order_id })
      if (refreshError) { log('error', FN, 'refresh_failed', { order_id: plan.order_id, error: refreshError.message }); continue }
      const { data: tranches } = await supabase.from('order_settlement_tranches').select('id,code,amount,currency,status,eligible_at').eq('plan_id', plan.id).in('status', ['ELIGIBLE','RELEASE_REQUESTED'])
      for (const tranche of tranches ?? []) {
        eligible += 1
        const waitingHours = tranche.eligible_at ? Math.max(0, Math.floor((Date.now() - Date.parse(tranche.eligible_at)) / 3_600_000)) : 0
        await createOrRefreshOpsIssue(supabase, {
          issueType: 'SYSTEM_ALERT', severity: waitingHours >= 24 ? 'CRITICAL' : waitingHours >= 4 ? 'HIGH' : 'MEDIUM', source: FN, actorRole: 'SYSTEM', orderId: plan.order_id,
          userId: plan.tailor_id, title: waitingHours >= 4 ? 'Settlement release overdue' : 'Settlement tranche ready',
          description: `${tranche.code} is eligible for a reviewed release. It has waited ${waitingHours} hour${waitingHours === 1 ? '' : 's'}.`,
          recommendedAction: 'Open Money Desk, verify the evidence and open-review gate, then prepare this tranche for independent approval.',
          dedupeKey: `settlement-eligible:${tranche.id}`,
          metadata: { settlement_tranche_id: tranche.id, tranche_code: tranche.code, amount: tranche.amount, currency: tranche.currency, eligible_at: tranche.eligible_at, waiting_hours: waitingHours },
        })
        await enqueuePushJob(supabase, {
          userId: plan.tailor_id,
          orderId: plan.order_id,
          source: FN,
          idempotencyKey: `settlement-eligible:${tranche.id}`,
          priority: 8,
          notification: {
            title: 'Earnings milestone verified',
            body: 'This order has an earnings tranche ready for Drapeon release review.',
            preferenceKey: 'paymentReleased',
            data: { orderId: plan.order_id, settlementTrancheId: tranche.id, url: '/earnings' },
            communication: {
              category: 'PAYOUT',
              purpose: 'TRANSACTIONAL',
              severity: waitingHours >= 24 ? 'WARNING' : 'NOTICE',
              mandatory: true,
              inApp: true,
              destinationKey: 'ORDER_DETAIL',
              destinationParams: { orderId: plan.order_id, settlementTrancheId: tranche.id },
              deduplicationKey: `settlement-eligible:${tranche.id}`,
            },
          },
        })
        await enqueueOrderEventEmailJob(supabase, { recipientUserId: plan.tailor_id, audience: 'TAILOR', order: { id: plan.order_id }, subject: 'An earnings milestone is ready for review', headline: 'Settlement progress', body: 'Drapeon verified a handoff milestone. The eligible amount is now queued for controlled release review; remaining funds stay protected.', ctaLabel: 'View order', source: FN, priority: 8, idempotencyKey: `settlement-eligible:${tranche.id}` })
      }
    }
    let stripePayoutQuery = supabase.from('payouts')
      .select('id,order_id,tailor_profile_id,amount,currency,status,provider_destination_id,provider_bank_payout_id,bank_settlement_status,bank_settlement_expected_at,initiated_at')
      .eq('provider', 'STRIPE')
      .in('status', ['PROCESSING'])
      .in('bank_settlement_status', ['PENDING', 'IN_TRANSIT', 'UNKNOWN'])
    if (orderId) stripePayoutQuery = stripePayoutQuery.eq('order_id', orderId)
    const { data: stripePayouts, error: stripePayoutError } = await stripePayoutQuery.limit(orderId ? 10 : 500)
    if (stripePayoutError) throw stripePayoutError
    let staleStripe = 0
    let reconciledStripe = 0
    for (const payout of (stripePayouts ?? []) as PendingStripeSettlement[]) {
      const result = await reconcileStaleStripeSettlement(supabase, payout)
      if (result.stale) staleStripe += 1
      if (result.reconciled) reconciledStripe += 1
    }
    const bachsTransfers = orderId ? { checked: 0, confirmed: 0, pending: 0, blocked: 0 } : await reconcileBachsTrancheClaims(supabase)
    await audit(supabase, { event: 'settlement.monitor_completed', actor_role: 'SYSTEM', order_id: orderId, payload: { function: FN, scope: orderId ? 'ORDER' : 'SCHEDULED_BATCH', plans: plans?.length ?? 0, eligible, stale_stripe: staleStripe, reconciled_stripe: reconciledStripe, bachs_transfers: bachsTransfers } })
    return json({ ok: true, orderId, plans: plans?.length ?? 0, eligible, staleStripe, reconciledStripe, bachsTransfers }, 200, cors)
  } catch (error) {
    await Sentry.captureMessage(error instanceof Error ? error.message : String(error), { level: 'error', tags: { function: FN } })
    log('error', FN, 'failed', { error: error instanceof Error ? error.message : String(error) })
    return json({ ok: false, error: 'Settlement monitor failed.' }, 500, cors)
  }
})
