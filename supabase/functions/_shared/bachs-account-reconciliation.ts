import {
  bachsBalanceAmountMinor,
  bachsAmountMinor,
} from './bachs.ts'
import {
  getBachsBalances,
  listBachsPayouts,
  listBachsTransfers,
  type BachsBalances,
  type BachsPayout,
  type BachsTransfer,
} from './bachs-operations.ts'
import type { createBachsClient } from './bachs.ts'

type BachsClient = ReturnType<typeof createBachsClient>

const PAGE_SIZE = 100
export const BACHS_ACCOUNT_MOVEMENT_RECONCILIATION_MAX_RECORDS = 500

export type BachsAccountBalanceDifference = {
  currency: string
  expectedMinor: number
  providerMinor: number
  differenceMinor: number
}

export type BachsAccountBalanceReconciliation =
  | { status: 'MATCHED'; checkedCurrencies: number }
  | {
    status: 'MISMATCH'
    checkedCurrencies: number
    differences: BachsAccountBalanceDifference[]
    transferDiscrepancies: {
      unmatchedProviderTransfers: number
      missingProviderTransfers: number
      identityMismatches: number
    }
    withdrawalDiscrepancies: {
      missingRecordedEvents: number
      orphanRecordedEvents: number
      identityMismatches: number
    }
  }
  | {
    status: 'INCOMPLETE'
    reason: string
  }

/** A durable Drapeon earning/operation record for one Bachs transfer. */
export type BachsExpectedTransfer = {
  claimId: string
  operationNumber: number
  provider: string
  providerDestinationId: string
  currency: string
  amountMinor: number
  claimStatus: string
  operationStatus: string
  claimProviderTransferId: string | null
  operationProviderTransferId: string | null
  payoutLedgerTransactionId: string | null
}

/** Account-level webhook observation; withdrawals are not assigned to earnings. */
export type BachsRecordedWithdrawal = {
  payoutId: string
  amountMinor: number | null
  currency: string | null
  status: string | null
  occurredAt: string | null
  processedAt: string | null
}

function addAmount(target: Map<string, number>, currency: string, amount: number) {
  const next = (target.get(currency) ?? 0) + amount
  if (!Number.isSafeInteger(next)) {
    throw new Error('Bachs balance reconciliation exceeded safe integer range.')
  }
  target.set(currency, next)
}

function parseNonNegative(amount: string, currency: string): number {
  const parsed = bachsAmountMinor(amount, currency)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('Bachs returned a negative or unsafe movement amount.')
  }
  return parsed
}

/**
 * Compare the account balance against the provider's own complete movement
 * history: Drapeon-confirmed transfers in, less provider withdrawals and their
 * fees. Failed withdrawal return semantics remain unproven, so those records
 * fail closed. No earning is attributed to an individual bank withdrawal.
 */
export function compareBachsAccountBalance(input: {
  accountId: string
  balances: BachsBalances
  transfers: BachsTransfer[]
  payouts: BachsPayout[]
  expectedTransfers: BachsExpectedTransfer[]
  recordedWithdrawals: BachsRecordedWithdrawal[]
}): BachsAccountBalanceReconciliation {
  if (!/^acct_[A-Za-z0-9_-]+$/u.test(input.accountId) ||
    input.balances.account_id !== input.accountId) {
    return { status: 'INCOMPLETE', reason: 'account_identity_mismatch' }
  }

  try {
    const expected = new Map<string, number>()
    const expectedByTransferId = new Map<string, BachsExpectedTransfer>()
    for (const transfer of input.expectedTransfers) {
      const transferId = transfer.operationProviderTransferId
      if (
        !transfer.claimId || !Number.isInteger(transfer.operationNumber) ||
        transfer.operationNumber < 1 || transfer.provider !== 'BACHS' ||
        transfer.providerDestinationId !== input.accountId ||
        !/^[A-Z]{3}$/u.test(transfer.currency) ||
        !Number.isSafeInteger(transfer.amountMinor) || transfer.amountMinor <= 0
      ) {
        return { status: 'INCOMPLETE', reason: 'drapeon_payout_identity_invalid' }
      }
      if (['RESERVED', 'PROVIDER_UNKNOWN', 'PROVIDER_PENDING'].includes(transfer.operationStatus)) {
        return { status: 'INCOMPLETE', reason: 'drapeon_payout_operation_unresolved' }
      }
      if (transfer.operationStatus !== 'TRANSFERRED' || transfer.claimStatus !== 'TRANSFERRED') {
        // A returned/late/blocked operation needs provider evidence that its
        // former balance movement was restored before it can be netted out.
        return { status: 'INCOMPLETE', reason: 'drapeon_payout_operation_not_confirmed' }
      }
      if (
        !transferId || transfer.claimProviderTransferId !== transferId ||
        !transfer.payoutLedgerTransactionId
      ) {
        return { status: 'INCOMPLETE', reason: 'drapeon_payout_ledger_link_missing' }
      }
      if (expectedByTransferId.has(transferId)) {
        return { status: 'INCOMPLETE', reason: 'drapeon_transfer_id_duplicated' }
      }
      expectedByTransferId.set(transferId, transfer)
      addAmount(expected, transfer.currency, transfer.amountMinor)
    }

    const seenTransferIds = new Set<string>()
    let unmatchedProviderTransfers = 0
    let identityMismatches = 0
    for (const transfer of input.transfers) {
      if (!/^tr_[A-Za-z0-9_-]+$/u.test(transfer.id) ||
        seenTransferIds.has(transfer.id) ||
        !/^[A-Z]{3}$/u.test(transfer.currency) ||
        typeof transfer.source !== 'string' ||
        typeof transfer.destination !== 'string' ||
        transfer.source === transfer.destination ||
        (transfer.source !== input.accountId &&
          transfer.destination !== input.accountId)) {
        return { status: 'INCOMPLETE', reason: 'transfer_identity_invalid' }
      }
      if (transfer.kind !== 'manual') {
        // Destination-charge payout transfers have separate platform-fee
        // records; this reconciliation intentionally supports only the
        // separate-transfer model and must not guess at that fee allocation.
        return { status: 'INCOMPLETE', reason: 'transfer_kind_unsupported' }
      }
      seenTransferIds.add(transfer.id)
      if (transfer.status !== 'pending' && transfer.status !== 'paid') {
        return { status: 'INCOMPLETE', reason: 'transfer_status_unknown' }
      }
      const drapeonTransfer = expectedByTransferId.get(transfer.id)
      if (!drapeonTransfer) {
        unmatchedProviderTransfers += 1
        continue
      }
      const amount = parseNonNegative(transfer.amount, transfer.currency)
      if (
        amount !== drapeonTransfer.amountMinor ||
        transfer.currency !== drapeonTransfer.currency ||
        transfer.destination !== input.accountId
      ) {
        identityMismatches += 1
      }
      if (transfer.status !== 'paid') {
        return { status: 'INCOMPLETE', reason: 'drapeon_transfer_not_paid_at_provider' }
      }
    }
    const missingProviderTransfers = [...expectedByTransferId.keys()].filter((id) => !seenTransferIds.has(id)).length

    const seenPayoutIds = new Set<string>()
    const recordedByPayoutId = new Map<string, BachsRecordedWithdrawal>()
    for (const event of input.recordedWithdrawals) {
      if (!/^pay_[A-Za-z0-9_-]+$/u.test(event.payoutId)) {
        return { status: 'INCOMPLETE', reason: 'recorded_withdrawal_identity_invalid' }
      }
      const prior = recordedByPayoutId.get(event.payoutId)
      if (!prior) {
        recordedByPayoutId.set(event.payoutId, event)
        continue
      }
      const priorTime = Date.parse(prior.occurredAt ?? prior.processedAt ?? '')
      const nextTime = Date.parse(event.occurredAt ?? event.processedAt ?? '')
      if (!Number.isFinite(priorTime) || !Number.isFinite(nextTime) || priorTime === nextTime) {
        return { status: 'INCOMPLETE', reason: 'recorded_withdrawal_order_ambiguous' }
      }
      if (nextTime > priorTime) recordedByPayoutId.set(event.payoutId, event)
    }
    let missingRecordedEvents = 0
    let orphanRecordedEvents = 0
    let withdrawalIdentityMismatches = 0
    for (const payout of input.payouts) {
      if (!/^pay_[A-Za-z0-9_-]+$/u.test(payout.id) ||
        seenPayoutIds.has(payout.id)) {
        return { status: 'INCOMPLETE', reason: 'payout_identity_invalid' }
      }
      seenPayoutIds.add(payout.id)
      if (payout.status === 'failed') {
        // The public payout event reference says delivery failed but does not
        // guarantee the debit/fee has been returned to the connected balance.
        // Do not infer the ledger effect without a current provider balance or
        // written return semantics.
        return { status: 'INCOMPLETE', reason: 'failed_payout_balance_effect_unconfirmed' }
      }
      if (!['pending', 'processing', 'completed'].includes(payout.status)) {
        return { status: 'INCOMPLETE', reason: 'payout_status_unknown' }
      }
      const recorded = recordedByPayoutId.get(payout.id)
      if (!recorded) {
        missingRecordedEvents += 1
      } else {
        recordedByPayoutId.delete(payout.id)
        const eventStatus = recorded.status?.toUpperCase()
        const expectedEventStatus = payout.status === 'completed' ? 'PAID' : 'PENDING'
        if (
          !Number.isSafeInteger(recorded.amountMinor) ||
          recorded.amountMinor !== bachsAmountMinor(payout.amount, payout.currency) ||
          recorded.currency?.toUpperCase() !== payout.currency.toUpperCase() ||
          eventStatus !== expectedEventStatus
        ) {
          withdrawalIdentityMismatches += 1
        }
      }
      const sourceCurrency = payout.source_currency?.toUpperCase() ?? ''
      if (!/^[A-Z]{3}$/u.test(sourceCurrency) ||
        !payout.total_debited) {
        return { status: 'INCOMPLETE', reason: 'payout_debit_missing' }
      }
      const debit = parseNonNegative(payout.total_debited, sourceCurrency)
      if (debit <= 0) {
        return { status: 'INCOMPLETE', reason: 'payout_debit_invalid' }
      }
      addAmount(expected, sourceCurrency, -debit)
    }
    orphanRecordedEvents = recordedByPayoutId.size

    const provider = new Map<string, number>()
    for (const balance of input.balances.balances) {
      if (!/^[A-Z]{3}$/u.test(balance.currency) ||
        provider.has(balance.currency)) {
        return { status: 'INCOMPLETE', reason: 'balance_currency_invalid' }
      }
      const available = bachsBalanceAmountMinor(
        balance.available_balance,
        balance.currency,
      )
      const pending = bachsBalanceAmountMinor(
        balance.pending_balance,
        balance.currency,
      )
      const total = available + pending
      if (!Number.isSafeInteger(total)) {
        return { status: 'INCOMPLETE', reason: 'balance_amount_invalid' }
      }
      provider.set(balance.currency, total)
    }

    const currencies = new Set([...expected.keys(), ...provider.keys()])
    const differences = [...currencies].sort().flatMap((currency) => {
      const expectedMinor = expected.get(currency) ?? 0
      const providerMinor = provider.get(currency) ?? 0
      const differenceMinor = providerMinor - expectedMinor
      return differenceMinor === 0
        ? []
        : [{ currency, expectedMinor, providerMinor, differenceMinor }]
    })
    const transferDiscrepancies = {
      unmatchedProviderTransfers,
      missingProviderTransfers,
      identityMismatches,
    }
    const withdrawalDiscrepancies = {
      missingRecordedEvents,
      orphanRecordedEvents,
      identityMismatches: withdrawalIdentityMismatches,
    }
    const hasRecordDiscrepancies = unmatchedProviderTransfers > 0 ||
      missingProviderTransfers > 0 || identityMismatches > 0 ||
      missingRecordedEvents > 0 || orphanRecordedEvents > 0 ||
      withdrawalIdentityMismatches > 0
    if (hasRecordDiscrepancies || differences.length) {
      return {
        status: 'MISMATCH',
        checkedCurrencies: currencies.size,
        differences,
        transferDiscrepancies,
        withdrawalDiscrepancies,
      }
    }
    return { status: 'MATCHED', checkedCurrencies: currencies.size }
  } catch {
    return { status: 'INCOMPLETE', reason: 'movement_money_invalid' }
  }
}

async function readAllPages<T>(input: {
  readPage: (offset: number) => Promise<{
    items: T[]
    total: number
    limit?: number
    offset?: number
  }>
  maxRecords: number
}): Promise<{ items: T[] } | { incomplete: string }> {
  let total: number | null = null
  const items: T[] = []
  for (let offset = 0; offset < (total ?? 1); offset += PAGE_SIZE) {
    const page = await input.readPage(offset)
    if (page.limit !== PAGE_SIZE || page.offset !== offset ||
      !Number.isSafeInteger(page.total) || page.total < 0 ||
      (total !== null && page.total !== total)) {
      return { incomplete: 'provider_pagination_changed_or_invalid' }
    }
    total ??= page.total
    if (total > input.maxRecords) {
      return { incomplete: 'provider_movement_history_exceeds_safe_limit' }
    }
    const expectedPageLength = Math.min(PAGE_SIZE, total - offset)
    if (page.items.length !== expectedPageLength) {
      return { incomplete: 'provider_movement_history_truncated' }
    }
    items.push(...page.items)
    if (items.length > input.maxRecords) {
      return { incomplete: 'provider_movement_history_exceeds_safe_limit' }
    }
    if (offset + page.items.length >= total) break
  }
  return { items }
}

/** Fetch a bounded, complete account movement snapshot; read-only provider calls only. */
export async function reconcileBachsConnectedAccountBalance(input: {
  client: BachsClient
  accountId: string
  expectedTransfers: BachsExpectedTransfer[]
  recordedWithdrawals: BachsRecordedWithdrawal[]
  maxRecords?: number
  deps?: {
    getBalances?: typeof getBachsBalances
    listTransfers?: typeof listBachsTransfers
    listPayouts?: typeof listBachsPayouts
  }
}): Promise<BachsAccountBalanceReconciliation> {
  const maxRecords = input.maxRecords ??
    BACHS_ACCOUNT_MOVEMENT_RECONCILIATION_MAX_RECORDS
  if (!Number.isInteger(maxRecords) || maxRecords < 1) {
    return { status: 'INCOMPLETE', reason: 'reconciliation_limit_invalid' }
  }
  const listTransfers = input.deps?.listTransfers ?? listBachsTransfers
  const listPayouts = input.deps?.listPayouts ?? listBachsPayouts
  const transferResult = await readAllPages({
    maxRecords,
    readPage: (offset) => listTransfers(input.client, {
      limit: PAGE_SIZE,
      offset,
      connectedAccountId: input.accountId,
    }),
  })
  if ('incomplete' in transferResult) {
    return { status: 'INCOMPLETE', reason: transferResult.incomplete }
  }
  const payoutResult = await readAllPages({
    maxRecords,
    readPage: async (offset) => {
      const page = await listPayouts(input.client, {
        limit: PAGE_SIZE,
        offset,
        accountId: input.accountId,
      })
      return {
        ...page,
        limit: page.limit ?? PAGE_SIZE,
        offset: page.offset ?? offset,
      }
    },
  })
  if ('incomplete' in payoutResult) {
    return { status: 'INCOMPLETE', reason: payoutResult.incomplete }
  }
  const balances = await (input.deps?.getBalances ?? getBachsBalances)(
    input.client,
    input.accountId,
  )
  return compareBachsAccountBalance({
    accountId: input.accountId,
    balances,
    transfers: transferResult.items as BachsTransfer[],
    payouts: payoutResult.items as BachsPayout[],
    expectedTransfers: input.expectedTransfers,
    recordedWithdrawals: input.recordedWithdrawals,
  })
}
