import { normalizeAccountCurrency, type AccountCurrencyCode } from './currency-config'

export type AcceptedOrderPayoutSnapshot = {
  accepted_route_snapshot_at?: string | null
  charge_provider_snapshot?: string | null
  charge_currency_snapshot?: string | null
  legal_entity_snapshot?: string | null
  payout_destination_id?: string | null
  tailor_profile_id?: string | null
  tailor_payout_currency_locked?: string | null
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

/**
 * Validates the immutable order destination against its current capability
 * record. A null result is reserved for legacy orders without a route snapshot;
 * incomplete snapshots never fall back to profile-bound provider fields.
 */
export function acceptedOrderPayoutRoute(
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
    || destination.active !== true
    || destination.transfers_enabled !== true
    || destination.payouts_enabled !== true
    || destination.first_withdrawal_review_status !== 'CLEARED'
    || !destination.capability_checked_at
  ) throw new Error('ACCEPTED_ORDER_PAYOUT_DESTINATION_NOT_READY')

  return {
    provider,
    chargeCurrency,
    payoutCurrency,
    destinationId: destination.id,
    providerAccountRef: destination.provider_account_ref,
  }
}
