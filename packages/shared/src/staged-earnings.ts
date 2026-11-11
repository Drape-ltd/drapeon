import { derivePayoutDeliveryState } from './provider-settlement.ts'
import { formatMoney } from './presentation.ts'

export type StagedEarningsTranche = {
  id: string
  amount: number
  currency: string
  status: string
}

export type StagedEarningsPayout = {
  settlement_tranche_id?: string | null
  payout_purpose?: string | null
  amount: number
  currency: string
  provider?: string | null
  status?: string | null
  provider_transfer_status?: string | null
  bank_settlement_status?: string | null
  initiated_at?: string | null
}

export type StagedEarningsSummary = {
  currency: string
  total: number
  pending: number
  available: number
  inProviderBalance: number
  paidToBank: number
}

export type StagedEarningsOrderStatus =
  | 'PENDING' | 'AVAILABLE' | 'RELEASED' | 'IN_TRANSIT'
  | 'IN_PROVIDER_BALANCE' | 'PAID_OUT' | 'BLOCKED'

export type StagedEarningsOrderDisplay = {
  status: StagedEarningsOrderStatus
  reason: string
}

export type StagedEarningsProjection = {
  summary: StagedEarningsSummary | null
  display: StagedEarningsOrderDisplay | null
  errorCode: string | null
}

export const STAGED_EARNINGS_REVIEW_COPY = "This order's payout record needs Drapeon Ops review."

// Project each order independently so one malformed payout cannot hide the
// other orders on an earnings screen.
export function projectStagedEarningsOrder(
  tranches: StagedEarningsTranche[],
  payouts: StagedEarningsPayout[],
  options: { openDispute?: boolean } = {},
): StagedEarningsProjection {
  try {
    const summary = summarizeStagedEarnings(tranches, payouts)
    if (!summary && payouts.some((payout) => payout.payout_purpose === 'SETTLEMENT_TRANCHE')) {
      throw new Error('STAGED_EARNINGS_TRANCHES_UNAVAILABLE')
    }
    if (!summary) return { summary: null, display: null, errorCode: null }
    if (options.openDispute) {
      const released = summary.inProviderBalance + summary.paidToBank
      const suffix = summary.inProviderBalance > 0
        ? ` ${formatMoney(summary.inProviderBalance, summary.currency)} is already in your provider balance.`
        : summary.paidToBank > 0
          ? ` ${formatMoney(summary.paidToBank, summary.currency)} has already reached the bank.`
          : ''
      return {
        summary,
        display: {
          status: 'BLOCKED',
          reason: `${released > 0 ? 'Open dispute: later tranches are on hold.' : 'Open dispute: unreleased earnings are on hold.'}${suffix}`,
        },
        errorCode: null,
      }
    }
    return { summary, display: stagedEarningsOrderDisplay(tranches, payouts), errorCode: null }
  } catch (error) {
    const code = error instanceof Error && /^STAGED_EARNINGS_[A-Z_]+$/.test(error.message)
      ? error.message
      : 'STAGED_EARNINGS_PROJECTION_FAILED'
    return {
      summary: null,
      display: {
        status: 'BLOCKED',
        reason: options.openDispute
          ? `Open dispute: unreleased earnings are on hold. ${STAGED_EARNINGS_REVIEW_COPY}`
          : STAGED_EARNINGS_REVIEW_COPY,
      },
      errorCode: code,
    }
  }
}

export function stagedEarningsReadUnavailable(input: {
  trancheErrorCode?: string | null
  payoutReadFailed: boolean
  tranches: StagedEarningsTranche[]
  payouts: StagedEarningsPayout[]
}): boolean {
  if (input.trancheErrorCode && !['42P01', 'PGRST205'].includes(input.trancheErrorCode)) return true
  if (!input.tranches.length && input.trancheErrorCode && input.payouts.some((payout) => payout.payout_purpose === 'SETTLEMENT_TRANCHE')) return true
  return input.payoutReadFailed && input.tranches.some((tranche) => tranche.status === 'RELEASED')
}

function latestTranchePayout(trancheId: string, payouts: StagedEarningsPayout[]) {
  return payouts
    .filter((payout) => payout.payout_purpose === 'SETTLEMENT_TRANCHE'
      && payout.settlement_tranche_id === trancheId)
    .sort((left, right) => Date.parse(right.initiated_at ?? '') - Date.parse(left.initiated_at ?? ''))[0]
}

// Tranches, not the order's full entitlement, own staged earnings state.
// A partly released order must not put the released amount back in pending.
export function summarizeStagedEarnings(
  tranches: StagedEarningsTranche[],
  payouts: StagedEarningsPayout[],
): StagedEarningsSummary | null {
  const active = tranches.filter((tranche) => tranche.status !== 'CANCELLED')
  if (!active.length) return null
  const currency = active[0]!.currency
  const summary: StagedEarningsSummary = {
    currency, total: 0, pending: 0, available: 0, inProviderBalance: 0, paidToBank: 0,
  }

  for (const tranche of active) {
    if (tranche.currency !== currency || !Number.isSafeInteger(tranche.amount) || tranche.amount < 0) {
      throw new Error('STAGED_EARNINGS_AMOUNT_CONFLICT')
    }
    summary.total += tranche.amount
    switch (tranche.status) {
      case 'LOCKED':
      case 'BLOCKED':
        summary.pending += tranche.amount
        break
      case 'ELIGIBLE':
      case 'RELEASE_REQUESTED':
        summary.available += tranche.amount
        break
      case 'RELEASED': {
        const payout = latestTranchePayout(tranche.id, payouts)
        if (!payout || payout.amount !== tranche.amount || payout.currency !== currency) {
          throw new Error('STAGED_EARNINGS_PAYOUT_MISMATCH')
        }
        const state = derivePayoutDeliveryState({
          provider: payout.provider,
          status: payout.status,
          providerTransferStatus: payout.provider_transfer_status,
          bankSettlementStatus: payout.bank_settlement_status,
        })
        if (state === 'IN_PROVIDER_BALANCE') summary.inProviderBalance += tranche.amount
        else if (state === 'PAID_TO_BANK') summary.paidToBank += tranche.amount
        else summary.pending += tranche.amount
        break
      }
      default:
        throw new Error('STAGED_EARNINGS_STATUS_UNKNOWN')
    }
  }
  return summary
}

// An order can have both a released tranche and later locked tranches. Its
// transaction card must describe that staged state rather than treating a
// delivery-only partial refund as a block on every tailor earning.
export function stagedEarningsOrderDisplay(
  tranches: StagedEarningsTranche[],
  payouts: StagedEarningsPayout[],
): StagedEarningsOrderDisplay | null {
  const active = tranches.filter((tranche) => tranche.status !== 'CANCELLED')
  const summary = summarizeStagedEarnings(tranches, payouts)
  if (!summary) return null

  if (active.some((tranche) => tranche.status === 'BLOCKED')) {
    return { status: 'BLOCKED', reason: 'A settlement tranche is under review. Released earnings remain recorded separately.' }
  }

  const releaseStates = active
    .filter((tranche) => tranche.status === 'RELEASED')
    .map((tranche) => {
      const payout = latestTranchePayout(tranche.id, payouts)!
      return derivePayoutDeliveryState({
        provider: payout.provider,
        status: payout.status,
        providerTransferStatus: payout.provider_transfer_status,
        bankSettlementStatus: payout.bank_settlement_status,
      })
    })

  if (releaseStates.some((state) => ['BLOCKED', 'FAILED', 'REVERSED', 'CANCELED'].includes(state))) {
    return { status: 'BLOCKED', reason: 'A released tranche needs Drapeon Ops review before its payout can continue.' }
  }
  if (summary.inProviderBalance > 0) {
    const parts = [`${formatMoney(summary.inProviderBalance, summary.currency)} in your provider balance`]
    if (summary.pending > 0) parts.push(`${formatMoney(summary.pending, summary.currency)} pending release`)
    if (summary.available > 0) parts.push(`${formatMoney(summary.available, summary.currency)} eligible`)
    return {
      status: 'IN_PROVIDER_BALANCE',
      reason: summary.pending > 0 || summary.available > 0
        ? `${parts.join('; ')}. Bank withdrawals are tracked separately.`
        : 'These earnings reached your provider balance. Bank withdrawals are tracked separately.',
    }
  }
  if (summary.paidToBank > 0) {
    return {
      status: 'PAID_OUT',
      reason: summary.pending > 0 || summary.available > 0
        ? 'Part of this order reached the bank. Later tranches follow their release milestones.'
        : 'The payout provider confirmed these earnings reached the bank.',
    }
  }
  if (releaseStates.includes('BANK_PAYOUT_PENDING')) {
    return { status: 'IN_TRANSIT', reason: 'An account-level bank withdrawal is in transit.' }
  }
  if (releaseStates.includes('RELEASE_PROCESSING')) {
    return { status: 'RELEASED', reason: 'A settlement tranche is being released by the payout provider.' }
  }
  if (summary.available > 0) {
    return { status: 'AVAILABLE', reason: 'A settlement tranche is eligible for reviewed release.' }
  }
  return { status: 'PENDING', reason: 'Settlement tranches are waiting for their verified release milestones.' }
}
