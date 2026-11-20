import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { BachsRequestError, bachsBalanceAmountMinor, bachsAmountMinor, getBachsClient, getBachsSandboxPayoutsClient } from '../_shared/bachs.ts'
import {
  assertBachsTransferBalance,
  createBachsPayout,
  createBachsRefundRecoveryTransfer,
  createBachsTransfer,
  getBachsBalances,
  getBachsPayout,
  getBachsTransfer,
  listBachsPayouts,
  listBachsTransfers,
  type BachsPayout,
  type BachsTransfer,
} from '../_shared/bachs-operations.ts'
import {
  bachsWithdrawalFeeReserveMinor,
  planBachsWithdrawalFeeReserve,
  reconcileBachsWithdrawalFee,
} from '../_shared/bachs-withdrawal-fee.ts'
import { authorizeCronRequest } from '../_shared/cron.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl, supabaseProjectEnvironment } from '../_shared/env.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'

const FN = 'bachs-withdrawal-action'
const Body = z.object({
  action: z.enum(['BALANCE', 'START', 'ADVANCE', 'ADVANCE_ALL']),
  claimId: uuid.optional(),
  destinationId: uuid.optional(),
  amountMinor: z.number().int().positive().optional(),
  requestKey: z.string().min(12).max(200).optional(),
})
type Claim = {
  id: string
  request_key: string
  payout_destination_id: string
  provider_account_id: string
  provider_bank_destination_id: string
  currency: string
  withdrawal_amount_minor: number
  reserve_amount_minor: number
  status: string
  topup_transfer_id: string | null
  payout_id: string | null
  sweep_transfer_id: string | null
  actual_fee_minor: number | null
  fee_ledger_transaction_id: string | null
}
const claimColumns = 'id,request_key,payout_destination_id,provider_account_id,provider_bank_destination_id,currency,withdrawal_amount_minor,reserve_amount_minor,status,topup_transfer_id,payout_id,sweep_transfer_id,actual_fee_minor,fee_ledger_transaction_id'
const json = (body: Record<string, unknown>, status: number, cors: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

async function readClaim(db: SupabaseClient, id: string): Promise<Claim | null> {
  const result = await db.from('bachs_withdrawal_fee_claims').select(claimColumns).eq('id', id).maybeSingle()
  if (result.error) throw result.error
  return result.data as Claim | null
}

/** A compare-and-set commit precedes every provider POST. Another invocation cannot POST. */
async function advanceStatus(db: SupabaseClient, claim: Claim, next: string, patch: Record<string, unknown> = {}) {
  const result = await db.from('bachs_withdrawal_fee_claims')
    .update({ ...patch, status: next }).eq('id', claim.id).eq('status', claim.status)
    .select(claimColumns).maybeSingle()
  if (result.error) throw result.error
  return result.data as Claim | null
}

async function bindReceipt(db: SupabaseClient, claim: Claim, patch: Record<string, unknown>) {
  const result = await db.from('bachs_withdrawal_fee_claims')
    .update(patch).eq('id', claim.id).eq('status', claim.status)
    .select(claimColumns).maybeSingle()
  if (result.error) throw result.error
  return result.data as Claim | null
}

function transferIdentity(claim: Claim, phase: 'topup' | 'sweep') {
  return {
    transferGroup: `withdrawal:${claim.id}`,
    metadata: { withdrawal_claim_id: claim.id, withdrawal_phase: phase },
    expectedAmount: phase === 'topup'
      ? claim.reserve_amount_minor
      : claim.reserve_amount_minor - (claim.actual_fee_minor ?? 0),
    destination: phase === 'topup' ? claim.provider_account_id : 'self',
  }
}

function assertTransferIdentity(claim: Claim, phase: 'topup' | 'sweep', transfer: BachsTransfer) {
  const identity = transferIdentity(claim, phase)
  if (transfer.destination !== identity.destination || transfer.currency !== claim.currency ||
    bachsAmountMinor(transfer.amount, claim.currency) !== identity.expectedAmount ||
    transfer.transfer_group !== identity.transferGroup ||
    transfer.metadata?.withdrawal_claim_id !== claim.id ||
    transfer.metadata?.withdrawal_phase !== phase) {
    throw new Error('Stored Bachs withdrawal transfer identity does not match.')
  }
}

function assertPayoutIdentity(claim: Claim, payout: BachsPayout) {
  if (payout.currency !== claim.currency ||
    bachsAmountMinor(payout.amount, claim.currency) !== claim.withdrawal_amount_minor ||
    (payout.destination && payout.destination !== claim.provider_bank_destination_id) ||
    (payout.reference && payout.reference !== `withdrawal-${claim.id}`)) {
    throw new Error('Stored Bachs withdrawal payout identity does not match.')
  }
}

/** Bounded lookup only. An uncertain POST is never repeated after an idempotency TTL. */
async function findTransfer(claim: Claim, phase: 'topup' | 'sweep'): Promise<BachsTransfer | null> {
  const provider = getBachsClient()
  const identity = transferIdentity(claim, phase)
  const matches: BachsTransfer[] = []
  let offset = 0
  let total = Number.POSITIVE_INFINITY
  while (offset < total && offset < 1000) {
    const page = await listBachsTransfers(provider, { limit: 100, offset, connectedAccountId: claim.provider_account_id })
    total = page.total
    for (const transfer of page.items) {
      if (transfer.transfer_group !== identity.transferGroup ||
        transfer.metadata?.withdrawal_claim_id !== claim.id ||
        transfer.metadata?.withdrawal_phase !== phase) continue
      assertTransferIdentity(claim, phase, transfer)
      matches.push(transfer)
    }
    if (page.items.length === 0) break
    offset += page.items.length
  }
  if (total > offset || matches.length > 1) throw new Error('Withdrawal transfer lookup is incomplete or ambiguous.')
  return matches[0] ?? null
}

async function findPayout(claim: Claim): Promise<BachsPayout | null> {
  const provider = getBachsSandboxPayoutsClient()
  const matches: BachsPayout[] = []
  let offset = 0
  let total = Number.POSITIVE_INFINITY
  while (offset < total && offset < 1000) {
    const page = await listBachsPayouts(provider, {
      limit: 100, offset, accountId: claim.provider_account_id, reference: `withdrawal-${claim.id}`,
    })
    total = page.total
    for (const payout of page.items) {
      if (payout.reference !== `withdrawal-${claim.id}`) continue
      assertPayoutIdentity(claim, payout)
      matches.push(payout)
    }
    if (page.items.length === 0) break
    offset += page.items.length
  }
  if (total > offset || matches.length > 1) throw new Error('Withdrawal payout lookup is incomplete or ambiguous.')
  return matches[0] ?? null
}

function availableMinor(balances: Awaited<ReturnType<typeof getBachsBalances>>, currency: string): number {
  const entry = balances.balances.find((item) => item.currency === currency)
  if (!entry) throw new Error('Bachs account does not hold the withdrawal currency.')
  return bachsBalanceAmountMinor(entry.available_balance, currency)
}

async function recordWithdrawalReview(db: SupabaseClient, claimId: string) {
  await createOrRefreshOpsIssue(db, {
    issueType: 'PAYOUT_FAILED', severity: 'HIGH', source: FN,
    actorRole: 'SYSTEM', relatedEntityType: 'BACHS_WITHDRAWAL_FEE_CLAIM',
    relatedEntityId: claimId, provider: 'BACHS',
    title: 'Bachs withdrawal needs review',
    description: 'A provider withdrawal or fee-reserve step could not be reconciled automatically.',
    recommendedAction: 'Retrieve the exact provider transfer and payout references before any replay. Do not create another provider operation.',
    dedupeKey: `bachs-withdrawal-fee:${claimId}`,
    queueKey: 'money-desk', notifyOps: false, notifyOpsPush: false,
    persistWhenRoutineDisabled: true, requireKnownEnvironment: true,
  })
}

async function start(db: SupabaseClient, destinationId: string, amountMinor: number, requestKey: string) {
  const existing = await db.from('bachs_withdrawal_fee_claims').select(claimColumns)
    .eq('request_key', requestKey).maybeSingle()
  if (existing.error) throw existing.error
  if (existing.data) {
    const claim = existing.data as Claim
    if (claim.payout_destination_id !== destinationId || claim.withdrawal_amount_minor !== amountMinor) {
      throw new Error('Withdrawal idempotency key was reused for a different request.')
    }
    return claim
  }
  const result = await db.from('payout_destinations')
    .select('id,provider,country_code,currency,provider_account_ref,provider_destination_ref,transfers_enabled,payouts_enabled,active,first_withdrawal_review_status')
    .eq('id', destinationId).maybeSingle()
  if (result.error) throw result.error
  const destination = result.data
  if (!destination || destination.provider !== 'BACHS' || destination.country_code !== 'NG' ||
    destination.currency !== 'NGN' || !destination.active || !destination.transfers_enabled ||
    !destination.payouts_enabled || destination.first_withdrawal_review_status !== 'CLEARED' ||
    !/^acct_[A-Za-z0-9_-]+$/u.test(destination.provider_account_ref ?? '') ||
    !/^pd_[A-Za-z0-9_-]+$/u.test(destination.provider_destination_ref ?? '')) {
    throw new Error('Bachs withdrawal destination is not ready.')
  }
  const reserve = bachsWithdrawalFeeReserveMinor(Deno.env.get('BACHS_WITHDRAWAL_FEE_RESERVE_MINOR'))
  const balances = await getBachsBalances(getBachsSandboxPayoutsClient(), destination.provider_account_ref)
  planBachsWithdrawalFeeReserve({
    availableMinor: availableMinor(balances, 'NGN'), withdrawalAmountMinor: amountMinor, reserveMinor: reserve,
  })
  const created = await db.from('bachs_withdrawal_fee_claims').insert({
    request_key: requestKey, payout_destination_id: destinationId,
    provider_account_id: destination.provider_account_ref,
    provider_bank_destination_id: destination.provider_destination_ref,
    currency: 'NGN', withdrawal_amount_minor: amountMinor, reserve_amount_minor: reserve,
  }).select(claimColumns).single()
  if (created.error) throw created.error
  return created.data as Claim
}

/** One step per call, so each provider response is committed before the next operation. */
async function advance(db: SupabaseClient, claim: Claim): Promise<Claim> {
  const platform = getBachsClient()
  const payoutProvider = getBachsSandboxPayoutsClient()
  if (claim.status === 'RESERVED') {
    const balances = await getBachsBalances(payoutProvider)
    assertBachsTransferBalance(balances, { amountMinor: claim.reserve_amount_minor, currency: claim.currency })
    const committed = await advanceStatus(db, claim, 'TOPUP_SUBMITTED')
    if (!committed) return (await readClaim(db, claim.id))!
    const transfer = await createBachsTransfer(platform, {
      destinationAccountId: claim.provider_account_id,
      amountMinor: claim.reserve_amount_minor, currency: claim.currency,
      transferGroup: `withdrawal:${claim.id}`,
      description: 'Drapeon bank withdrawal fee reserve',
      metadata: transferIdentity(claim, 'topup').metadata,
      idempotencyKey: `withdrawal:${claim.id}:fee-reserve:v1`,
    })
    return (await bindReceipt(db, committed, { topup_transfer_id: transfer.id })) ?? committed
  }
  if (claim.status === 'TOPUP_SUBMITTED') {
    const transfer = claim.topup_transfer_id
      ? await getBachsTransfer(platform, claim.topup_transfer_id)
      : await findTransfer(claim, 'topup')
    if (!transfer) return claim // lookup-only; never repeat the POST
    assertTransferIdentity(claim, 'topup', transfer)
    const bound = claim.topup_transfer_id ? claim : (await bindReceipt(db, claim, { topup_transfer_id: transfer.id })) ?? claim
    if (transfer.status !== 'paid') return bound
    return (await advanceStatus(db, bound, 'TOPUP_PAID')) ?? bound
  }
  if (claim.status === 'TOPUP_PAID') {
    const balances = await getBachsBalances(payoutProvider, claim.provider_account_id)
    if (availableMinor(balances, claim.currency) !== claim.withdrawal_amount_minor + claim.reserve_amount_minor) {
      return (await advanceStatus(db, claim, 'REVIEW', { review_reason: 'CONNECTED_BALANCE_CHANGED_BEFORE_PAYOUT' })) ?? claim
    }
    const committed = await advanceStatus(db, claim, 'PAYOUT_SUBMITTED')
    if (!committed) return (await readClaim(db, claim.id))!
    const payout = await createBachsPayout(payoutProvider, {
      accountId: claim.provider_account_id,
      destinationId: claim.provider_bank_destination_id,
      amountMinor: claim.withdrawal_amount_minor, currency: claim.currency,
      reference: `withdrawal-${claim.id}`,
      idempotencyKey: `withdrawal:${claim.id}:payout:v1`,
    })
    return (await bindReceipt(db, committed, { payout_id: payout.id })) ?? committed
  }
  if (claim.status === 'PAYOUT_SUBMITTED') {
    const payout = claim.payout_id
      ? await getBachsPayout(payoutProvider, { accountId: claim.provider_account_id, payoutId: claim.payout_id })
      : await findPayout(claim)
    if (!payout) return claim
    assertPayoutIdentity(claim, payout)
    const bound = claim.payout_id ? claim : (await bindReceipt(db, claim, { payout_id: payout.id })) ?? claim
    if (payout.status === 'failed') return (await advanceStatus(db, bound, 'REVIEW', { review_reason: 'PAYOUT_FAILED' })) ?? bound
    return (await advanceStatus(db, bound, 'FEE_PENDING')) ?? bound
  }
  if (claim.status === 'FEE_PENDING') {
    if (!claim.payout_id) throw new Error('Withdrawal payout ID is missing.')
    const payout = await getBachsPayout(payoutProvider, { accountId: claim.provider_account_id, payoutId: claim.payout_id })
    assertPayoutIdentity(claim, payout)
    if (payout.status === 'failed') return (await advanceStatus(db, claim, 'REVIEW', { review_reason: 'PAYOUT_FAILED' })) ?? claim
    if (payout.status !== 'completed') return claim // first-payout review can remain pending
    let fee: ReturnType<typeof reconcileBachsWithdrawalFee>
    try {
      fee = reconcileBachsWithdrawalFee({
        payoutId: payout.id, payoutAmount: payout.amount, payoutCurrency: payout.currency,
        expectedAmountMinor: claim.withdrawal_amount_minor, fee: payout.fee,
        reserveMinor: claim.reserve_amount_minor,
      })
    } catch {
      return (await advanceStatus(db, claim, 'REVIEW', { review_reason: 'PAYOUT_FEE_OUTSIDE_RESERVE' })) ?? claim
    }
    if (fee.state === 'PENDING_FEE') return claim
    const totalDebited = payout.total_debited === null ? null : bachsAmountMinor(payout.total_debited, claim.currency)
    if (payout.source_currency?.toUpperCase() !== claim.currency ||
      totalDebited !== claim.withdrawal_amount_minor + fee.actualFeeMinor) {
      return (await advanceStatus(db, claim, 'REVIEW', { review_reason: 'PAYOUT_DEBIT_MISMATCH' })) ?? claim
    }
    let ledgerId: string | null = null
    if (fee.actualFeeMinor > 0) {
      const ledger = await db.rpc('post_commercial_ledger_transaction', {
        p_idempotency_key: `bachs-withdrawal-fee:${claim.id}`,
        p_transaction_kind: 'ADJUSTMENT', p_purpose: 'BACHS_BANK_WITHDRAWAL_FEE',
        p_order_id: null, p_payment_id: null, p_policy_version: 'bachs-withdrawal-fee-v1',
        p_pricing_version: 1, p_correlation_id: claim.id, p_provider_reference: payout.id,
        p_entries: [
          { accountCode: 'PROVIDER_FEE_EXPENSE', accountScope: 'BACHS', direction: 'DEBIT', amount: fee.actualFeeMinor, currency: claim.currency },
          { accountCode: 'PROVIDER_CLEARING', accountScope: 'BACHS', direction: 'CREDIT', amount: fee.actualFeeMinor, currency: claim.currency },
        ],
        p_metadata: { provider: 'BACHS', payout_id: payout.id, withdrawal_claim_id: claim.id },
        p_provider_fee_amount: fee.actualFeeMinor,
      })
      if (ledger.error) throw ledger.error
      ledgerId = String(ledger.data)
    }
    return (await advanceStatus(db, claim, 'FEE_RECORDED', {
      actual_fee_minor: fee.actualFeeMinor, fee_ledger_transaction_id: ledgerId,
    })) ?? claim
  }
  if (claim.status === 'FEE_RECORDED') {
    if (claim.actual_fee_minor === null) throw new Error('Final Bachs payout fee is missing.')
    const sweepMinor = claim.reserve_amount_minor - claim.actual_fee_minor
    if (sweepMinor === 0) return (await advanceStatus(db, claim, 'COMPLETE')) ?? claim
    const balances = await getBachsBalances(payoutProvider, claim.provider_account_id)
    if (availableMinor(balances, claim.currency) !== sweepMinor) {
      return (await advanceStatus(db, claim, 'REVIEW', { review_reason: 'CONNECTED_BALANCE_CHANGED_BEFORE_SWEEP' })) ?? claim
    }
    const committed = await advanceStatus(db, claim, 'SWEEP_SUBMITTED')
    if (!committed) return (await readClaim(db, claim.id))!
    const transfer = await createBachsRefundRecoveryTransfer(platform, {
      sourceAccountId: claim.provider_account_id, amountMinor: sweepMinor,
      currency: claim.currency, transferGroup: `withdrawal:${claim.id}`,
      description: 'Return unused Drapeon bank withdrawal fee reserve',
      metadata: transferIdentity(claim, 'sweep').metadata,
      idempotencyKey: `withdrawal:${claim.id}:fee-sweep:v1`,
      balanceClient: payoutProvider,
    })
    return (await bindReceipt(db, committed, { sweep_transfer_id: transfer.id })) ?? committed
  }
  if (claim.status === 'SWEEP_SUBMITTED') {
    const transfer = claim.sweep_transfer_id
      ? await getBachsTransfer(platform, claim.sweep_transfer_id)
      : await findTransfer(claim, 'sweep')
    if (!transfer) return claim
    assertTransferIdentity(claim, 'sweep', transfer)
    const bound = claim.sweep_transfer_id ? claim : (await bindReceipt(db, claim, { sweep_transfer_id: transfer.id })) ?? claim
    if (transfer.status !== 'paid') return bound
    return (await advanceStatus(db, bound, 'COMPLETE')) ?? bound
  }
  return claim
}

Deno.serve(async (request) => {
  const cors = getCorsHeaders(request)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const unauthorized = await authorizeCronRequest(request, FN, cors)
  if (unauthorized) return unauthorized
  const parsed = parseBody(Body, await request.json().catch(() => ({})))
  if (!parsed.ok) return json({ ok: false, error: 'INVALID_REQUEST' }, 400, cors)
  let reviewDb: SupabaseClient | null = null
  let reviewClaimId: string | null = parsed.data.claimId ?? null
  try {
    const url = getSupabaseUrl()
    if (supabaseProjectEnvironment(url) !== 'DEVELOPMENT' ||
      Deno.env.get('DRAPE_OPS_ENV')?.trim().toLowerCase() !== 'development') {
      return json({ ok: false, error: 'DEV_ONLY' }, 403, cors)
    }
    const db = createClient(url, getServiceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } })
    reviewDb = db
    const body = parsed.data
    if (body.action === 'BALANCE') {
      if (!body.destinationId) return json({ ok: false, error: 'INVALID_REQUEST' }, 400, cors)
      const result = await db.from('payout_destinations')
        .select('provider,currency,provider_account_ref')
        .eq('id', body.destinationId).maybeSingle()
      if (result.error) throw result.error
      if (result.data?.provider !== 'BACHS' || result.data.currency !== 'NGN' ||
        !/^acct_[A-Za-z0-9_-]+$/u.test(result.data.provider_account_ref ?? '')) {
        return json({ ok: false, error: 'DESTINATION_NOT_FOUND' }, 404, cors)
      }
      const balances = await getBachsBalances(getBachsSandboxPayoutsClient(), result.data.provider_account_ref)
      return json({ ok: true, availableMinor: availableMinor(balances, 'NGN') }, 200, cors)
    }
    if (Deno.env.get('BACHS_SANDBOX_WITHDRAWAL_PROOF_ENABLED') !== '1') {
      return json({ ok: false, error: 'WITHDRAWAL_PROOF_DISABLED' }, 403, cors)
    }
    if (body.action === 'START') {
      if (!body.destinationId || !body.amountMinor || !body.requestKey) {
        return json({ ok: false, error: 'INVALID_REQUEST' }, 400, cors)
      }
      const claim = await start(db, body.destinationId, body.amountMinor, body.requestKey)
      reviewClaimId = claim.id
      return json({ ok: true, claimId: claim.id, status: claim.status }, 200, cors)
    }
    if (body.action === 'ADVANCE') {
      if (!body.claimId) return json({ ok: false, error: 'INVALID_REQUEST' }, 400, cors)
      const claim = await readClaim(db, body.claimId)
      if (!claim) return json({ ok: false, error: 'CLAIM_NOT_FOUND' }, 404, cors)
      const next = await advance(db, claim)
      if (next.status === 'REVIEW') await recordWithdrawalReview(db, next.id)
      return json({ ok: true, claimId: next.id, status: next.status,
        topupTransferId: next.topup_transfer_id, payoutId: next.payout_id,
        sweepTransferId: next.sweep_transfer_id, actualFeeMinor: next.actual_fee_minor,
        feeLedgerTransactionId: next.fee_ledger_transaction_id }, 200, cors)
    }
    // Bounded reconciliation entry point for the scheduler. No new claim starts here.
    const open = await db.from('bachs_withdrawal_fee_claims').select(claimColumns)
      .not('status', 'in', '(COMPLETE,REVIEW)').order('updated_at', { ascending: true }).limit(20)
    if (open.error) throw open.error
    let advanced = 0
    for (const row of open.data ?? []) {
      const before = row as Claim
      try {
        const after = await advance(db, before)
        if (after.status === 'REVIEW') await recordWithdrawalReview(db, after.id)
        if (before.status !== after.status || before.topup_transfer_id !== after.topup_transfer_id ||
          before.payout_id !== after.payout_id || before.sweep_transfer_id !== after.sweep_transfer_id) advanced++
      } catch {
        await recordWithdrawalReview(db, before.id)
      }
    }
    return json({ ok: true, checked: open.data?.length ?? 0, advanced }, 200, cors)
  } catch (error) {
    if (reviewDb && reviewClaimId) {
      try {
        await recordWithdrawalReview(reviewDb, reviewClaimId)
      } catch { /* preserve the original fail-closed response */ }
    }
    // Never include provider messages or credentials in this response.
    return json({ ok: false, error: 'WITHDRAWAL_NEEDS_OPS_REVIEW',
      reason: error instanceof Error ? error.name : 'UnknownError',
      ...(error instanceof BachsRequestError
        ? { providerStatus: error.status, providerCode: error.code }
        : {}) }, 409, cors)
  }
})
