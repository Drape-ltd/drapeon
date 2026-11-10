import { derivePayoutDeliveryState } from './provider-settlement.ts'

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
        const matching = payouts
          .filter((payout) => payout.payout_purpose === 'SETTLEMENT_TRANCHE'
            && payout.settlement_tranche_id === tranche.id)
          .sort((left, right) => Date.parse(right.initiated_at ?? '') - Date.parse(left.initiated_at ?? ''))
        const payout = matching[0]
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
