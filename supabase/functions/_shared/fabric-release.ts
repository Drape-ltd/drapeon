import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { normalizeAccountCurrency } from '../../../packages/shared/src/currency-config.ts'
import { createPaystackTransfer } from './paystack.ts'
import { createStripeTransfer, listStripeTransfers } from './stripe.ts'
import {
  fabricTransferIdempotencyKey,
  stripeSourceCharge,
} from './stripe-transfer-safety.ts'
import { handleFabricStripeTransferFailure } from './fabric-transfer-failure.ts'
import { createOrRefreshOpsIssue, resolveOpsIssueByDedupeKey } from './ops-issues.ts'
import { enqueueOrderEventEmailJob, enqueuePushJob } from './side-effect-jobs.ts'
import { Sentry } from './sentry.ts'
import { loadAcceptedOrderPayoutRoute } from './order-payout-destination.ts'
import { acceptedFabricReleaseRoute, resolveOrderPayoutProvider } from '../../../packages/shared/src/order-payout-route.ts'

const SOURCE = 'fabric-release-v2'

export function findFabricTransferMatch<T extends { metadata?: Record<string, string> | null }>(
  transfers: T[],
  candidateId: string,
  orderId: string,
): T | null {
  return transfers.find((row) =>
    row.metadata?.fabric_candidate_id === candidateId &&
    row.metadata?.order_id === orderId
  ) ?? null
}

export async function findStripeFabricTransferAcrossPages(
  input: { destinationAccountId?: string | null; transferGroup: string; candidateId: string; orderId: string },
  listTransfers = listStripeTransfers,
) {
  let startingAfter: string | null = null
  let scanned = 0
  const maxRows = 5_000
  do {
    const page = await listTransfers({
      destinationAccountId: input.destinationAccountId,
      transferGroup: input.transferGroup,
      limit: Math.min(100, maxRows - scanned),
      startingAfter,
    })
    const match = findFabricTransferMatch(page.data, input.candidateId, input.orderId)
    if (match) return match
    scanned += page.data.length
    if (!page.has_more) return null
    if (page.data.length === 0 || scanned >= maxRows) {
      throw new Error('FABRIC_TRANSFER_SEARCH_INCOMPLETE')
    }
    startingAfter = page.data.at(-1)?.id ?? null
    if (!startingAfter) throw new Error('FABRIC_TRANSFER_SEARCH_CURSOR_MISSING')
  } while (true)
}

export function fabricTransferIdentityConflict(input: {
  transfer: { destination?: string | null; amount: number; currency: string; source_transaction?: string | null }
  expectedDestination: string
  expectedAmount: number
  expectedCurrency: string
  expectedSourceTransaction: string
}) {
  return input.transfer.destination !== input.expectedDestination ||
    input.transfer.amount !== input.expectedAmount ||
    input.transfer.currency.toUpperCase() !== input.expectedCurrency.toUpperCase() ||
    input.transfer.source_transaction !== input.expectedSourceTransaction
}

export function resolveFabricReleaseDestination(input: {
  acceptedRoute?: { provider?: string | null; providerAccountRef?: string | null } | null
  provider?: string | null
  stripeAccountId?: string | null
  paystackRecipientCode?: string | null
}) {
  if (input.acceptedRoute) return input.acceptedRoute.providerAccountRef?.trim() || null
  if (input.provider === 'STRIPE') return input.stripeAccountId?.trim() || null
  if (input.provider === 'PAYSTACK') return input.paystackRecipientCode?.trim() || null
  return null
}

export function fabricReconciliationGate(
  provider: string | null,
  ambiguousAt: string | null,
  nowMs = Date.now(),
) {
  if (provider !== 'STRIPE') return 'PROVIDER_SPECIFIC_RECONCILIATION_REQUIRED' as const
  const observedAt = Date.parse(String(ambiguousAt ?? ''))
  if (!Number.isFinite(observedAt) || nowMs - observedAt < 15 * 60 * 1000) {
    return 'VISIBILITY_WINDOW' as const
  }
  return 'READY' as const
}

export function preferredFabricSourcePayment<T>(
  candidatePayment: T | null | undefined,
  initialOrderPayment: T | null | undefined,
) {
  return candidatePayment ?? initialOrderPayment ?? null
}

function releaseReference(candidateId: string, attemptNumber = 1) {
  return fabricTransferIdempotencyKey(candidateId, attemptNumber)
}

export async function enqueueFabricReleaseOutcomeSideEffects(
  supabase: SupabaseClient,
  input: {
    candidateId: string
    outcome: 'SUCCEEDED' | 'FAILED' | 'AMBIGUOUS'
    blockerCode?: string | null
  },
) {
  const candidateResult = await supabase.from('order_fabric_candidates')
    .select('id,order_id,tailor_id,customer_id,component_code,customer_media')
    .eq('id', input.candidateId).single()
  if (candidateResult.error) throw candidateResult.error
  const candidate = candidateResult.data
  const orderResult = await supabase.from('orders')
    .select('id,reference,stage,customer_id,tailor_id')
    .eq('id', candidate.order_id).single()
  if (orderResult.error) throw orderResult.error
  const order = orderResult.data
  const succeeded = input.outcome === 'SUCCEEDED'
  const ambiguous = input.outcome === 'AMBIGUOUS'
  const component = String(candidate.component_code).toLowerCase().replaceAll('_', ' ')
  const title = succeeded ? 'Fabric funds released' : ambiguous ? 'Fabric release needs review' : 'Fabric release could not complete'
  const tailorBody = succeeded
    ? `Buy the approved ${component}, then upload the supplier receipt and acquired-material proof.`
    : ambiguous
      ? `Drapeon is verifying the ${component} provider outcome. Do not submit another release.`
      : `The ${component} release is blocked${input.blockerCode ? `: ${input.blockerCode.toLowerCase().replaceAll('_', ' ')}` : ''}. Follow the recovery step in the order.`
  const customerBody = succeeded
    ? `The exact approved ${component} amount was released. The receipt and final material proof are still required.`
    : ambiguous
      ? `Drapeon is verifying the ${component} provider outcome. You will not be charged or released twice.`
      : `The approved ${component} release did not complete. The order shows the next recovery step.`
  const deepLink = `/orders/${order.id}?section=fabric&candidateId=${candidate.id}`
  const evidenceArtifact = Array.isArray(candidate.customer_media) ? candidate.customer_media[0] : null
  const evidencePath = evidenceArtifact?.mediaType === 'VIDEO'
    ? evidenceArtifact?.posterStoragePath ?? null
    : evidenceArtifact?.displayStoragePath ?? evidenceArtifact?.originalStoragePath ?? null
  const event = `FABRIC_RELEASE_${input.outcome}`
  await Promise.all([
    enqueuePushJob(supabase, { userId: candidate.tailor_id, orderId: order.id, source: SOURCE,
      idempotencyKey: `${event}:tailor:${candidate.id}`, priority: succeeded ? 20 : 10,
      notification: { title, body: tailorBody, data: { destination: 'ORDER', orderId: order.id, candidateId: candidate.id, href: deepLink } } }),
    enqueuePushJob(supabase, { userId: candidate.customer_id, orderId: order.id, source: SOURCE,
      idempotencyKey: `${event}:customer:${candidate.id}`, priority: succeeded ? 20 : 10,
      notification: { title, body: customerBody, data: { destination: 'ORDER', orderId: order.id, candidateId: candidate.id, href: deepLink } } }),
    enqueueOrderEventEmailJob(supabase, { order, recipientUserId: candidate.tailor_id, audience: 'TAILOR', source: SOURCE,
      idempotencyKey: `${event}:tailor:${candidate.id}`, priority: succeeded ? 20 : 10,
      subject: title, headline: title, body: tailorBody, ctaLabel: 'Open fabric task', action: event,
      evidenceImageUrl: evidencePath, evidenceStorageBucket: evidencePath ? 'commercial-evidence' : null }),
    enqueueOrderEventEmailJob(supabase, { order, recipientUserId: candidate.customer_id, audience: 'CUSTOMER', source: SOURCE,
      idempotencyKey: `${event}:customer:${candidate.id}`, priority: succeeded ? 20 : 10,
      subject: title, headline: title, body: customerBody, ctaLabel: 'View fabric status', action: event,
      evidenceImageUrl: evidencePath, evidenceStorageBucket: evidencePath ? 'commercial-evidence' : null }),
  ])
}

export async function processFabricCandidateRelease(
  supabase: SupabaseClient,
  candidateId: string,
  dependencies: {
    createStripeTransfer?: typeof createStripeTransfer
    createOpsIssue?: typeof createOrRefreshOpsIssue
    notifyOutcome?: typeof enqueueFabricReleaseOutcomeSideEffects
    reconcile?: typeof reconcileFabricCandidateRelease
  } = {},
) {
  const createStripe = dependencies.createStripeTransfer ?? createStripeTransfer
  const createOpsIssue = dependencies.createOpsIssue ?? createOrRefreshOpsIssue
  const notifyOutcome = dependencies.notifyOutcome ?? enqueueFabricReleaseOutcomeSideEffects
  const reconcile = dependencies.reconcile ?? reconcileFabricCandidateRelease
  const candidateResult = await supabase.from('order_fabric_candidates')
    .select('id,order_id,tailor_id,customer_id,component_code,supplier_cost_amount,currency,status,provider_status,correlation_id,payout_id,customer_media,provider_attempt_number')
    .eq('id', candidateId).maybeSingle()
  if (candidateResult.error) throw candidateResult.error
  const candidate = candidateResult.data
  if (!candidate) throw new Error('FABRIC_CANDIDATE_NOT_FOUND')
  if (candidate.provider_status === 'SUCCEEDED') return { duplicate: true, candidate }
  if (candidate.provider_status === 'AMBIGUOUS') {
    const reconciliation = await reconcile(supabase, candidate.id)
    if (reconciliation.outcome === 'FAILED') {
      // Keep the same bounded queue job alive. The next run observes the
      // incremented attempt number and therefore uses a fresh Stripe key.
      throw new Error('FABRIC_RETRY_READY')
    }
    return reconciliation
  }
  if (!['RELEASE_QUEUED', 'RELEASE_PROCESSING', 'RELEASE_BLOCKED'].includes(candidate.status)) {
    throw new Error('FABRIC_RELEASE_NOT_READY')
  }

  const [orderResult, profileResult] = await Promise.all([
    supabase.from('orders')
      .select('id,reference,stage,customer_id,tailor_id,accepted_route_snapshot_at,charge_provider_snapshot,charge_currency_snapshot,legal_entity_snapshot,payout_destination_id,tailor_profile_id,tailor_payout_currency_locked,tailor_payout_provider_locked')
      .eq('id', candidate.order_id).single(),
    supabase.from('tailor_profiles')
      .select('id,user_id,payout_account_verified,payout_reverification_required,paystack_recipient_code,stripe_connect_account_id')
      .eq('user_id', candidate.tailor_id).maybeSingle(),
  ])
  if (orderResult.error) throw orderResult.error
  if (profileResult.error) throw profileResult.error
  const order = orderResult.data
  const profile = profileResult.data
  const attemptNumber = Math.max(1, Number(candidate.provider_attempt_number ?? 1))
  let acceptedRoute = null
  let currency = normalizeAccountCurrency(candidate.currency)
  let provider: string | null = null
  let destination: string | null = null
  let snapshotBlocker: string | null = null
  if (order.accepted_route_snapshot_at) {
    try {
      const payoutRoute = await loadAcceptedOrderPayoutRoute(supabase, order)
      acceptedRoute = acceptedFabricReleaseRoute(payoutRoute, currency)
      if (!acceptedRoute) snapshotBlocker = 'ACCEPTED_ORDER_PAYOUT_SNAPSHOT_INCOMPLETE'
      else {
        provider = acceptedRoute.provider
        destination = resolveFabricReleaseDestination({ acceptedRoute })
      }
    } catch (error) {
      snapshotBlocker = error instanceof Error ? error.message : 'ACCEPTED_ORDER_PAYOUT_SNAPSHOT_INVALID'
    }
  } else {
    provider = resolveOrderPayoutProvider(order)
    if (provider && order.tailor_payout_currency_locked && normalizeAccountCurrency(order.tailor_payout_currency_locked) !== currency) {
      snapshotBlocker = 'FABRIC_RELEASE_CURRENCY_MISMATCH'
    }
    destination = resolveFabricReleaseDestination({
      provider,
      stripeAccountId: profile?.stripe_connect_account_id,
      paystackRecipientCode: profile?.paystack_recipient_code,
    })
  }
  const preflightCode = snapshotBlocker
    ?? (!order.accepted_route_snapshot_at && (!profile?.payout_account_verified || profile.payout_reverification_required)
      ? 'TAILOR_PAYOUT_NOT_VERIFIED'
      : !provider || !destination
        ? 'PAYOUT_DESTINATION_MISSING'
        : provider !== 'STRIPE' && provider !== 'PAYSTACK'
          ? 'PAYOUT_PROVIDER_NOT_READY'
          : null)

  if (preflightCode) {
    const blockedOutcome = await supabase.rpc('record_fabric_candidate_release_outcome_v2', {
      p_candidate_id: candidate.id,
      p_payout_id: candidate.payout_id ?? `blocked:${candidate.id}`,
      p_provider: provider ?? 'UNKNOWN',
      p_provider_reference: releaseReference(candidate.id),
      p_outcome: 'FAILED',
      p_provider_response: { code: preflightCode },
    })
    if (blockedOutcome.error) throw blockedOutcome.error
    const preflightIssue = await createOpsIssue(supabase, {
      issueType: 'PAYOUT_BLOCKED', severity: 'HIGH', source: SOURCE,
      actorId: candidate.tailor_id, actorRole: 'TAILOR', orderId: order.id,
      userId: candidate.tailor_id, tailorProfileId: profile?.id ?? null,
      relatedEntityType: 'FABRIC_CANDIDATE', relatedEntityId: candidate.id,
      provider, stage: order.stage, title: 'Fabric-fund release is blocked',
      description: `The exact ${candidate.component_code.toLowerCase()} release could not start: ${preflightCode}.`,
      recommendedAction: 'Restore the verified payout destination, then safely retry this exact candidate release.',
      dedupeKey: `fabric-candidate:release:${candidate.id}`,
      metadata: { candidateId: candidate.id, correlationId: candidate.correlation_id, blockerCode: preflightCode },
    })
    if (!preflightIssue) throw new Error('Fabric release preflight Ops case could not be persisted')
    await notifyOutcome(supabase, {
      candidateId: candidate.id,
      outcome: 'FAILED',
      blockerCode: preflightCode,
    })
    throw new Error(preflightCode)
  }

  const candidatePaymentResult = provider === 'STRIPE'
    ? await supabase.from('order_payments')
      .select('id,provider_response')
      .eq('order_id', order.id)
      .eq('fabric_candidate_id', candidate.id)
      .in('status', ['SUCCEEDED', 'PARTIAL_REFUND'])
      .order('confirmed_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    : { data: null, error: null }
  if (candidatePaymentResult.error) throw candidatePaymentResult.error
  const settledPaymentResult = provider === 'STRIPE' && !candidatePaymentResult.data
    ? await supabase.from('order_payments')
      .select('id,provider_response')
      .eq('order_id', order.id)
      .eq('phase', 'INITIAL_ORDER')
      .in('status', ['SUCCEEDED', 'PARTIAL_REFUND'])
      .order('confirmed_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    : { data: null, error: null }
  if (settledPaymentResult.error) throw settledPaymentResult.error
  const sourcePayment = preferredFabricSourcePayment(candidatePaymentResult.data, settledPaymentResult.data)
  const sourceCharge = provider === 'STRIPE' ? stripeSourceCharge(sourcePayment) : null
  if (provider === 'STRIPE' && !sourceCharge) {
    const blockerCode = 'FABRIC_SOURCE_CHARGE_MISSING'
    const missingSourceOutcome = await supabase.rpc('record_fabric_candidate_release_outcome_v2', {
      p_candidate_id: candidate.id,
      p_payout_id: candidate.payout_id ?? `blocked:${candidate.id}`,
      p_provider: provider,
      p_provider_reference: releaseReference(candidate.id, attemptNumber),
      p_outcome: 'FAILED',
      p_provider_response: { code: blockerCode },
    })
    if (missingSourceOutcome.error) throw missingSourceOutcome.error
    const issue = await createOpsIssue(supabase, {
      issueType: 'PAYOUT_BLOCKED', severity: 'CRITICAL', source: SOURCE,
      actorId: candidate.tailor_id, actorRole: 'SYSTEM', orderId: order.id,
      userId: candidate.tailor_id, tailorProfileId: profile?.id ?? null,
      relatedEntityType: 'FABRIC_CANDIDATE', relatedEntityId: candidate.id,
      provider, stage: order.stage, title: 'Fabric source charge is missing',
      description: 'Drapeon could not bind the approved fabric transfer to the settled order charge.',
      recommendedAction: 'Repair the payment evidence before retrying this fabric release.',
      dedupeKey: `fabric-candidate:release:${candidate.id}`,
      metadata: { candidateId: candidate.id, blockerCode, source_payment_id: sourcePayment?.id ?? null },
    })
    if (!issue) throw new Error('FABRIC_OPS_CASE_PERSISTENCE_FAILED')
    await notifyOutcome(supabase, { candidateId: candidate.id, outcome: 'FAILED', blockerCode })
    return { failed: true, candidateId: candidate.id, blockerCode }
  }

  await supabase.from('order_fabric_candidates').update({ status: 'RELEASE_PROCESSING' }).eq('id', candidate.id)
  let payoutResult = await supabase.from('payouts').select('id,status,provider_payout_id,provider_destination_id,provider_response')
    .eq('fabric_candidate_id', candidate.id)
    .in('status', ['PENDING', 'PROCESSING', 'PAID', 'BLOCKED', 'REVERSED'])
    .maybeSingle()
  if (payoutResult.error) throw payoutResult.error
  let payout = payoutResult.data
  if (!payout) {
    const inserted = await supabase.from('payouts').insert({
      tailor_profile_id: profile!.id, order_id: order.id, fabric_candidate_id: candidate.id,
      amount: candidate.supplier_cost_amount, currency, provider, status: 'PROCESSING', payout_purpose: 'FABRIC_RELEASE',
      provider_payout_id: provider === 'PAYSTACK' ? releaseReference(candidate.id) : null,
      provider_destination_id: destination,
      source_payment_id: sourcePayment?.id ?? null,
      provider_response: {
        source: SOURCE,
        policyVersion: 'fabric-funding-2026-08-21-v2',
        correlationId: candidate.correlation_id,
        intendedDestination: destination,
        sourceTransaction: sourceCharge,
      },
    }).select('id,status,provider_payout_id,provider_destination_id,provider_response').single()
    if (inserted.error) throw inserted.error
    payout = inserted.data
  }

  if (payout.provider_destination_id && payout.provider_destination_id !== destination) {
    const issue = await createOpsIssue(supabase, {
      issueType: 'PAYOUT_BLOCKED', severity: 'CRITICAL', source: SOURCE,
      actorId: candidate.tailor_id, actorRole: 'SYSTEM', orderId: order.id,
      userId: candidate.tailor_id, tailorProfileId: profile!.id,
      relatedEntityType: 'FABRIC_CANDIDATE', relatedEntityId: candidate.id,
      provider, stage: order.stage, title: 'Fabric payout destination conflicts with the approved route',
      description: 'The saved payout destination differs from the destination pinned by the accepted route.',
      recommendedAction: 'Keep the release blocked and reconcile the payout identity through Money Desk.',
      dedupeKey: `fabric-candidate:release:${candidate.id}`,
      metadata: { candidateId: candidate.id, payoutId: payout.id, blockerCode: 'FABRIC_PAYOUT_DESTINATION_CONFLICT' },
    })
    if (!issue) throw new Error('FABRIC_OPS_CASE_PERSISTENCE_FAILED')
    return { outcome: 'BLOCKED' as const, candidateId: candidate.id, payoutId: payout.id, blockerCode: 'FABRIC_PAYOUT_DESTINATION_CONFLICT' }
  }

  const identityUpdate = await supabase.from('payouts').update({
    provider_destination_id: destination,
    source_payment_id: sourcePayment?.id ?? null,
    provider_response: {
      ...(payout.provider_response ?? {}),
      intendedDestination: destination,
      sourceTransaction: sourceCharge,
    },
  }).eq('id', payout.id)
  if (identityUpdate.error) throw identityUpdate.error

  try {
    let providerReference = payout.provider_payout_id || releaseReference(candidate.id)
    let providerResponse: Record<string, unknown>
    let terminal = false
    if (provider === 'PAYSTACK') {
      const transfer = await createPaystackTransfer({
        amount: candidate.supplier_cost_amount, recipientCode: destination!, currency: currency!,
        reason: `Drapeon approved fabric ${order.reference ?? order.id}`,
        reference: releaseReference(candidate.id),
      })
      providerReference = transfer.reference ?? transfer.transfer_code ?? providerReference
      providerResponse = transfer as unknown as Record<string, unknown>
      terminal = String(transfer.status ?? '').toLowerCase() === 'success'
    } else if (provider === 'STRIPE') {
      const transfer = await createStripe({
        amount: candidate.supplier_cost_amount, currency: currency!, destinationAccountId: destination!,
        sourceTransaction: sourceCharge,
        idempotencyKey: releaseReference(candidate.id, attemptNumber), transferGroup: `order:${order.id}`,
        metadata: { order_id: order.id, fabric_candidate_id: candidate.id, payout_id: payout.id },
      })
      providerReference = transfer.id
      providerResponse = transfer as unknown as Record<string, unknown>
      terminal = true
    } else {
      throw new Error('PAYOUT_PROVIDER_NOT_READY')
    }

    const payoutUpdate = await supabase.from('payouts').update({
      provider_payout_id: providerReference, provider_response: providerResponse,
      provider_destination_id: destination,
      provider_transfer_status: terminal ? (provider === 'PAYSTACK' ? 'PAID_TO_BANK' : 'AVAILABLE_IN_PROVIDER_BALANCE') : 'PROCESSING',
      bank_settlement_status: terminal && provider === 'PAYSTACK' ? 'PAID' : 'PENDING',
      status: terminal && provider === 'PAYSTACK' ? 'PAID' : 'PROCESSING',
      completed_at: terminal && provider === 'PAYSTACK' ? new Date().toISOString() : null,
    }).eq('id', payout.id)
    if (payoutUpdate.error) throw payoutUpdate.error

    if (!terminal) return { pending: true, candidateId: candidate.id, payoutId: payout.id, providerReference }
    const released = await supabase.rpc('record_fabric_candidate_release_outcome_v2', {
      p_candidate_id: candidate.id, p_payout_id: payout.id, p_provider: provider,
      p_provider_reference: providerReference, p_outcome: 'SUCCEEDED', p_provider_response: providerResponse,
    })
    if (released.error) throw released.error
    await resolveOpsIssueByDedupeKey(supabase, `fabric-candidate:release:${candidate.id}`, { providerReference })
    await enqueueFabricReleaseOutcomeSideEffects(supabase, { candidateId: candidate.id, outcome: 'SUCCEEDED' })
    return { pending: false, candidate: released.data, payoutId: payout.id, providerReference }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const failure = provider === 'STRIPE'
      ? await handleFabricStripeTransferFailure(error, attemptNumber, {
        recordOutcome: async (record) => {
          const result = await supabase.rpc('record_fabric_candidate_release_outcome_v2', {
            p_candidate_id: candidate.id, p_payout_id: payout.id, p_provider: provider,
            p_provider_reference: payout.provider_payout_id ?? releaseReference(candidate.id, attemptNumber),
            p_outcome: record.outcome,
            p_provider_response: record,
          })
          if (result.error) throw result.error
        },
        updatePayout: async (record) => {
          const result = await supabase.from('payouts').update({
            status: record.outcome === 'FAILED' ? 'FAILED' : 'PROCESSING',
            provider_transfer_status: record.outcome === 'FAILED' ? 'FAILED' : 'PROCESSING',
            blocked_reason: record.outcome === 'FAILED' ? record.code : 'RECONCILIATION_REQUIRED',
            failed_at: record.outcome === 'FAILED' ? new Date().toISOString() : null,
            provider_response: { ...record, source: SOURCE },
          }).eq('id', payout.id)
          if (result.error) throw result.error
        },
        advanceAttempt: async (nextAttempt) => {
          const result = await supabase.from('order_fabric_candidates')
            .update({ provider_attempt_number: nextAttempt }).eq('id', candidate.id)
          if (result.error) throw result.error
        },
        persistOpsIssue: async (record) => Boolean(await createOpsIssue(supabase, {
          issueType: 'PAYOUT_FAILED', severity: 'CRITICAL', source: SOURCE,
          actorId: candidate.tailor_id, actorRole: 'SYSTEM', orderId: order.id, userId: candidate.tailor_id,
          tailorProfileId: profile!.id, relatedEntityType: 'FABRIC_CANDIDATE', relatedEntityId: candidate.id,
          provider, stage: order.stage,
          title: record.outcome === 'FAILED' ? 'Fabric-fund release was rejected' : 'Fabric-fund provider outcome is unresolved',
          description: record.outcome === 'FAILED'
            ? `Stripe rejected the fabric release before creating a transfer (${record.code}).`
            : 'Drapeon could not prove the exact fabric release reached a terminal successful outcome.',
          recommendedAction: record.outcome === 'FAILED'
            ? 'Correct the blocker, then retry through the reviewed fabric release path.'
            : 'Reconcile this provider reference before retrying. Never create a second release blindly.',
          dedupeKey: `fabric-candidate:release:${candidate.id}`,
          metadata: { candidateId: candidate.id, payoutId: payout.id, correlationId: candidate.correlation_id, ...record },
        })),
        notify: (record) => notifyOutcome(supabase, {
          candidateId: candidate.id,
          outcome: record.outcome,
          blockerCode: record.outcome === 'FAILED' ? record.code : null,
        }),
      })
      : { outcome: 'AMBIGUOUS' as const, code: 'PROVIDER_OUTCOME_UNCLEAR' }
    if (provider !== 'STRIPE') {
      const providerOutcome = await supabase.rpc('record_fabric_candidate_release_outcome_v2', {
        p_candidate_id: candidate.id, p_payout_id: payout.id, p_provider: provider,
        p_provider_reference: payout.provider_payout_id ?? releaseReference(candidate.id, attemptNumber),
        p_outcome: 'AMBIGUOUS', p_provider_response: { error: message },
      })
      if (providerOutcome.error) throw providerOutcome.error
      const issue = await createOpsIssue(supabase, {
        issueType: 'PAYOUT_FAILED', severity: 'CRITICAL', source: SOURCE,
        actorId: candidate.tailor_id, actorRole: 'SYSTEM', orderId: order.id, userId: candidate.tailor_id,
        tailorProfileId: profile!.id, relatedEntityType: 'FABRIC_CANDIDATE', relatedEntityId: candidate.id,
        provider, stage: order.stage, title: 'Fabric-fund provider outcome is unresolved',
        description: 'Drapeon could not prove the exact fabric release reached a terminal successful outcome.',
        recommendedAction: 'Reconcile this provider reference before retrying. Never create a second release blindly.',
        dedupeKey: `fabric-candidate:release:${candidate.id}`,
        metadata: { candidateId: candidate.id, payoutId: payout.id, correlationId: candidate.correlation_id, error: message },
      })
      if (!issue) throw new Error('FABRIC_OPS_CASE_PERSISTENCE_FAILED')
      await notifyOutcome(supabase, { candidateId: candidate.id, outcome: 'AMBIGUOUS' })
    }
    await Sentry.captureMessage('Fabric release requires recovery', { level: 'error', tags: { source: SOURCE, provider: provider! }, extra: { orderId: order.id, candidateId: candidate.id, payoutId: payout.id, correlationId: candidate.correlation_id, error: message } })
    if (failure.outcome === 'FAILED') return { failed: true, candidateId: candidate.id, payoutId: payout.id, blockerCode: failure.code }
    throw error
  }
}

export async function reconcileFabricCandidateRelease(
  supabase: SupabaseClient,
  candidateId: string,
  dependencies: {
    listTransfers?: typeof listStripeTransfers
    createOpsIssue?: typeof createOrRefreshOpsIssue
    resolveOpsIssue?: typeof resolveOpsIssueByDedupeKey
    notifyOutcome?: typeof enqueueFabricReleaseOutcomeSideEffects
  } = {},
) {
  const listTransfers = dependencies.listTransfers ?? listStripeTransfers
  const createOpsIssue = dependencies.createOpsIssue ?? createOrRefreshOpsIssue
  const resolveOpsIssue = dependencies.resolveOpsIssue ?? resolveOpsIssueByDedupeKey
  const notifyOutcome = dependencies.notifyOutcome ?? enqueueFabricReleaseOutcomeSideEffects
  const result = await supabase.from('order_fabric_candidates')
    .select('id,order_id,tailor_id,supplier_cost_amount,currency,status,provider,provider_status,provider_response,payout_id,provider_attempt_number,updated_at')
    .eq('id', candidateId).single()
  if (result.error) throw result.error
  const candidate = result.data
  if (candidate.provider_status !== 'AMBIGUOUS') throw new Error('FABRIC_RECONCILIATION_NOT_REQUIRED')
  const providerResponse = candidate.provider_response && typeof candidate.provider_response === 'object'
    ? candidate.provider_response as Record<string, unknown>
    : {}
  const ambiguousAt = typeof providerResponse.recordedAt === 'string'
    ? providerResponse.recordedAt
    : candidate.updated_at
  const reconciliationGate = fabricReconciliationGate(candidate.provider, ambiguousAt)
  if (reconciliationGate === 'PROVIDER_SPECIFIC_RECONCILIATION_REQUIRED') {
    await createOpsIssue(supabase, {
      issueType: 'PAYOUT_FAILED', severity: 'CRITICAL', source: SOURCE, actorRole: 'SYSTEM',
      orderId: candidate.order_id, provider: candidate.provider,
      relatedEntityType: 'FABRIC_CANDIDATE', relatedEntityId: candidate.id,
      title: 'Fabric release needs provider-specific reconciliation',
      description: 'This unresolved fabric release is not a Stripe transfer and was not sent to Stripe lookup.',
      recommendedAction: 'Use the provider-specific verification path and do not create another release.',
      dedupeKey: `fabric-candidate:release:${candidate.id}`,
      persistWhenRoutineDisabled: true,
      metadata: { candidate_id: candidate.id, provider: candidate.provider },
    })
    throw new Error('FABRIC_PROVIDER_RECONCILIATION_REQUIRED')
  }
  if (reconciliationGate === 'VISIBILITY_WINDOW') {
    throw new Error('FABRIC_RECONCILIATION_VISIBILITY_WINDOW')
  }
  const payoutResult = await supabase.from('payouts')
    .select('id,provider_destination_id,provider_payout_id,provider_response,source_payment_id')
    .eq('id', candidate.payout_id).single()
  if (payoutResult.error) throw payoutResult.error
  const [orderResult, profileResult, candidatePaymentResult, initialPaymentResult] = await Promise.all([
    supabase.from('orders').select('id,accepted_route_snapshot_at,charge_provider_snapshot,charge_currency_snapshot,legal_entity_snapshot,payout_destination_id,tailor_profile_id,tailor_payout_currency_locked,tailor_payout_provider_locked,tailor_id').eq('id', candidate.order_id).single(),
    supabase.from('tailor_profiles').select('id,user_id,paystack_recipient_code,stripe_connect_account_id').eq('user_id', candidate.tailor_id).maybeSingle(),
    supabase.from('order_payments').select('id,provider_response').eq('order_id', candidate.order_id).eq('fabric_candidate_id', candidate.id).in('status', ['SUCCEEDED','PARTIAL_REFUND']).order('confirmed_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('order_payments').select('id,provider_response').eq('order_id', candidate.order_id).eq('phase', 'INITIAL_ORDER').in('status', ['SUCCEEDED','PARTIAL_REFUND']).order('confirmed_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  if (orderResult.error) throw orderResult.error
  if (profileResult.error) throw profileResult.error
  if (candidatePaymentResult.error) throw candidatePaymentResult.error
  if (initialPaymentResult.error) throw initialPaymentResult.error
  const order = orderResult.data
  const currency = normalizeAccountCurrency(candidate.currency)
  let expectedRoute = null
  let expectedProvider: string | null = null
  if (order.accepted_route_snapshot_at) {
    const route = await loadAcceptedOrderPayoutRoute(supabase, order)
    expectedRoute = acceptedFabricReleaseRoute(route, currency)
    expectedProvider = expectedRoute?.provider ?? null
  } else {
    expectedProvider = resolveOrderPayoutProvider(order)
  }
  const expectedDestination = resolveFabricReleaseDestination({
    acceptedRoute: expectedRoute,
    provider: expectedProvider,
    stripeAccountId: profileResult.data?.stripe_connect_account_id,
    paystackRecipientCode: profileResult.data?.paystack_recipient_code,
  })
  const savedSourcePaymentResult = payoutResult.data.source_payment_id
    ? await supabase.from('order_payments').select('id,provider_response').eq('id', payoutResult.data.source_payment_id).maybeSingle()
    : { data: null, error: null }
  if (savedSourcePaymentResult.error) throw savedSourcePaymentResult.error
  const payoutEvidence = payoutResult.data.provider_response && typeof payoutResult.data.provider_response === 'object'
    ? payoutResult.data.provider_response as Record<string, unknown>
    : {}
  const savedSourceTransaction = typeof payoutEvidence.sourceTransaction === 'string' && payoutEvidence.sourceTransaction.startsWith('ch_')
    ? payoutEvidence.sourceTransaction
    : null
  const expectedSourcePayment = savedSourcePaymentResult.data ?? preferredFabricSourcePayment(
    candidatePaymentResult.data,
    initialPaymentResult.data,
  )
  const expectedSourceTransaction = savedSourceTransaction ?? stripeSourceCharge(expectedSourcePayment)
  if (!expectedDestination || !currency || !expectedSourceTransaction) {
    const issue = await createOpsIssue(supabase, {
      issueType: 'PAYOUT_FAILED', severity: 'CRITICAL', source: SOURCE, actorRole: 'SYSTEM',
      orderId: candidate.order_id, provider: 'STRIPE', relatedEntityType: 'FABRIC_CANDIDATE', relatedEntityId: candidate.id,
      title: 'Fabric reconciliation identity is incomplete',
      description: 'Drapeon could not reconstruct the approved destination, currency, and source charge for this fabric release.',
      recommendedAction: 'Keep the release blocked and repair the accepted route evidence before recovery.',
      dedupeKey: `fabric-candidate:release:${candidate.id}`, persistWhenRoutineDisabled: true,
      metadata: { candidate_id: candidate.id, code: 'FABRIC_RECONCILIATION_IDENTITY_MISSING' },
    })
    if (!issue) throw new Error('FABRIC_OPS_CASE_PERSISTENCE_FAILED')
    return { outcome: 'BLOCKED' as const, code: 'FABRIC_RECONCILIATION_IDENTITY_MISSING' }
  }
  const transfer = await findStripeFabricTransferAcrossPages({
    destinationAccountId: null,
    transferGroup: `order:${candidate.order_id}`,
    candidateId: candidate.id,
    orderId: candidate.order_id,
  }, listTransfers)
  if (transfer) {
    if (fabricTransferIdentityConflict({ transfer, expectedDestination, expectedAmount: candidate.supplier_cost_amount, expectedCurrency: currency, expectedSourceTransaction })) {
      const issue = await createOpsIssue(supabase, {
        issueType: 'PAYOUT_FAILED', severity: 'CRITICAL', source: SOURCE, actorRole: 'SYSTEM',
        orderId: candidate.order_id, provider: 'STRIPE', relatedEntityType: 'FABRIC_CANDIDATE', relatedEntityId: candidate.id,
        title: 'Fabric transfer identity conflict',
        description: 'Stripe returned a transfer for this candidate whose destination, amount, currency, or source charge differs from the approved release.',
        recommendedAction: 'Do not retry or record success. Reconcile the conflicting transfer through Money Desk.',
        dedupeKey: `fabric-candidate:release:${candidate.id}`, persistWhenRoutineDisabled: true,
        metadata: { candidate_id: candidate.id, transfer_id: transfer.id, code: 'FABRIC_TRANSFER_IDENTITY_CONFLICT' },
      })
      if (!issue) throw new Error('FABRIC_OPS_CASE_PERSISTENCE_FAILED')
      return { outcome: 'BLOCKED' as const, code: 'FABRIC_TRANSFER_IDENTITY_CONFLICT', transfer }
    }
    const recorded = await supabase.rpc('record_fabric_candidate_release_outcome_v2', {
      p_candidate_id: candidate.id,
      p_payout_id: payoutResult.data.id,
      p_provider: 'STRIPE',
      p_provider_reference: transfer.id,
      p_outcome: 'SUCCEEDED',
      p_provider_response: { reconciliation: 'TRANSFER_LOOKUP', transfer },
    })
    if (recorded.error) throw recorded.error
    const payoutUpdate = await supabase.from('payouts').update({
      provider_payout_id: transfer.id,
      provider_transfer_status: 'AVAILABLE_IN_PROVIDER_BALANCE',
      bank_settlement_status: 'PENDING',
      status: 'PROCESSING',
      blocked_reason: null,
      provider_response: {
        ...(payoutResult.data.provider_response ?? {}),
        reconciliation: 'TRANSFER_LOOKUP',
        transfer,
      },
    }).eq('id', payoutResult.data.id)
    if (payoutUpdate.error) throw payoutUpdate.error
    await resolveOpsIssue(supabase, `fabric-candidate:release:${candidate.id}`, {
      outcome: 'SUCCEEDED',
      providerReference: transfer.id,
      reconciliation: 'TRANSFER_LOOKUP',
    })
    await notifyOutcome(supabase, {
      candidateId: candidate.id,
      outcome: 'SUCCEEDED',
    })
    return { outcome: 'SUCCEEDED' as const, transfer, payoutId: payoutResult.data.id }
  }

  const nextAttempt = Math.max(1, Number(candidate.provider_attempt_number ?? 1)) + 1
  const recorded = await supabase.rpc('record_fabric_candidate_release_outcome_v2', {
    p_candidate_id: candidate.id,
    p_payout_id: payoutResult.data.id,
    p_provider: 'STRIPE',
    p_provider_reference: payoutResult.data.provider_payout_id ?? releaseReference(candidate.id, nextAttempt - 1),
    p_outcome: 'FAILED',
    p_provider_response: { reconciliation: 'TRANSFER_LOOKUP', code: 'TRANSFER_NOT_FOUND' },
  })
  if (recorded.error) throw recorded.error
  const payoutUpdate = await supabase.from('payouts').update({
    status: 'FAILED',
    provider_transfer_status: 'FAILED',
    blocked_reason: 'TRANSFER_NOT_FOUND',
    failed_at: new Date().toISOString(),
    provider_response: {
      ...(payoutResult.data.provider_response ?? {}),
      reconciliation: 'TRANSFER_LOOKUP',
      code: 'TRANSFER_NOT_FOUND',
    },
  }).eq('id', payoutResult.data.id)
  if (payoutUpdate.error) throw payoutUpdate.error
  const attemptUpdate = await supabase.from('order_fabric_candidates')
    .update({ provider_attempt_number: nextAttempt })
    .eq('id', candidate.id)
  if (attemptUpdate.error) throw attemptUpdate.error
  const issue = await createOpsIssue(supabase, {
    issueType: 'PAYOUT_FAILED', severity: 'CRITICAL', source: SOURCE, actorRole: 'SYSTEM',
    orderId: candidate.order_id, provider: 'STRIPE',
    relatedEntityType: 'FABRIC_CANDIDATE', relatedEntityId: candidate.id,
    title: 'Fabric transfer was not created',
    description: 'Stripe returned no transfer for the exact order and fabric candidate after the visibility window.',
    recommendedAction: `The bounded queue will start attempt ${nextAttempt} automatically with a new Stripe key. Watch that attempt; do not send a manual transfer.`,
    dedupeKey: `fabric-candidate:release:${candidate.id}`,
    persistWhenRoutineDisabled: true,
    metadata: { candidate_id: candidate.id, payout_id: payoutResult.data.id, code: 'TRANSFER_NOT_FOUND', next_attempt: nextAttempt },
  })
  if (!issue) throw new Error('FABRIC_OPS_CASE_PERSISTENCE_FAILED')
  await notifyOutcome(supabase, {
    candidateId: candidate.id,
    outcome: 'FAILED',
    blockerCode: 'TRANSFER_NOT_FOUND',
  })
  return { outcome: 'FAILED' as const, transfer: null, payoutId: payoutResult.data.id }
}
