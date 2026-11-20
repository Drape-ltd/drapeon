import { bachsAmountMinor } from './bachs.ts'

/** The fee is paid from the connected account's pooled available balance. */
export const DEFAULT_BACHS_WITHDRAWAL_FEE_RESERVE_MINOR = 10_000 // NGN 100.00
export const MAX_BACHS_WITHDRAWAL_FEE_RESERVE_MINOR = 50_000 // NGN 500.00

export function bachsWithdrawalFeeReserveMinor(configured: string | undefined): number {
  if (configured == null || configured.trim() === '') return DEFAULT_BACHS_WITHDRAWAL_FEE_RESERVE_MINOR
  const value = Number(configured)
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_BACHS_WITHDRAWAL_FEE_RESERVE_MINOR) {
    throw new Error('Bachs withdrawal fee reserve configuration is invalid.')
  }
  return value
}

/**
 * The staged earning is already in the connected balance. Do not transfer it
 * again. Require an otherwise empty balance so a larger provider fee cannot
 * silently consume other earnings after the reserve transfer.
 */
export function planBachsWithdrawalFeeReserve(input: {
  availableMinor: number
  withdrawalAmountMinor: number
  reserveMinor: number
}): { topUpMinor: number; expectedAvailableAfterTopUpMinor: number } {
  const { availableMinor, withdrawalAmountMinor, reserveMinor } = input
  if (![availableMinor, withdrawalAmountMinor, reserveMinor].every(Number.isSafeInteger) ||
    withdrawalAmountMinor <= 0 || reserveMinor < 0 ||
    reserveMinor > MAX_BACHS_WITHDRAWAL_FEE_RESERVE_MINOR) {
    throw new Error('Bachs withdrawal amount or reserve is invalid.')
  }
  if (availableMinor !== withdrawalAmountMinor) {
    throw new Error('Bachs withdrawal needs account-level review because the available balance does not exactly match the requested amount.')
  }
  const expectedAvailableAfterTopUpMinor = availableMinor + reserveMinor
  if (!Number.isSafeInteger(expectedAvailableAfterTopUpMinor)) {
    throw new Error('Bachs withdrawal balance exceeds safe minor units.')
  }
  return { topUpMinor: reserveMinor, expectedAvailableAfterTopUpMinor }
}

export type BachsWithdrawalFeeOutcome =
  | { state: 'PENDING_FEE'; payoutId: string }
  | { state: 'FEE_CONFIRMED'; payoutId: string; actualFeeMinor: number; sweepMinor: number }

/** A null fee is pending provider evidence; never guess or sweep it. */
export function reconcileBachsWithdrawalFee(input: {
  payoutId: string
  payoutAmount: string
  payoutCurrency: string
  expectedAmountMinor: number
  fee: string | null
  reserveMinor: number
}): BachsWithdrawalFeeOutcome {
  if (!/^pay_[A-Za-z0-9_-]+$/u.test(input.payoutId) ||
    bachsAmountMinor(input.payoutAmount, input.payoutCurrency) !== input.expectedAmountMinor ||
    !Number.isSafeInteger(input.reserveMinor) || input.reserveMinor < 0 ||
    input.reserveMinor > MAX_BACHS_WITHDRAWAL_FEE_RESERVE_MINOR) {
    throw new Error('Bachs payout identity or fee reserve does not match the withdrawal.')
  }
  if (input.fee == null) return { state: 'PENDING_FEE', payoutId: input.payoutId }
  const actualFeeMinor = bachsAmountMinor(input.fee, input.payoutCurrency)
  if (actualFeeMinor > input.reserveMinor) {
    throw new Error('Bachs payout fee exceeded the reserved platform contribution; Ops reconciliation required.')
  }
  return {
    state: 'FEE_CONFIRMED',
    payoutId: input.payoutId,
    actualFeeMinor,
    sweepMinor: input.reserveMinor - actualFeeMinor,
  }
}
