import { normalizeAccountCurrency, type AccountCurrencyCode } from './currency-config.ts'

export type AcceptedOrderPayoutSnapshot = {
  accepted_route_snapshot_at?: string | null
  charge_provider_snapshot?: string | null
  charge_currency_snapshot?: string | null
  legal_entity_snapshot?: string | null
  payout_destination_id?: string | null
  tailor_profile_id?: string | null
  tailor_payout_currency_locked?: string | null
  accepted_earning_amount?: number | null
}

export type PayoutDestinationRecord = {
  id: string
  tailor_profile_id: string
  provider: string
  legal_entity: string
  currency: string
  provider_account_ref: string
  transfers_enabled: boolean
  payouts_enabled: boolean
  fees_collector: string
  first_withdrawal_review_status: string
  active: boolean
  capability_checked_at: string | null
}

export type AcceptedOrderPayoutRoute = {
  provider: 'STRIPE' | 'BACHS'
  chargeCurrency: AccountCurrencyCode
  payoutCurrency: AccountCurrencyCode
  destinationId: string
  providerAccountRef: string
}

export type AcceptedOrderPayoutMoney = {
  provider: 'STRIPE'
  currency: AccountCurrencyCode
  amount: number
}

/** Returns the provider pinned at acceptance, or null only for a legacy order. */
export function acceptedOrderPayoutProvider(
  order: AcceptedOrderPayoutSnapshot,
): 'STRIPE' | 'BACHS' | null {
  if (!order.accepted_route_snapshot_at) return null
  return order.charge_provider_snapshot === 'STRIPE' || order.charge_provider_snapshot === 'BACHS'
    ? order.charge_provider_snapshot
    : null
}

/** Resolve the provider permitted to release legacy earnings from the order's
 * persisted lock. Currency is never sufficient evidence for a payout provider. */
export function resolveOrderPayoutProvider(
  order: AcceptedOrderPayoutSnapshot & { tailor_payout_provider_locked?: string | null },
): 'STRIPE' | 'PAYSTACK' | null {
  if (order.accepted_route_snapshot_at) {
    return order.charge_provider_snapshot === 'STRIPE' ? 'STRIPE' : null
  }
  return order.tailor_payout_provider_locked === 'STRIPE' || order.tailor_payout_provider_locked === 'PAYSTACK'
    ? order.tailor_payout_provider_locked
    : null
}

/** Resolve from the accepted snapshot when present; only pre-snapshot orders
 * may fall back to an explicitly stored provider or linked payment attempt. */
export function resolveOrderChargeProvider(
  order: AcceptedOrderPayoutSnapshot,
  legacyProvider: 'STRIPE' | 'PAYSTACK' | null,
  linkedAttemptProvider: 'STRIPE' | 'PAYSTACK' | null = null,
): 'STRIPE' | 'PAYSTACK' | 'BACHS' | null {
  if (!order.accepted_route_snapshot_at) return legacyProvider ?? linkedAttemptProvider
  return acceptedOrderPayoutProvider(order)
}

/** Returns the immutable earning for the current Stripe-supported launch route. */
export function acceptedOrderPayoutMoney(
  order: AcceptedOrderPayoutSnapshot,
): AcceptedOrderPayoutMoney | null {
  if (!order.accepted_route_snapshot_at) return null
  if (order.charge_provider_snapshot !== 'STRIPE') {
    throw new Error('ACCEPTED_ORDER_PAYOUT_PROVIDER_NOT_READY')
  }
  const currency = normalizeAccountCurrency(order.tailor_payout_currency_locked)
  const amount = order.accepted_earning_amount
  if (!currency) throw new Error('ACCEPTED_ORDER_PAYOUT_CURRENCY_INVALID')
  if (!Number.isSafeInteger(amount) || (amount ?? 0) <= 0) {
    throw new Error('ACCEPTED_ORDER_PAYOUT_AMOUNT_INVALID')
  }
  return { provider: 'STRIPE', currency, amount: amount! }
}

/** Fabric releases use the tailor-side payout currency and require a proven
 * transfer adapter. Unsupported snapshot providers never fall through to Stripe. */
export function acceptedFabricReleaseRoute(
  route: AcceptedOrderPayoutRoute | null,
  releaseCurrency: string | null | undefined,
): (Omit<AcceptedOrderPayoutRoute, 'provider'> & { provider: 'STRIPE' }) | null {
  if (!route) return null
  const currency = normalizeAccountCurrency(releaseCurrency)
  if (!currency || currency !== route.payoutCurrency) {
    throw new Error('FABRIC_RELEASE_CURRENCY_MISMATCH')
  }
  if (route.provider !== 'STRIPE') {
    throw new Error('FABRIC_RELEASE_PROVIDER_NOT_READY')
  }
  return { ...route, provider: 'STRIPE' }
}

/** Material-advance transfers share the order's pinned destination and payout
 * currency. Bachs remains blocked until its transfer adapter is proven. */
export function acceptedMaterialAdvanceReleaseRoute(
  route: AcceptedOrderPayoutRoute | null,
  releaseCurrency: string | null | undefined,
): (Omit<AcceptedOrderPayoutRoute, 'provider'> & { provider: 'STRIPE' }) | null {
  if (!route) return null
  const currency = normalizeAccountCurrency(releaseCurrency)
  if (!currency || currency !== route.payoutCurrency) {
    throw new Error('MATERIAL_ADVANCE_RELEASE_CURRENCY_MISMATCH')
  }
  if (route.provider !== 'STRIPE') {
    throw new Error('MATERIAL_ADVANCE_RELEASE_PROVIDER_NOT_READY')
  }
  return { ...route, provider: 'STRIPE' }
}

/**
 * Validates the immutable order destination against its current capability
 * record. A null result is reserved for legacy orders without a route snapshot;
 * incomplete snapshots never fall back to profile-bound provider fields.
 */
export function acceptedOrderPayoutRoute(
  order: AcceptedOrderPayoutSnapshot,
  destination: PayoutDestinationRecord | null,
): AcceptedOrderPayoutRoute | null {
  const route = acceptedOrderPayoutIdentity(order, destination)
  if (!route) return null
  if (!destination) throw new Error('ACCEPTED_ORDER_PAYOUT_SNAPSHOT_INCOMPLETE')

  if (
    destination.active !== true
    || destination.transfers_enabled !== true
    || destination.payouts_enabled !== true
    || destination.first_withdrawal_review_status !== 'CLEARED'
    || !destination.capability_checked_at
  ) throw new Error('ACCEPTED_ORDER_PAYOUT_DESTINATION_NOT_READY')

  return route
}

/**
 * Resolve immutable provider/destination identity without asserting that the
 * destination is currently eligible for a new transfer. Use only to reconcile
 * an already-started provider operation; new sends must use
 * `acceptedOrderPayoutRoute` and its fresh-capability gate.
 */
export function acceptedOrderPayoutIdentity(
  order: AcceptedOrderPayoutSnapshot,
  destination: PayoutDestinationRecord | null,
): AcceptedOrderPayoutRoute | null {
  if (!order.accepted_route_snapshot_at) return null

  const chargeCurrency = normalizeAccountCurrency(order.charge_currency_snapshot)
  const payoutCurrency = normalizeAccountCurrency(order.tailor_payout_currency_locked)
  const provider = order.charge_provider_snapshot
  if (
    !chargeCurrency
    || !payoutCurrency
    || (provider !== 'STRIPE' && provider !== 'BACHS')
    || !order.payout_destination_id
    || !order.tailor_profile_id
    || !order.legal_entity_snapshot
    || !destination
  ) throw new Error('ACCEPTED_ORDER_PAYOUT_SNAPSHOT_INCOMPLETE')

  if (
    destination.id !== order.payout_destination_id
    || destination.tailor_profile_id !== order.tailor_profile_id
    || destination.provider !== provider
    || destination.legal_entity !== order.legal_entity_snapshot
    || normalizeAccountCurrency(destination.currency) !== payoutCurrency
    || !destination.provider_account_ref.trim()
  ) throw new Error('ACCEPTED_ORDER_PAYOUT_DESTINATION_NOT_READY')

  return {
    provider,
    chargeCurrency,
    payoutCurrency,
    destinationId: destination.id,
    providerAccountRef: destination.provider_account_ref,
  }
}
