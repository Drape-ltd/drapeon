import { normalizeAccountCurrency, type AccountCurrencyCode } from './currency-config'

export type AcceptedOrderChargeRoute = {
  provider: 'STRIPE' | 'BACHS'
  currency: AccountCurrencyCode
}

export type OrderChargeRouteSnapshot = {
  accepted_route_snapshot_at?: string | null
  charge_provider_snapshot?: string | null
  charge_currency_snapshot?: string | null
}

/**
 * Returns the immutable charge route for a Phase 2 accepted order. `null` means
 * the order is legacy and callers may use their documented historical path.
 * A partial or malformed snapshot is an error, never a reason to fall back.
 */
export function acceptedOrderChargeRoute(
  order: OrderChargeRouteSnapshot,
  requestedCurrency?: string | null,
): AcceptedOrderChargeRoute | null {
  if (!order.accepted_route_snapshot_at) return null

  const provider = order.charge_provider_snapshot
  const currency = normalizeAccountCurrency(order.charge_currency_snapshot)
  if ((provider !== 'STRIPE' && provider !== 'BACHS') || !currency) {
    throw new Error('ACCEPTED_ORDER_ROUTE_SNAPSHOT_INVALID')
  }

  if (requestedCurrency !== undefined) {
    const requested = normalizeAccountCurrency(requestedCurrency)
    if (!requested || requested !== currency) {
      throw new Error('ORDER_CHARGE_CURRENCY_MISMATCH')
    }
  }

  return { provider, currency }
}
