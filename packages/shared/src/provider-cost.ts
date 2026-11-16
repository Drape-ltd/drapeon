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
 * Returns the customer amount due after a promotion when a separately
 * disclosed provider cost is present.
 *
 * Custom-order promotions can be reserved before the payment route locks the
 * provider cost, while ready-made promotions are reserved after that lock. A
 * caller must state which lifecycle it is presenting so a retry neither drops
 * the cost nor adds it twice.
 */
export function promotionCustomerDueWithProviderCost(input: {
  customerDueAmount: number
  providerCostAmount: number
  providerCostAlreadyIncluded: boolean
}) {
  const customerDueAmount = requireMinorUnits(input.customerDueAmount, 'customerDueAmount')
  const providerCostAmount = requireMinorUnits(input.providerCostAmount, 'providerCostAmount')
  if (input.providerCostAlreadyIncluded) return customerDueAmount

  const total = customerDueAmount + providerCostAmount
  if (!Number.isSafeInteger(total)) {
    throw new Error('The promotion customer due amount exceeds safe minor-unit bounds.')
  }
  return total
}

/**
 * Promotions are reserved at different points in the two checkout flows. A
 * custom Bachs retry reuses a reservation from before the route snapshot
 * locked its provider cost; a ready-made reservation is created after the
 * snapshot and already contains that cost.
 */
export function initialOrderPromotionCustomerDue(input: {
  customerDueAmount: number
  orderKind: string | null | undefined
  acceptedRouteSnapshotAt: string | null | undefined
  chargeProviderSnapshot: string | null | undefined
  lockedProviderCostAmount: number | null | undefined
}) {
  const customBachsRetry =
    input.orderKind === 'CUSTOM' &&
    input.acceptedRouteSnapshotAt != null &&
    input.chargeProviderSnapshot === 'BACHS'
  const providerCostAmount = customBachsRetry ? input.lockedProviderCostAmount : 0
  if (
    typeof providerCostAmount !== 'number' ||
    !Number.isSafeInteger(providerCostAmount) ||
    providerCostAmount < 0
  ) {
    throw new Error('The locked provider cost must be a non-negative safe integer in minor units.')
  }
  return promotionCustomerDueWithProviderCost({
    customerDueAmount: input.customerDueAmount,
    providerCostAmount,
    providerCostAlreadyIncluded: false,
  })
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

