export const BACHS_NGN_CARD_PROVIDER_COST_SCHEDULE = 'ngn-card-provider-cost-2pct-v1' as const

export type ProviderCostQuote = {
  scheduleVersion: typeof BACHS_NGN_CARD_PROVIDER_COST_SCHEDULE
  provider: 'BACHS'
  paymentMethod: 'CARD'
  currency: 'NGN'
  basisPoints: 200
  baseAmount: number
  providerCostAmount: number
  customerTotalAmount: number
  disclosureLabel: 'Payment processing'
}

export function customerFeeLineLabel(provider: string | null | undefined) {
  return provider?.trim().toUpperCase() === 'BACHS' ? 'Payment processing' : 'Drapeon service fee'
}

function requireMinorUnits(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer in minor units.`)
  }
  return value
}

/**
 * Locks the disclosed customer provider cost for the Bachs NGN-card corridor.
 *
 * The provider later charges its fee against the gross checkout amount. Drapeon
 * intentionally does not gross-up this estimate: the customer sees a stable 2%
 * line on the pre-fee order amount and Drapeon absorbs any settlement difference.
 */
export function quoteBachsNgnCardProviderCost(input: {
  scheduleVersion: string
  baseAmount: number
}): ProviderCostQuote {
  if (input.scheduleVersion !== BACHS_NGN_CARD_PROVIDER_COST_SCHEDULE) {
    throw new Error('The Bachs NGN-card provider-cost schedule is unsupported.')
  }
  const baseAmount = requireMinorUnits(input.baseAmount, 'baseAmount')
  const wholeBlocks = Math.floor(baseAmount / 10_000)
  const remainder = baseAmount % 10_000
  const providerCostAmount = wholeBlocks * 200 + Math.floor((remainder * 200 + 5_000) / 10_000)
  const customerTotalAmount = baseAmount + providerCostAmount
  if (!Number.isSafeInteger(providerCostAmount) || !Number.isSafeInteger(customerTotalAmount)) {
    throw new Error('The provider-cost total exceeds safe minor-unit bounds.')
  }
  return {
    scheduleVersion: BACHS_NGN_CARD_PROVIDER_COST_SCHEDULE,
    provider: 'BACHS',
    paymentMethod: 'CARD',
    currency: 'NGN',
    basisPoints: 200,
    baseAmount,
    providerCostAmount,
    customerTotalAmount,
    disclosureLabel: 'Payment processing',
  }
}

