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
import {
  reconcileRouteTrancheClaim,
  type RouteTrancheClaimRow,
} from '../_shared/reconcile-route-tranche-claim.ts'
import { reserveSettlementTranchePayout } from '../_shared/claimed-tranche-payout.ts'
import { getBachsClient } from '../_shared/bachs.ts'
import { getBachsPayment } from '../_shared/bachs-operations.ts'
import { assessBachsPaymentSettlement } from '../_shared/bachs-payment-settlement.ts'
import {
  buildBachsExpectedTransfers,
  type BachsExpectedTransfer,
  type BachsRecordedWithdrawal,
  reconcileBachsConnectedAccountBalance,
} from '../_shared/bachs-account-reconciliation.ts'
import {
  assessBachsTransferWatchdog,
  shouldNotifyBachsTransferWatchdog,
} from '../_shared/bachs-transfer-watchdog.ts'

const FN = 'monitor-settlements'
const json = (body: Record<string, unknown>, status: number, cors: HeadersInit) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const BACHS_ACCOUNT_RECONCILIATION_BATCH_SIZE = 10
const BACHS_ACCOUNT_RECONCILIATION_ROTATION_MS = 15 * 60 * 1000
const BACHS_INTERNAL_RECONCILIATION_MAX_RECORDS = 500
const BACHS_PAYMENT_SETTLEMENT_CHECK_BATCH_SIZE = 10

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
    case 'paid':
      return 'PAID'
    case 'failed':
      return 'FAILED'
    case 'canceled':
      return 'CANCELED'
    case 'in_transit':
      return 'IN_TRANSIT'
    default:
      return 'PENDING'
  }
}

async function reconcileStaleStripeSettlement(
  supabase: SupabaseClient,
  payout: PendingStripeSettlement
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
        tags: {
          function: FN,
          provider: 'STRIPE',
          failure_class: 'provider_retrieval',
        },
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
    const { error: updateError } = await supabase
      .from('payouts')
      .update({
        status: terminal,
        bank_settlement_status: observed,
        provider_transfer_status: observed === 'PAID' ? 'PAID_TO_BANK' : 'FAILED',
        bank_settlement_expected_at: providerPayout.arrival_date
          ? new Date(providerPayout.arrival_date * 1000).toISOString()
          : payout.bank_settlement_expected_at,
        bank_settlement_completed_at: observed === 'PAID' ? nowIso : null,
        bank_settlement_failed_at: observed === 'PAID' ? null : nowIso,
        bank_settlement_failure_code:
          observed === 'PAID' ? null : (providerPayout.failure_code ?? observed),
        completed_at: observed === 'PAID' ? nowIso : null,
        failed_at: observed === 'PAID' ? null : nowIso,
        blocked_reason: observed === 'PAID' ? null : `STRIPE_BANK_PAYOUT_${observed}`,
        processed_at: nowIso,
      })
      .eq('id', payout.id)
    if (updateError) throw updateError
    await supabase.from('provider_payout_events').upsert(
      {
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
        arrival_at: providerPayout.arrival_date
          ? new Date(providerPayout.arrival_date * 1000).toISOString()
          : null,
        failure_code: providerPayout.failure_code ?? null,
        failure_message: providerPayout.failure_message ?? null,
        payload: { source: FN, provider_payout_id: providerPayout.id },
        occurred_at: nowIso,
        processed_at: nowIso,
      },
      { onConflict: 'provider,provider_event_id' }
    )
    await resolveOpsIssueByDedupeKey(supabase, issueKey, {
      payout_id: payout.id,
      provider_bank_payout_id: payout.provider_bank_payout_id,
      terminal_status: observed,
      reconciliation_source: FN,
    })
    await Sentry.captureMessage('Stripe stale settlement reached a terminal provider state', {
      level: observed === 'PAID' ? 'info' : 'error',
      tags: {
        function: FN,
        provider: 'STRIPE',
        bank_settlement_status: observed,
      },
      extra: {
        payout_id: payout.id,
        order_id: payout.order_id,
        provider_bank_payout_id: payout.provider_bank_payout_id,
      },
    })
    return { stale: true, reconciled: true }
  }

  const existing = await supabase
    .from('ops_issues')
    .select('id')
    .eq('dedupe_key', issueKey)
    .maybeSingle()
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
    recommendedAction:
      'Open the exact Stripe bank payout, verify its provider status and destination health, then retry or remediate only through the reviewed payout workflow.',
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
      tags: {
        function: FN,
        provider: 'STRIPE',
        failure_class: 'stale_bank_settlement',
      },
      extra: {
        payout_id: payout.id,
        order_id: payout.order_id,
        provider_bank_payout_id: payout.provider_bank_payout_id,
        waiting_hours: waitingHours,
      },
    })
  }
  const { data: profile } = await supabase
    .from('tailor_profiles')
    .select('user_id')
    .eq('id', payout.tailor_profile_id)
    .maybeSingle()
  const tailorUserId = (profile as { user_id?: string | null } | null)?.user_id ?? null
  if (tailorUserId) {
    const body =
      'Your released Stripe earnings have not reached a final bank status yet. Drapeon is checking the provider record; open Earnings for the latest status.'
    await enqueuePushJob(supabase, {
      userId: tailorUserId,
      orderId: payout.order_id,
      source: FN,
      idempotencyKey: `stripe-settlement-stale:${payout.id}:push`,
      priority: 8,
      notification: {
        title: 'Bank payout is taking longer',
        body,
        preferenceKey: 'paymentReleased',
        data: { url: '/earnings', payoutId: payout.id },
      },
    })
    await enqueueBackgroundJob(supabase, {
      eventType: 'STRIPE_SETTLEMENT_STALE',
      aggregateType: 'PAYOUT',
      aggregateId: payout.id,
      actorId: tailorUserId,
      actorRole: 'TAILOR',
      orderId: payout.order_id,
      idempotencyKey: `stripe-settlement-stale:${payout.id}:email`,
      jobType: 'SEND_ACCOUNT_EVENT_EMAIL',
      priority: 8,
      payload: {
        userId: tailorUserId,
        subject: 'Your bank payout is taking longer than expected',
        eyebrow: 'Payout update',
        headline: 'Bank payout update',
        body,
        ctaLabel: 'View earnings',
        webPath: '/account/earnings',
        appUrl: 'drape://earnings',
        details: [
          { label: 'Provider', value: 'Stripe' },
          {
            label: 'Status',
            value: 'Bank confirmation pending',
          },
        ],
      },
    })
  }
  return { stale: true, reconciled: false }
}

async function reconcileRouteTrancheClaims(supabase: SupabaseClient) {
  const { data: claims, error } = await supabase
    .from('payout_claims')
    .select(
      'id,source_kind,source_id,order_id,tailor_profile_id,provider,provider_destination_id,currency,amount,route_version,earning_policy_version,tailor_terms_version,provider_idempotency_key,status,provider_transfer_id,payout_id,payout_ledger_transaction_id,orders!inner(accepted_route_snapshot_at,payment_route_id,charge_provider_snapshot)'
    )
    .in('provider', ['BACHS', 'STRIPE'])
    .eq('source_kind', 'SETTLEMENT_TRANCHE')
    .in('status', ['RESERVED', 'PROVIDER_UNKNOWN', 'PROVIDER_PENDING', 'TRANSFERRED'])
    .order('updated_at', { ascending: true })
    .limit(100)
  if (error) throw error
  const rawClaimRows = (claims ?? []).map((claim) => {
    const row = claim as Record<string, unknown>
    const joinedOrder = row.orders
    const order = Array.isArray(joinedOrder)
      ? (joinedOrder[0] as Record<string, unknown> | undefined)
      : (joinedOrder as Record<string, unknown> | null)
    return {
      ...row,
      accepted_route_snapshot_at:
        typeof order?.accepted_route_snapshot_at === 'string'
          ? order.accepted_route_snapshot_at
          : null,
      payment_route_id: typeof order?.payment_route_id === 'string' ? order.payment_route_id : null,
      charge_provider_snapshot:
        typeof order?.charge_provider_snapshot === 'string' ? order.charge_provider_snapshot : null,
    } as unknown as RouteTrancheClaimRow
  })
  // Legacy/QA claims without an accepted route snapshot belong to their historical
  // payout path. Never let the route monitor create a fresh transfer for them.
  const claimRows = rawClaimRows.filter((row) => row.accepted_route_snapshot_at !== null)
  const skippedNonSnapshot = rawClaimRows.length - claimRows.length
  const operationByClaim = new Map<
    string,
    {
      created_at: string | null
      operation_number: number
      money_desk_request_id: string | null
      provider_destination_id: string
    }
  >()
  if (claimRows.length) {
    const { data: operations, error: operationError } = await supabase
      .from('payout_provider_operations')
      .select('claim_id,operation_number,created_at,money_desk_request_id,provider_destination_id')
      .in(
        'claim_id',
        claimRows.map((claim) => claim.id)
      )
      .order('operation_number', { ascending: false })
      .order('created_at', { ascending: false })
    if (operationError) throw operationError
    for (const operation of (operations ?? []) as Array<{
      claim_id: string
      operation_number: number
      created_at: string | null
      money_desk_request_id: string | null
      provider_destination_id: string
    }>) {
      if (!operationByClaim.has(operation.claim_id)) {
        operationByClaim.set(operation.claim_id, operation)
      }
    }
  }
  let checked = 0
  let confirmed = 0
  let pending = 0
  let blocked = 0
  for (const raw of claimRows) {
    checked += 1
    try {
      let reservation
      if (raw.status === 'RESERVED') {
        const { data: tranche, error: trancheError } = await supabase
          .from('order_settlement_tranches')
          .select(
            'money_desk_request_id,orders:orders!inner(payment_route_version,tailor_terms_version_snapshot,payout_destination_id)'
          )
          .eq('id', raw.source_id)
          .maybeSingle()
        if (trancheError || !tranche?.money_desk_request_id) {
          throw trancheError ?? new Error('Reserved tranche lacks its approved Money Desk request')
        }
        const order = Array.isArray(tranche.orders) ? tranche.orders[0] : tranche.orders
        if (
          !order?.payment_route_version ||
          !order.tailor_terms_version_snapshot ||
          !order.payout_destination_id
        ) {
          throw new Error('Reserved tranche lacks its accepted route snapshot')
        }
        const latestOperation = operationByClaim.get(raw.id)
        const snapshotCorrection = Boolean(
          latestOperation &&
          latestOperation.operation_number > 1 &&
          latestOperation.money_desk_request_id
        )
        reservation = await reserveSettlementTranchePayout(supabase, {
          trancheId: raw.source_id,
          tailorProfileId: raw.tailor_profile_id,
          moneyDeskRequestId: snapshotCorrection
            ? latestOperation!.money_desk_request_id!
            : tranche.money_desk_request_id,
          provider: raw.provider as 'BACHS' | 'STRIPE',
          providerDestinationId: snapshotCorrection
            ? latestOperation!.provider_destination_id
            : raw.provider_destination_id,
          routeVersion: String(order.payment_route_version),
          tailorTermsVersion: order.tailor_terms_version_snapshot,
          snapshotCorrection,
        })
        if (reservation.source_payment_changed) {
          await createOrRefreshOpsIssue(supabase, {
            issueType: 'PAYOUT_FAILED',
            severity: 'HIGH',
            source: FN,
            actorRole: 'SYSTEM',
            orderId: raw.order_id,
            provider: raw.provider,
            relatedEntityType: 'PAYOUT_CLAIM',
            relatedEntityId: raw.id,
            title: `Reserved ${
              raw.provider === 'BACHS' ? 'Bachs' : 'Stripe'
            } tranche needs payment review`,
            description:
              'The source payment changed before a provider attempt was durably started. No new transfer was sent.',
            recommendedAction:
              'Review the refund/dispute state and source payment before authorizing any payout action.',
            dedupeKey: `${raw.provider.toLowerCase()}-tranche-source-changed:${raw.source_id}`,
            persistWhenRoutineDisabled: true,
            metadata: {
              claim_id: raw.id,
              tranche_id: raw.source_id,
              payout_id: raw.payout_id,
            },
          })
          blocked += 1
          continue
        }
      }
      const result = await reconcileRouteTrancheClaim(supabase, raw, reservation)
      if (result.kind === 'CONFIRMED') {
        confirmed += 1
        const providerPrefix = `${raw.provider.toLowerCase()}-tranche`
        for (const prefix of [
          `${providerPrefix}-pending`,
          `${providerPrefix}-overdue`,
          `${providerPrefix}-critical`,
          `${providerPrefix}-age-missing`,
        ]) {
          await resolveOpsIssueByDedupeKey(supabase, `${prefix}:${raw.source_id}`, {
            outcome: 'CONFIRMED_PAID',
            payoutId: raw.payout_id,
            providerReference: result.transferId,
          })
        }
        const { data: tranche, error: trancheError } = await supabase
          .from('order_settlement_tranches')
          .select('money_desk_request_id,order_settlement_plans!inner(customer_id,tailor_id)')
          .eq('id', raw.source_id)
          .maybeSingle()
        if (trancheError) throw trancheError
        const plan = Array.isArray(tranche?.order_settlement_plans)
          ? tranche.order_settlement_plans[0]
          : tranche?.order_settlement_plans
        if (tranche?.money_desk_request_id) {
          const { data: attempt, error: attemptError } = await supabase
            .from('money_desk_execution_attempts')
            .select('id,status')
            .eq('request_id', tranche.money_desk_request_id)
            .eq('status', 'PROCESSING')
            .order('started_at', {
              ascending: false,
            })
            .limit(1)
            .maybeSingle()
          if (attemptError) throw attemptError
          if (attempt?.id) {
            const { error: completeError } = await supabase.rpc('complete_money_desk_execution', {
              p_attempt_id: attempt.id,
              p_status: 'SUCCEEDED',
              p_provider_reference: result.transferId,
              p_failure_code: null,
              p_failure_summary: null,
            })
            if (completeError) throw completeError
          }
        }
        if (plan?.tailor_id) {
          const eventSuffix = `tailor:${raw.source_id}`
          const providerName = raw.provider === 'BACHS' ? 'Bachs' : 'Stripe'
          const tailorBody = `The reviewed milestone is now in your ${providerName} balance. Bank withdrawals are tracked separately in Earnings.`
          await enqueuePushJob(supabase, {
            userId: plan.tailor_id,
            orderId: raw.order_id,
            source: FN,
            idempotencyKey: `settlement-released:${eventSuffix}`,
            priority: 9,
            notification: {
              title: 'Earnings released',
              body: `Drapeon transferred this verified milestone to your ${providerName} balance. Bank withdrawal status is tracked separately.`,
              preferenceKey: 'paymentReleased',
              data: {
                orderId: raw.order_id,
                settlementTrancheId: raw.source_id,
              },
              communication: {
                category: 'PAYOUT',
                purpose: 'TRANSACTIONAL',
                severity: 'NOTICE',
                mandatory: true,
                inApp: true,
                destinationKey: 'ORDER_DETAIL',
                destinationParams: { orderId: raw.order_id },
                deduplicationKey: `settlement-released:${eventSuffix}`,
              },
            },
          })
          await enqueueOrderEventEmailJob(supabase, {
            recipientUserId: plan.tailor_id,
            audience: 'TAILOR',
            order: { id: raw.order_id },
            subject: 'Drapeon released an earnings milestone',
            headline: 'Earnings released',
            body: tailorBody,
            ctaLabel: 'View order',
            source: FN,
            priority: 9,
            idempotencyKey: `settlement-released:${eventSuffix}`,
          })
        }
        if (plan?.customer_id) {
          const eventSuffix = `customer:${raw.source_id}`
          await enqueuePushJob(supabase, {
            userId: plan.customer_id,
            orderId: raw.order_id,
            source: FN,
            idempotencyKey: `settlement-released:${eventSuffix}`,
            priority: 7,
            notification: {
              title: 'Payment protection updated',
              body: 'A verified order milestone was released to the tailor. Remaining stages stay protected.',
              preferenceKey: 'paymentReleased',
              data: {
                orderId: raw.order_id,
                settlementTrancheId: raw.source_id,
              },
              communication: {
                category: 'PAYOUT',
                purpose: 'TRANSACTIONAL',
                severity: 'NOTICE',
                mandatory: true,
                inApp: true,
                destinationKey: 'ORDER_DETAIL',
                destinationParams: { orderId: raw.order_id },
                deduplicationKey: `settlement-released:${eventSuffix}`,
              },
            },
          })
          await enqueueOrderEventEmailJob(supabase, {
            recipientUserId: plan.customer_id,
            audience: 'CUSTOMER',
            order: { id: raw.order_id },
            subject: 'Your order payment protection was updated',
            headline: 'Verified milestone released',
            body: 'Drapeon released one verified milestone to the tailor. Any later settlement stages remain protected under the order timeline.',
            ctaLabel: 'View order',
            source: FN,
            priority: 7,
            idempotencyKey: `settlement-released:${eventSuffix}`,
          })
        }
      } else if (result.kind === 'PENDING') {
        pending += 1
        const providerLabel = raw.provider === 'BACHS' ? 'Bachs' : 'Stripe'
        const providerPrefix = `${raw.provider.toLowerCase()}-tranche`
        const watchdog = assessBachsTransferWatchdog({
          operationCreatedAt: operationByClaim.get(raw.id)?.created_at,
        })
        const ageLabel =
          watchdog.ageHours === null ? 'an unknown period' : `${watchdog.ageHours} hours`
        const issueKeys = {
          within: `${providerPrefix}-pending:${raw.source_id}`,
          overdue: `${providerPrefix}-overdue:${raw.source_id}`,
          critical: `${providerPrefix}-critical:${raw.source_id}`,
          ageMissing: `${providerPrefix}-age-missing:${raw.source_id}`,
        }
        const activeIssueKey =
          watchdog.reason === 'PENDING_CRITICAL'
            ? issueKeys.critical
            : watchdog.reason === 'PENDING_OVERDUE'
              ? issueKeys.overdue
              : watchdog.reason === 'OPERATION_AGE_MISSING'
                ? issueKeys.ageMissing
                : issueKeys.within
        const priorIssueKeys =
          watchdog.reason === 'PENDING_CRITICAL'
            ? [issueKeys.within, issueKeys.overdue, issueKeys.ageMissing]
            : watchdog.reason === 'PENDING_OVERDUE'
              ? [issueKeys.within, issueKeys.critical, issueKeys.ageMissing]
              : watchdog.reason === 'OPERATION_AGE_MISSING'
                ? [issueKeys.within, issueKeys.overdue, issueKeys.critical]
                : [issueKeys.overdue, issueKeys.critical, issueKeys.ageMissing]
        for (const priorKey of priorIssueKeys) {
          await resolveOpsIssueByDedupeKey(supabase, priorKey, {
            outcome: 'ESCALATED',
            claimId: raw.id,
            currentWatchdogReason: watchdog.reason,
          })
        }
        const existing = await supabase
          .from('ops_issues')
          .select('id,status,canonical_status')
          .eq('dedupe_key', activeIssueKey)
          .maybeSingle()
        if (existing.error) throw existing.error
        const existingIssue = existing.data as {
          id: string
          status: string | null
          canonical_status: string | null
        } | null
        await createOrRefreshOpsIssue(supabase, {
          issueType: 'SYSTEM_ALERT',
          severity: watchdog.severity,
          source: FN,
          actorRole: 'SYSTEM',
          orderId: raw.order_id,
          provider: raw.provider,
          relatedEntityType: 'PAYOUT_CLAIM',
          relatedEntityId: raw.id,
          title:
            watchdog.reason === 'PENDING_CRITICAL'
              ? `${providerLabel} tranche transfer is critically overdue`
              : `${providerLabel} tranche transfer is awaiting confirmation`,
          description: `The transfer has remained unresolved for ${ageLabel}. Drapeon is retrieving the same provider reference and will not create another transfer.`,
          recommendedAction: `Check the exact ${providerLabel} transfer status and keep the payout claim open until it reports paid. Never create a replacement transfer from this alert.`,
          dedupeKey: activeIssueKey,
          notifyOps: shouldNotifyBachsTransferWatchdog({
            assessment: watchdog,
            existingIssue,
          }),
          persistWhenRoutineDisabled: true,
          metadata: {
            claim_id: raw.id,
            payout_id: raw.payout_id,
            reason: result.reason,
            watchdog_reason: watchdog.reason,
            unresolved_age_hours: watchdog.ageHours,
            operation_created_at: operationByClaim.get(raw.id)?.created_at ?? null,
          },
        })
      } else {
        blocked += 1
      }
    } catch (error) {
      blocked += 1
      await createOrRefreshOpsIssue(supabase, {
        issueType: 'PAYOUT_FAILED',
        severity: 'HIGH',
        source: FN,
        actorRole: 'SYSTEM',
        orderId: raw.order_id,
        provider: raw.provider,
        relatedEntityType: 'PAYOUT_CLAIM',
        relatedEntityId: raw.id,
        title: `${
          raw.provider === 'BACHS' ? 'Bachs' : 'Stripe'
        } tranche transfer needs reconciliation`,
        description: `Drapeon could not verify the exact ${
          raw.provider === 'BACHS' ? 'Bachs' : 'Stripe'
        } transfer. The payout claim remains reserved and will not be resent.`,
        recommendedAction: `Check ${
          raw.provider === 'BACHS' ? 'Bachs' : 'Stripe'
        } by the saved transfer ID, then reconcile the claim and ledger before taking action.`,
        dedupeKey: `${raw.provider.toLowerCase()}-tranche-reconcile:${raw.source_id}`,
        persistWhenRoutineDisabled: true,
        metadata: {
          claim_id: raw.id,
          payout_id: raw.payout_id,
          error: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }
  return { checked, confirmed, pending, blocked, skippedNonSnapshot }
}

async function reconcileBachsTipPayoutClaims(supabase: SupabaseClient) {
  const { data: claims, error } = await supabase.from('tip_money_operation_claims')
    .select('id,tip_id,status,payout_ledger_transaction_id,order_tips!inner(order_id)')
    .eq('provider', 'BACHS')
    .eq('operation_kind', 'PAYOUT')
    .in('status', ['RESERVED', 'PROVIDER_UNKNOWN', 'PROVIDER_PENDING', 'SUCCEEDED'])
    .order('updated_at', { ascending: true })
    .limit(100)
  if (error) throw error
  let checked = 0
  let finalized = 0
  let pending = 0
  let errors = 0
  const serviceRoleKey = getServiceRoleKey()
  for (const raw of (claims ?? []) as Array<Record<string, unknown>>) {
    if (raw.status === 'SUCCEEDED' && raw.payout_ledger_transaction_id) continue
    checked += 1
    const tip = Array.isArray(raw.order_tips)
      ? raw.order_tips[0] as Record<string, unknown> | undefined
      : raw.order_tips as Record<string, unknown> | null
    const tipId = typeof raw.tip_id === 'string' ? raw.tip_id : null
    const orderId = typeof tip?.order_id === 'string' ? tip.order_id : null
    if (!tipId || !orderId) {
      errors += 1
      continue
    }
    const { data, error: invokeError } = await supabase.functions.invoke('release-order-tip', {
      body: { tipId },
      headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey },
    })
    const response = data && typeof data === 'object' ? data as Record<string, unknown> : {}
    if (invokeError || response.ok !== true) {
      errors += 1
      await createOrRefreshOpsIssue(supabase, {
        issueType: 'PAYOUT_FAILED',
        severity: 'HIGH',
        source: FN,
        actorRole: 'SYSTEM',
        orderId,
        provider: 'BACHS',
        relatedEntityType: 'ORDER_TIP',
        relatedEntityId: tipId,
        title: 'Bachs tip transfer needs reconciliation',
        description: 'The scheduled payout monitor could not retrieve or finalize the existing Bachs tip transfer.',
        recommendedAction: 'Inspect the immutable tip claim and provider transfer status; do not create another transfer.',
        dedupeKey: `bachs-tip-payout-reconcile:${raw.id}`,
        persistWhenRoutineDisabled: true,
        metadata: { tip_id: tipId, claim_id: raw.id, error: invokeError?.message ?? response.error ?? null },
      })
      continue
    }
    if (response.pending === true) pending += 1
    else finalized += 1
  }
  return { checked, finalized, pending, errors }
}

/**
 * Reconcile the actual Bachs processing fee only after its payment endpoint
 * reports settled fee evidence. Each due row is claimed in a short DB call;
 * the provider GET occurs after that transaction has committed.
 */
async function reconcileBachsPaymentSettlements(
  supabase: SupabaseClient,
  orderId: string | null,
) {
  let query = supabase.from('provider_payment_settlement_checks')
    .select('payment_id,order_id,next_check_at,check_count')
    .eq('status', 'PENDING')
    .lte('next_check_at', new Date().toISOString())
    .order('next_check_at', { ascending: true })
    .limit(BACHS_PAYMENT_SETTLEMENT_CHECK_BATCH_SIZE)
  if (orderId) query = query.eq('order_id', orderId)
  const { data: checks, error } = await query
  if (error) throw error

  let checked = 0
  let settled = 0
  let pending = 0
  let review = 0
  let errors = 0
  let client: ReturnType<typeof getBachsClient> | null = null

  for (const raw of checks ?? []) {
    const { data: claimData, error: claimError } = await supabase.rpc(
      'claim_bachs_payment_settlement_check',
      { p_payment_id: raw.payment_id },
    )
    if (claimError) {
      errors += 1
      continue
    }
    const claim = claimData && typeof claimData === 'object'
      ? claimData as Record<string, unknown>
      : {}
    if (claim.outcome !== 'CHECK') continue
    checked += 1

    let assessment
    try {
      client ??= getBachsClient()
      const providerPayment = await getBachsPayment(client, String(claim.provider_charge_id))
      assessment = assessBachsPaymentSettlement({
        attempt: {
          id: String(claim.payment_id),
          provider: 'BACHS',
          provider_payment_id: String(claim.provider_checkout_id),
          provider_charge_id: String(claim.provider_charge_id),
          idempotency_key: String(claim.provider_reference),
          currency: String(claim.currency),
          amount: Number(claim.gross_amount),
        },
        payment: providerPayment,
        settlementEvidence: {
          providerEventId: typeof claim.provider_event_id === 'string' ? claim.provider_event_id : null,
          settlementAmountMinor: Number.isSafeInteger(claim.settlement_amount)
            ? Number(claim.settlement_amount)
            : null,
          settlementCurrency: typeof claim.settlement_currency === 'string'
            ? claim.settlement_currency
            : null,
          processingFeeAmountMinor: Number.isSafeInteger(claim.event_processing_fee_amount)
            ? Number(claim.event_processing_fee_amount)
            : null,
          processingFeeCurrency: typeof claim.event_processing_fee_currency === 'string'
            ? claim.event_processing_fee_currency
            : null,
        },
      })
    } catch {
      const { error: recordError } = await supabase.rpc(
        'record_bachs_payment_settlement_check_with_net',
        {
          p_payment_id: claim.payment_id,
          p_outcome: 'PENDING',
        },
      )
      if (recordError) errors += 1
      else pending += 1
      if (Number(claim.check_count) >= 7) {
        await createOrRefreshOpsIssue(supabase, {
          issueType: 'SYSTEM_ALERT',
          severity: 'HIGH',
          source: FN,
          actorRole: 'SYSTEM',
          orderId: String(claim.order_id),
          relatedEntityType: 'order_payment',
          relatedEntityId: String(claim.payment_id),
          queueKey: 'money-desk',
          title: 'Bachs settlement fee is still unverified',
          description: 'Bachs has not returned final, identity-matched settlement fee evidence for this succeeded payment. The accepted total and payment remain unchanged.',
          recommendedAction: 'Check Bachs settlement status and API read access. Keep the route disabled until actual fee and fee payer evidence reconcile.',
          dedupeKey: `bachs-payment-settlement:${claim.payment_id}`,
          persistWhenRoutineDisabled: true,
          metadata: { payment_id: claim.payment_id, check_count: claim.check_count, reason: 'provider_read_or_fee_not_final' },
        })
      }
      continue
    }

    const recordArgs: Record<string, unknown> = {
      p_payment_id: claim.payment_id,
      p_outcome: assessment.kind,
      ...(assessment.kind === 'REVIEW' ? { p_reason: assessment.reason } : {}),
      ...(assessment.kind === 'SETTLED' ? {
        p_fee_amount: assessment.feeMinor,
        p_fee_currency: assessment.feeCurrency,
        p_fee_paid_by: assessment.feePaidBy,
        p_provider_updated_at: assessment.providerUpdatedAt,
        p_provider_completed_at: assessment.providerCompletedAt,
      } : {}),
    }
    const { data: recordData, error: recordError } = await supabase.rpc(
      'record_bachs_payment_settlement_check_with_net',
      recordArgs,
    )
    if (recordError) {
      errors += 1
      await createOrRefreshOpsIssue(supabase, {
        issueType: 'SYSTEM_ALERT',
        severity: 'HIGH',
        source: FN,
        actorRole: 'SYSTEM',
        orderId: String(claim.order_id),
        relatedEntityType: 'order_payment',
        relatedEntityId: String(claim.payment_id),
        queueKey: 'money-desk',
        title: 'Bachs settlement fee could not be recorded',
        description: 'Final Bachs fee evidence was read but could not be committed to the settlement record and commercial ledger together.',
        recommendedAction: 'Inspect the linked payment attempt, Bachs fee evidence, and provider-fee ledger claim before any route is enabled.',
        dedupeKey: `bachs-payment-settlement:${claim.payment_id}`,
        persistWhenRoutineDisabled: true,
        metadata: { payment_id: claim.payment_id, error: recordError.message },
      })
      continue
    }
    const result = recordData && typeof recordData === 'object'
      ? recordData as Record<string, unknown>
      : {}
    if (assessment.kind === 'PENDING') {
      pending += 1
      if (Number(claim.check_count) >= 7) {
        await createOrRefreshOpsIssue(supabase, {
          issueType: 'SYSTEM_ALERT',
          severity: 'HIGH',
          source: FN,
          actorRole: 'SYSTEM',
          orderId: String(claim.order_id),
          relatedEntityType: 'order_payment',
          relatedEntityId: String(claim.payment_id),
          queueKey: 'money-desk',
          title: 'Bachs settlement fee is still unverified',
          description: 'Bachs still has not returned final, identity-matched settlement fee evidence for this succeeded payment. The accepted total and payment remain unchanged.',
          recommendedAction: 'Check Bachs settlement status and API read access. Keep the route disabled until the signed settlement net, actual fee and fee payer evidence reconcile.',
          dedupeKey: `bachs-payment-settlement:${claim.payment_id}`,
          persistWhenRoutineDisabled: true,
          metadata: {
            payment_id: claim.payment_id,
            check_count: claim.check_count,
            reason: assessment.reason,
          },
        })
      }
      continue
    }
    if (assessment.kind === 'REVIEW' || result.outcome === 'REVIEW' || result.outcome === 'SETTLED_CONFLICT') {
      review += 1
      const reason = assessment.kind === 'REVIEW'
        ? assessment.reason
        : typeof result.reason === 'string'
        ? result.reason
        : 'settlement_evidence_conflicts_with_saved_receipt'
      await createOrRefreshOpsIssue(supabase, {
        issueType: 'PAYMENT_BLOCKED',
        severity: 'HIGH',
        source: FN,
        actorRole: 'SYSTEM',
        orderId: String(claim.order_id),
        relatedEntityType: 'order_payment',
        relatedEntityId: String(claim.payment_id),
        queueKey: 'money-desk',
        title: 'Bachs payment settlement requires review',
        description: 'The Bachs settlement response conflicts with the immutable payment attempt or previously recorded fee evidence. No payment amount, payout, or route was changed.',
        recommendedAction: 'Compare the exact Bachs charge, checkout, amount, currency, fee and fee-payer response with the saved attempt before resolving this case.',
        dedupeKey: `bachs-payment-settlement:${claim.payment_id}`,
        persistWhenRoutineDisabled: true,
        metadata: { payment_id: claim.payment_id, reason },
      })
      continue
    }
    if (result.outcome === 'SETTLED' || result.outcome === 'ALREADY_SETTLED') {
      settled += 1
      await resolveOpsIssueByDedupeKey(supabase, `bachs-payment-settlement:${claim.payment_id}`, {
        outcome: 'SETTLED',
        payment_id: claim.payment_id,
        settlement_amount: assessment.settlementMinor,
        settlement_currency: assessment.settlementCurrency,
        fee_amount: assessment.feeMinor,
        fee_currency: assessment.feeCurrency,
        fee_paid_by: assessment.feePaidBy,
        reconciled_at: new Date().toISOString(),
      })
    } else {
      errors += 1
    }
  }

  return { due: checks?.length ?? 0, checked, settled, pending, review, errors }
}

/**
 * Reconcile connected-account balances from provider movement history. The
 * account list rotates in bounded batches on the existing 15-minute monitor;
 * no destination is marked as a payment route and no money state is changed.
 */
async function reconcileBachsConnectedAccounts(supabase: SupabaseClient) {
  const countResponse = await supabase
    .from('payout_destinations')
    .select('id', { count: 'exact', head: true })
    .eq('provider', 'BACHS')
  if (countResponse.error) throw countResponse.error
  const destinationCount = countResponse.count ?? 0
  if (destinationCount === 0) {
    return {
      destinationCount: 0,
      checked: 0,
      matched: 0,
      mismatched: 0,
      incomplete: 0,
    }
  }

  const pageCount = Math.ceil(destinationCount / BACHS_ACCOUNT_RECONCILIATION_BATCH_SIZE)
  const pageIndex = Math.floor(Date.now() / BACHS_ACCOUNT_RECONCILIATION_ROTATION_MS) % pageCount
  const from = pageIndex * BACHS_ACCOUNT_RECONCILIATION_BATCH_SIZE
  const { data: destinations, error } = await supabase
    .from('payout_destinations')
    .select('id,provider_account_ref')
    .eq('provider', 'BACHS')
    .order('id', { ascending: true })
    .range(from, from + BACHS_ACCOUNT_RECONCILIATION_BATCH_SIZE - 1)
  if (error) throw error

  let client: ReturnType<typeof getBachsClient> | null = null
  let checked = 0
  let matched = 0
  let mismatched = 0
  let incomplete = 0
  for (const destination of destinations ?? []) {
    checked += 1
    const dedupeKey = `bachs-account-balance:${destination.id}`
    let result
    try {
      const local = await loadBachsInternalMovementRecords(
        supabase,
        destination.provider_account_ref
      )
      if ('incomplete' in local) {
        result = { status: 'INCOMPLETE' as const, reason: local.incomplete }
      } else {
        client ??= getBachsClient()
        result = await reconcileBachsConnectedAccountBalance({
          client,
          accountId: destination.provider_account_ref,
          expectedTransfers: local.expectedTransfers,
          recordedWithdrawals: local.recordedWithdrawals,
        })
      }
    } catch {
      result = {
        status: 'INCOMPLETE' as const,
        reason: 'account_reconciliation_read_failed',
      }
    }

    if (result.status === 'MATCHED') {
      matched += 1
      await resolveOpsIssueByDedupeKey(supabase, dedupeKey, {
        outcome: 'MATCHED',
        checked_currencies: result.checkedCurrencies,
        reconciled_at: new Date().toISOString(),
      })
      continue
    }

    if (result.status === 'MISMATCH') mismatched += 1
    else incomplete += 1
    const isMismatch = result.status === 'MISMATCH'
    const issueMetadata =
      result.status === 'MISMATCH'
        ? {
            reconciliation_status: result.status,
            balance_differences: result.differences,
            transfer_discrepancies: result.transferDiscrepancies,
            withdrawal_discrepancies: result.withdrawalDiscrepancies,
          }
        : {
            reconciliation_status: result.status,
            incomplete_reason: result.reason,
          }
    await createOrRefreshOpsIssue(supabase, {
      issueType: isMismatch ? 'PAYOUT_FAILED' : 'SYSTEM_ALERT',
      severity: 'HIGH',
      source: FN,
      actorRole: 'SYSTEM',
      provider: 'BACHS',
      relatedEntityType: 'payout_destination',
      relatedEntityId: destination.id,
      queueKey: 'money-desk',
      title: isMismatch
        ? 'Bachs connected-account balance does not reconcile'
        : 'Bachs connected-account reconciliation is incomplete',
      description: isMismatch
        ? 'Bachs balance or movement history differs from Drapeon-confirmed payout claims and account-level withdrawal receipts. No payout or ledger state was changed.'
        : 'Drapeon could not obtain a complete, identity-verified reconciliation of Bachs movements, Drapeon payout claims, and withdrawal receipts. No payout or ledger state was changed.',
      recommendedAction: isMismatch
        ? 'Compare the account-level Bachs transfers and withdrawals with Drapeon payout claims, payout ledger links, and signed withdrawal events. Resolve the discrepancy before enabling a route or approving another payout.'
        : 'Check the Bachs account scope, API read permissions, Drapeon claim/ledger links, and movement-history completeness. Keep the route disabled until reconciliation succeeds.',
      dedupeKey,
      persistWhenRoutineDisabled: true,
      metadata: { ...issueMetadata, checked_at: new Date().toISOString() },
    })
  }
  return { destinationCount, checked, matched, mismatched, incomplete }
}

/** Load Drapeon's source ledger beside provider movements; no provider account
 * identifier or customer details are copied into the Ops case metadata. */
async function loadBachsInternalMovementRecords(
  supabase: SupabaseClient,
  accountId: string
): Promise<
  | {
      expectedTransfers: BachsExpectedTransfer[]
      recordedWithdrawals: BachsRecordedWithdrawal[]
    }
  | { incomplete: string }
> {
  const [claimsResponse, operationsResponse, withdrawalsResponse] = await Promise.all([
    supabase
      .from('payout_claims')
      .select(
        'id,provider,provider_destination_id,currency,amount,status,provider_transfer_id,payout_ledger_transaction_id'
      )
      .eq('provider', 'BACHS')
      .eq('provider_destination_id', accountId)
      .limit(BACHS_INTERNAL_RECONCILIATION_MAX_RECORDS + 1),
    supabase
      .from('payout_provider_operations')
      .select(
        'id,claim_id,operation_number,provider,provider_destination_id,currency,amount,status,provider_transfer_id,reviewed_correction_id,money_desk_request_id,final_failure_reference,funds_return_reference,funds_return_confirmed_at'
      )
      .eq('provider', 'BACHS')
      .eq('provider_destination_id', accountId)
      .limit(BACHS_INTERNAL_RECONCILIATION_MAX_RECORDS + 1),
    supabase
      .from('provider_payout_events')
      .select('provider_bank_payout_id,amount,currency,status,occurred_at,processed_at')
      .eq('provider', 'BACHS')
      .eq('provider_destination_id', accountId)
      .limit(BACHS_INTERNAL_RECONCILIATION_MAX_RECORDS + 1),
  ])
  if (claimsResponse.error || operationsResponse.error || withdrawalsResponse.error) {
    return { incomplete: 'drapeon_ledger_read_failed' }
  }
  const claims = (claimsResponse.data ?? []) as Array<Record<string, unknown>>
  const operations = (operationsResponse.data ?? []) as Array<Record<string, unknown>>
  const withdrawals = (withdrawalsResponse.data ?? []) as Array<Record<string, unknown>>
  if (
    [claims, operations, withdrawals].some(
      (rows) => rows.length > BACHS_INTERNAL_RECONCILIATION_MAX_RECORDS
    )
  ) {
    return { incomplete: 'drapeon_movement_history_exceeds_safe_limit' }
  }

  const claimIds = [
    ...new Set(
      operations.map((row) => row.claim_id).filter((id): id is string => typeof id === 'string')
    ),
  ]
  const knownClaimIds = new Set(
    claims.map((claim) => (typeof claim.id === 'string' ? claim.id : ''))
  )
  const missingClaimIds = claimIds.filter((id) => !knownClaimIds.has(id))
  let relatedClaims: Array<Record<string, unknown>> = []
  if (missingClaimIds.length) {
    const { data, error } = await supabase
      .from('payout_claims')
      .select(
        'id,provider,provider_destination_id,currency,amount,status,provider_transfer_id,payout_ledger_transaction_id'
      )
      .eq('provider', 'BACHS')
      .in('id', missingClaimIds)
      .limit(BACHS_INTERNAL_RECONCILIATION_MAX_RECORDS + 1)
    if (error) return { incomplete: 'drapeon_ledger_read_failed' }
    relatedClaims = (data ?? []) as Array<Record<string, unknown>>
    if (relatedClaims.length > BACHS_INTERNAL_RECONCILIATION_MAX_RECORDS) {
      return { incomplete: 'drapeon_movement_history_exceeds_safe_limit' }
    }
  }
  const allClaims = [...claims, ...relatedClaims]
  let corrections: Array<Record<string, unknown>> = []
  if (claimIds.length) {
    const { data, error } = await supabase
      .from('payout_destination_corrections')
      .select(
        'id,claim_id,operation_number,money_desk_request_id,previous_destination_id,replacement_destination_id,correction_transaction_id'
      )
      .in('claim_id', claimIds)
      .limit(BACHS_INTERNAL_RECONCILIATION_MAX_RECORDS + 1)
    if (error) return { incomplete: 'drapeon_ledger_read_failed' }
    corrections = (data ?? []) as Array<Record<string, unknown>>
    if (corrections.length > BACHS_INTERNAL_RECONCILIATION_MAX_RECORDS) {
      return { incomplete: 'drapeon_movement_history_exceeds_safe_limit' }
    }
  }
  const replacementDestinationIds = [
    ...new Set(
      corrections
        .flatMap((row) => [row.previous_destination_id, row.replacement_destination_id])
        .filter((id): id is string => typeof id === 'string')
    ),
  ]
  let replacementDestinations: Array<Record<string, unknown>> = []
  if (replacementDestinationIds.length) {
    const { data, error } = await supabase
      .from('payout_destinations')
      .select('id,provider,provider_account_ref')
      .in('id', replacementDestinationIds)
      .limit(BACHS_INTERNAL_RECONCILIATION_MAX_RECORDS + 1)
    if (error) return { incomplete: 'drapeon_ledger_read_failed' }
    replacementDestinations = (data ?? []) as Array<Record<string, unknown>>
    if (replacementDestinations.length > BACHS_INTERNAL_RECONCILIATION_MAX_RECORDS) {
      return { incomplete: 'drapeon_movement_history_exceeds_safe_limit' }
    }
  }
  const movementResult = buildBachsExpectedTransfers({
    accountId,
    claims: allClaims,
    operations,
    corrections,
    destinations: replacementDestinations,
  })
  if ('incomplete' in movementResult) return movementResult
  const expectedTransfers = movementResult.expectedTransfers
  const recordedWithdrawals: BachsRecordedWithdrawal[] = []
  for (const event of withdrawals) {
    if (typeof event.provider_bank_payout_id !== 'string') {
      return { incomplete: 'drapeon_withdrawal_identity_missing' }
    }
    recordedWithdrawals.push({
      payoutId: event.provider_bank_payout_id,
      amountMinor: typeof event.amount === 'number' ? event.amount : null,
      currency: typeof event.currency === 'string' ? event.currency : null,
      status: typeof event.status === 'string' ? event.status : null,
      occurredAt: typeof event.occurred_at === 'string' ? event.occurred_at : null,
      processedAt: typeof event.processed_at === 'string' ? event.processed_at : null,
    })
  }
  return { expectedTransfers, recordedWithdrawals }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const unauthorized = await authorizeCronRequest(req, FN, cors)
    if (unauthorized) return unauthorized
    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    const body = (await req.json().catch(() => ({}))) as { orderId?: unknown }
    const orderId =
      typeof body.orderId === 'string' && UUID_PATTERN.test(body.orderId) ? body.orderId : null
    if (body.orderId != null && !orderId) {
      return json({ ok: false, error: 'A valid orderId is required.' }, 400, cors)
    }
    let plansQuery = supabase
      .from('order_settlement_plans')
      .select('id,order_id,tailor_id,customer_id,currency,status')
      .in('status', ['ACTIVE', 'FROZEN'])
    if (orderId) plansQuery = plansQuery.eq('order_id', orderId)
    const { data: plans, error } = await plansQuery.limit(orderId ? 1 : 500)
    if (error) throw error
    let eligible = 0
    for (const plan of plans ?? []) {
      const { error: refreshError } = await supabase.rpc('refresh_order_settlement', {
        p_order_id: plan.order_id,
      })
      if (refreshError) {
        log('error', FN, 'refresh_failed', {
          order_id: plan.order_id,
          error: refreshError.message,
        })
        continue
      }
      const { data: tranches } = await supabase
        .from('order_settlement_tranches')
        .select('id,code,amount,currency,status,eligible_at')
        .eq('plan_id', plan.id)
        .in('status', ['ELIGIBLE', 'RELEASE_REQUESTED'])
      for (const tranche of tranches ?? []) {
        eligible += 1
        const waitingHours = tranche.eligible_at
          ? Math.max(0, Math.floor((Date.now() - Date.parse(tranche.eligible_at)) / 3_600_000))
          : 0
        await createOrRefreshOpsIssue(supabase, {
          issueType: 'SYSTEM_ALERT',
          severity: waitingHours >= 24 ? 'CRITICAL' : waitingHours >= 4 ? 'HIGH' : 'MEDIUM',
          source: FN,
          actorRole: 'SYSTEM',
          orderId: plan.order_id,
          userId: plan.tailor_id,
          title: waitingHours >= 4 ? 'Settlement release overdue' : 'Settlement tranche ready',
          description: `${tranche.code} is eligible for a reviewed release. It has waited ${waitingHours} hour${
            waitingHours === 1 ? '' : 's'
          }.`,
          recommendedAction:
            'Open Money Desk, verify the evidence and open-review gate, then prepare this tranche for independent approval.',
          dedupeKey: `settlement-eligible:${tranche.id}`,
          metadata: {
            settlement_tranche_id: tranche.id,
            tranche_code: tranche.code,
            amount: tranche.amount,
            currency: tranche.currency,
            eligible_at: tranche.eligible_at,
            waiting_hours: waitingHours,
          },
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
            data: {
              orderId: plan.order_id,
              settlementTrancheId: tranche.id,
              url: '/earnings',
            },
            communication: {
              category: 'PAYOUT',
              purpose: 'TRANSACTIONAL',
              severity: waitingHours >= 24 ? 'WARNING' : 'NOTICE',
              mandatory: true,
              inApp: true,
              destinationKey: 'ORDER_DETAIL',
              destinationParams: {
                orderId: plan.order_id,
                settlementTrancheId: tranche.id,
              },
              deduplicationKey: `settlement-eligible:${tranche.id}`,
            },
          },
        })
        await enqueueOrderEventEmailJob(supabase, {
          recipientUserId: plan.tailor_id,
          audience: 'TAILOR',
          order: { id: plan.order_id },
          subject: 'An earnings milestone is ready for review',
          headline: 'Settlement progress',
          body: 'Drapeon verified a handoff milestone. The eligible amount is now queued for controlled release review; remaining funds stay protected.',
          ctaLabel: 'View order',
          source: FN,
          priority: 8,
          idempotencyKey: `settlement-eligible:${tranche.id}`,
        })
      }
    }
    let stripePayoutQuery = supabase
      .from('payouts')
      .select(
        'id,order_id,tailor_profile_id,amount,currency,status,provider_destination_id,provider_bank_payout_id,bank_settlement_status,bank_settlement_expected_at,initiated_at'
      )
      .eq('provider', 'STRIPE')
      .in('status', ['PROCESSING'])
      .in('bank_settlement_status', ['PENDING', 'IN_TRANSIT', 'UNKNOWN'])
    if (orderId) stripePayoutQuery = stripePayoutQuery.eq('order_id', orderId)
    const { data: stripePayouts, error: stripePayoutError } = await stripePayoutQuery.limit(
      orderId ? 10 : 500
    )
    if (stripePayoutError) throw stripePayoutError
    let staleStripe = 0
    let reconciledStripe = 0
    for (const payout of (stripePayouts ?? []) as PendingStripeSettlement[]) {
      const result = await reconcileStaleStripeSettlement(supabase, payout)
      if (result.stale) staleStripe += 1
      if (result.reconciled) reconciledStripe += 1
    }
    const routeTransfers = orderId
      ? {
          checked: 0,
          confirmed: 0,
          pending: 0,
          blocked: 0,
          skippedNonSnapshot: 0,
        }
      : await reconcileRouteTrancheClaims(supabase)
    const bachsAccountReconciliation = orderId
      ? {
          destinationCount: 0,
          checked: 0,
          matched: 0,
          mismatched: 0,
          incomplete: 0,
        }
      : await reconcileBachsConnectedAccounts(supabase)
    const bachsTipPayouts = orderId
      ? { checked: 0, finalized: 0, pending: 0, errors: 0 }
      : await reconcileBachsTipPayoutClaims(supabase)
    const bachsPaymentSettlements = await reconcileBachsPaymentSettlements(
      supabase,
      orderId,
    )
    await audit(supabase, {
      event: 'settlement.monitor_completed',
      actor_role: 'SYSTEM',
      order_id: orderId,
      payload: {
        function: FN,
        scope: orderId ? 'ORDER' : 'SCHEDULED_BATCH',
        plans: plans?.length ?? 0,
        eligible,
        stale_stripe: staleStripe,
        reconciled_stripe: reconciledStripe,
        route_transfers: routeTransfers,
        bachs_account_reconciliation: bachsAccountReconciliation,
        bachs_tip_payouts: bachsTipPayouts,
        bachs_payment_settlements: bachsPaymentSettlements,
      },
    })
    return json(
      {
        ok: true,
        orderId,
        plans: plans?.length ?? 0,
        eligible,
        staleStripe,
        reconciledStripe,
        routeTransfers,
        bachsAccountReconciliation,
        bachsTipPayouts,
        bachsPaymentSettlements,
      },
      200,
      cors
    )
  } catch (error) {
    await Sentry.captureMessage(error instanceof Error ? error.message : String(error), {
      level: 'error',
      tags: { function: FN },
    })
    log('error', FN, 'failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return json({ ok: false, error: 'Settlement monitor failed.' }, 500, cors)
  }
})
