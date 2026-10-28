import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { audit } from './logger.ts'
import { createOrRefreshOpsIssue } from './ops-issues.ts'
import { enqueueOrderEventEmailJob, enqueuePushJob } from './side-effect-jobs.ts'
import { formatTipAmount } from './tip-side-effects.ts'

export type ReleasableTip = {
  id: string
  order_id: string
  customer_id: string
  tailor_id: string
  amount: number
  currency: string
  status: string
  payment_id: string | null
  correlation_id: string
  ledger_transaction_id?: string | null
  payout_id?: string | null
  payout_provider_reference?: string | null
}

export type TipPayoutGate = 'ALLOW' | 'RECONCILE_EXISTING' | 'BLOCK_UNSUPPORTED_BACHS'

/**
 * A blocked provider phase must not start a new transfer. Once a durable claim
 * has advanced beyond RESERVED, however, retries are lookup/finalization only
 * and must remain available so a real provider result cannot be stranded.
 */
export function resolveTipPayoutGate(input: {
  provider: string | null | undefined
  bachsPathReady: boolean
  existingClaimStatus?: string | null
}): TipPayoutGate {
  if (input.provider !== 'BACHS') return 'ALLOW'
  if (input.existingClaimStatus && input.existingClaimStatus !== 'RESERVED') {
    return 'RECONCILE_EXISTING'
  }
  return input.bachsPathReady ? 'ALLOW' : 'BLOCK_UNSUPPORTED_BACHS'
}

export async function persistPayoutLedgerTransaction(
  supabase: SupabaseClient,
  payoutId: string,
  ledgerTransactionId: string,
) {
  const { data: claim, error: claimError } = await supabase.from('payout_claims')
    .select('id,payout_ledger_transaction_id')
    .eq('payout_id', payoutId)
    .maybeSingle()
  if (claimError) throw claimError
  // Legacy payouts have not yet been backfilled into payout_claims. Keep them
  // working, while every claim-backed payout gets a durable, separate pointer.
  if (!claim?.id) return
  if (claim.payout_ledger_transaction_id === ledgerTransactionId) return
  if (claim.payout_ledger_transaction_id) {
    throw new Error('Payout claim already points to a different ledger transaction.')
  }
  const { data: updated, error: updateError } = await supabase.from('payout_claims')
    .update({ payout_ledger_transaction_id: ledgerTransactionId })
    .eq('id', claim.id)
    .is('payout_ledger_transaction_id', null)
    .select('id')
    .maybeSingle()
  if (updateError) throw updateError
  if (!updated?.id) {
    const { data: current, error: readError } = await supabase.from('payout_claims')
      .select('payout_ledger_transaction_id')
      .eq('id', claim.id)
      .maybeSingle()
    if (readError) throw readError
    if (current?.payout_ledger_transaction_id !== ledgerTransactionId) {
      throw new Error('Payout ledger transaction could not be linked to its claim.')
    }
  }
}

export async function persistTipClaimPayoutLedgerTransaction(
  supabase: SupabaseClient,
  claimId: string,
  ledgerTransactionId: string,
) {
  const { data: claim, error: claimError } = await supabase.from('tip_money_operation_claims')
    .select('id,payout_ledger_transaction_id,operation_kind')
    .eq('id', claimId)
    .maybeSingle()
  if (claimError) throw claimError
  if (!claim?.id || claim.operation_kind !== 'PAYOUT') {
    throw new Error('TIP payout claim is missing or has the wrong operation kind.')
  }
  if (claim.payout_ledger_transaction_id === ledgerTransactionId) return
  if (claim.payout_ledger_transaction_id) {
    throw new Error('TIP payout claim already points to a different ledger transaction.')
  }
  const { data: updated, error: updateError } = await supabase.from('tip_money_operation_claims')
    .update({ payout_ledger_transaction_id: ledgerTransactionId })
    .eq('id', claim.id)
    .eq('operation_kind', 'PAYOUT')
    .is('payout_ledger_transaction_id', null)
    .select('id')
    .maybeSingle()
  if (updateError) throw updateError
  if (updated?.id) return
  const { data: current, error: readError } = await supabase.from('tip_money_operation_claims')
    .select('payout_ledger_transaction_id')
    .eq('id', claim.id)
    .maybeSingle()
  if (readError) throw readError
  if (current?.payout_ledger_transaction_id !== ledgerTransactionId) {
    throw new Error('TIP payout ledger transaction could not be linked to its claim.')
  }
}

export async function completeTipPayout(
  supabase: SupabaseClient,
  input: {
    tip: ReleasableTip
    payoutId: string
    provider: 'PAYSTACK' | 'STRIPE' | 'BACHS'
    providerReference: string
    providerResponse: Record<string, unknown>
    claimId?: string | null
  },
) {
  const { tip } = input
  const { data: ledgerId, error: ledgerError } = await supabase.rpc('post_commercial_ledger_transaction', {
    p_idempotency_key: `tip-payout:${tip.id}`,
    p_transaction_kind: 'ADJUSTMENT',
    p_purpose: 'TIP_PAYOUT',
    p_order_id: tip.order_id,
    p_payment_id: tip.payment_id,
    p_policy_version: 'benefits-2026-08-01-v1',
    p_pricing_version: 1,
    p_correlation_id: tip.correlation_id,
    p_provider_reference: input.providerReference,
    p_entries: [
      { accountCode: 'TIP_LIABILITY', accountScope: tip.order_id, direction: 'DEBIT', amount: tip.amount, currency: tip.currency },
      { accountCode: 'TAILOR_RELEASED', accountScope: tip.order_id, direction: 'CREDIT', amount: tip.amount, currency: tip.currency },
    ],
    p_metadata: { tip_id: tip.id, payout_id: input.payoutId },
    p_actor_role: 'SYSTEM',
    p_original_currency: tip.currency,
    p_original_amount: tip.amount,
    p_settlement_currency: tip.currency,
    p_settlement_amount: tip.amount,
  })
  if (ledgerError) throw ledgerError
  if (typeof ledgerId !== 'string' || !ledgerId) throw new Error('Payout ledger transaction was not returned.')

  await persistPayoutLedgerTransaction(supabase, input.payoutId, ledgerId)
  if (input.claimId) {
    await persistTipClaimPayoutLedgerTransaction(supabase, input.claimId, ledgerId)
  }

  const now = new Date().toISOString()
  const { error: payoutUpdateError } = await supabase.from('payouts').update({
    status: input.provider === 'STRIPE' || input.provider === 'BACHS' ? 'PROCESSING' : 'PAID',
    provider_payout_id: input.providerReference,
    provider_transfer_status: input.provider === 'STRIPE' || input.provider === 'BACHS' ? 'AVAILABLE_IN_PROVIDER_BALANCE' : 'PAID_TO_BANK',
    bank_settlement_status: input.provider === 'STRIPE' || input.provider === 'BACHS' ? 'PENDING' : 'PAID',
    bank_settlement_completed_at: input.provider === 'STRIPE' || input.provider === 'BACHS' ? null : now,
    completed_at: input.provider === 'STRIPE' || input.provider === 'BACHS' ? null : now,
    provider_response: input.providerResponse,
  }).eq('id', input.payoutId)
  if (payoutUpdateError) throw payoutUpdateError

  const { data: updatedTip, error: tipError } = await supabase.from('order_tips').update({
    status: 'PAID_OUT',
    payout_id: input.payoutId,
    payout_provider_reference: input.providerReference,
    paid_out_at: now,
    failure_reason: null,
    updated_at: now,
  }).eq('id', tip.id).in('status', ['PAYOUT_PENDING', 'PROCESSING']).select('id').maybeSingle()
  if (tipError) throw tipError

  let alreadyCompletedForThisTransfer = false
  if (!updatedTip?.id && input.claimId) {
    const { data: currentTip, error: currentTipError } = await supabase.from('order_tips')
      .select('status,payout_id,payout_provider_reference')
      .eq('id', tip.id)
      .maybeSingle()
    if (currentTipError) throw currentTipError
    alreadyCompletedForThisTransfer = currentTip?.status === 'PAID_OUT'
      && currentTip.payout_id === input.payoutId
      && currentTip.payout_provider_reference === input.providerReference
  }

  if (updatedTip?.id || alreadyCompletedForThisTransfer) {
    await supabase.from('order_tip_events').insert({
      tip_id: tip.id,
      event_type: 'TIP_PAID_OUT',
      actor_role: 'SYSTEM',
      payload: { payout_id: input.payoutId, provider: input.provider, provider_reference: input.providerReference },
      correlation_id: tip.correlation_id,
    })
    await audit(supabase, {
      event: 'tip.paid_out',
      actor_role: 'SYSTEM',
      order_id: tip.order_id,
      payload: {
        tip_id: tip.id,
        amount: tip.amount,
        currency: tip.currency,
        payout_id: input.payoutId,
        provider: input.provider,
        provider_reference: input.providerReference,
        correlation_id: tip.correlation_id,
      },
    })

    const displayedAmount = formatTipAmount(tip.amount, tip.currency)
    await Promise.all([
      enqueuePushJob(supabase, {
        userId: tip.tailor_id,
        orderId: tip.order_id,
        source: 'tip-payout',
        idempotencyKey: `tip-paid-out:tailor:${tip.id}`,
        priority: 9,
        notification: {
          title: `${displayedAmount} tip released`,
          body: input.provider === 'STRIPE'
            ? 'It is in your Stripe balance; bank arrival is tracked separately.'
            : input.provider === 'BACHS'
              ? 'It is in your Bachs balance; bank withdrawal is tracked separately.'
              : 'Paystack confirmed it was sent to your payout account.',
          preferenceKey: 'paymentReleased',
          data: { orderId: tip.order_id, tipId: tip.id, amount: String(tip.amount), currency: tip.currency },
        },
      }),
      enqueueOrderEventEmailJob(supabase, {
        recipientUserId: tip.tailor_id,
        audience: 'TAILOR',
        order: { id: tip.order_id },
        subject: `Your ${displayedAmount} tip was released`,
        headline: `${displayedAmount} tip released`,
        body: input.provider === 'STRIPE'
          ? `${displayedAmount} is in your Stripe balance. Drapeon will update Earnings when Stripe reports the bank payout outcome.`
          : input.provider === 'BACHS'
            ? `${displayedAmount} is in your Bachs balance. Bank withdrawals are tracked separately in Earnings.`
            : `Paystack confirmed that ${displayedAmount} was sent to your payout account.`,
        ctaLabel: 'View earnings',
        source: 'tip-payout',
        priority: 9,
        idempotencyKey: `tip-paid-out:tailor:${tip.id}`,
      }),
    ])
  }

  return { ledgerTransactionId: ledgerId, existing: !updatedTip?.id }
}

export async function holdTipPayout(
  supabase: SupabaseClient,
  input: { tip: ReleasableTip; payoutId: string | null; failure: string },
) {
  const now = new Date().toISOString()
  if (input.payoutId) {
    await supabase.from('payouts').update({
      status: 'FAILED',
      provider_transfer_status: 'FAILED',
      failed_at: now,
      provider_response: { terminal_outcome: 'FAILED', error: input.failure },
    }).eq('id', input.payoutId)
  }
  await supabase.from('order_tips').update({
    status: 'HELD',
    failure_reason: input.failure,
    updated_at: now,
  }).eq('id', input.tip.id).neq('status', 'PAID_OUT')
  await createOrRefreshOpsIssue(supabase, {
    issueType: 'PAYOUT_FAILED',
    severity: 'CRITICAL',
    source: 'tip-payout',
    actorRole: 'SYSTEM',
    orderId: input.tip.order_id,
    relatedEntityType: 'ORDER_TIP',
    relatedEntityId: input.tip.id,
    title: 'Tip payout failed',
    description: 'A customer tip payout reached a recorded provider failure.',
    recommendedAction: 'Reconcile the provider reference and tip liability before retrying. Do not submit a duplicate transfer.',
    dedupeKey: `tip-payout-failed:${input.tip.id}`,
    metadata: { payout_id: input.payoutId, error: input.failure },
  })
}
