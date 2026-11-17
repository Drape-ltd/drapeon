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

/** Add a separately disclosed provider cost to the amount the customer owes. */
export function addProviderCostToCustomerDue(customerDueAmount: number, providerCostAmount: number) {
  const customerDue = requireMinorUnits(customerDueAmount, 'customerDueAmount')
  const providerCost = requireMinorUnits(providerCostAmount, 'providerCostAmount')
  const total = customerDue + providerCost
  if (!Number.isSafeInteger(total)) {
    throw new Error('The customer due total exceeds safe minor-unit bounds.')
  }
  return total
}

/** A persisted benefit due amount may already include the provider cost. */
export function readyMadeCustomerDueAmount(input: {
  baseTotalAmount: number
  providerCostAmount: number
  benefitCustomerDueAmount?: number | null
}) {
  if (input.benefitCustomerDueAmount != null) {
    return requireMinorUnits(input.benefitCustomerDueAmount, 'benefitCustomerDueAmount')
  }
  return addProviderCostToCustomerDue(input.baseTotalAmount, input.providerCostAmount)
}

export function customerPaymentAmountForBenefit(input: {
  customerDueAmount: number
  chargeProvider: string | null | undefined
  lockedProviderCostAmount: number
  benefitGrossOrderAmount: number
  acceptedOrderTotalAmount: number
}) {
  const customerDue = requireMinorUnits(input.customerDueAmount, 'customerDueAmount')
  if (input.chargeProvider?.trim().toUpperCase() !== 'BACHS' || input.lockedProviderCostAmount === 0) {
    return customerDue
  }
  const providerCost = requireMinorUnits(input.lockedProviderCostAmount, 'lockedProviderCostAmount')
  const benefitGross = requireMinorUnits(input.benefitGrossOrderAmount, 'benefitGrossOrderAmount')
  const acceptedTotal = requireMinorUnits(input.acceptedOrderTotalAmount, 'acceptedOrderTotalAmount')
  if (benefitGross === acceptedTotal) return customerDue
  if (addProviderCostToCustomerDue(benefitGross, providerCost) === acceptedTotal) {
    return addProviderCostToCustomerDue(customerDue, providerCost)
  }
  throw new Error('The reserved benefit does not match the accepted checkout total.')
}

/**
 * Restores the total due on a benefit reservation before a new checkout attempt.
 *
 * The reservation's original customer due excludes the separately disclosed
 * Bachs provider cost when it was made before quote acceptance. A checkout can
 * fail after acceptance but before persisting an attempt, so preserve the
 * resolved total on the in-memory benefit object used to create the pricing
 * reservation. This keeps the capture amount and locked pricing total aligned.
 */
export function restoreBenefitCustomerDueForPayment<T extends {
  customer_due_amount: number
  gross_order_amount: number
}>(
  benefit: T,
  input: {
    chargeProvider: string | null | undefined
    lockedProviderCostAmount: number
    acceptedOrderTotalAmount: number
  },
) {
  const customerDueAmount = customerPaymentAmountForBenefit({
    customerDueAmount: benefit.customer_due_amount,
    chargeProvider: input.chargeProvider,
    lockedProviderCostAmount: input.lockedProviderCostAmount,
    benefitGrossOrderAmount: benefit.gross_order_amount,
    acceptedOrderTotalAmount: input.acceptedOrderTotalAmount,
  })
  return {
    ...benefit,
    customer_due_amount: customerDueAmount,
  }
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

