import { acceptedFabricReleaseRoute, acceptedMaterialAdvanceReleaseRoute, acceptedOrderPayoutIdentity, acceptedOrderPayoutMoney, acceptedOrderPayoutProvider, acceptedOrderPayoutRoute, resolveOrderChargeProvider, resolveOrderPayoutProvider, type AcceptedOrderPayoutSnapshot, type PayoutDestinationRecord } from '../src/order-payout-route'

declare const describe: (name: string, fn: () => void) => void
declare const it: (name: string, fn: () => void) => void
declare const expect: (actual: unknown) => {
  toEqual(expected: unknown): void
  toBeNull(): void
  toThrow(message?: string): void
}

describe('acceptedOrderPayoutRoute', () => {
  const order: AcceptedOrderPayoutSnapshot = {
    accepted_route_snapshot_at: '2026-10-25T12:00:00.000Z',
    charge_provider_snapshot: 'STRIPE',
    charge_currency_snapshot: 'USD',
    legal_entity_snapshot: 'O4_GROUP_LLC',
    payout_destination_id: 'destination-1',
    tailor_profile_id: 'profile-1',
    tailor_payout_currency_locked: 'USD',
  }
  const destination: PayoutDestinationRecord = {
    id: 'destination-1',
    tailor_profile_id: 'profile-1',
    provider: 'STRIPE',
    legal_entity: 'O4_GROUP_LLC',
    currency: 'USD',
    provider_account_ref: 'acct_test_1',
    transfers_enabled: true,
    payouts_enabled: true,
    fees_collector: 'PLATFORM',
    first_withdrawal_review_status: 'CLEARED',
    active: true,
    capability_checked_at: '2026-10-25T12:00:00.000Z',
  }

  it('returns the accepted provider and provider-neutral destination', () => {
    expect(acceptedOrderPayoutRoute(order, destination)).toEqual({
      provider: 'STRIPE',
      chargeCurrency: 'USD',
      payoutCurrency: 'USD',
      destinationId: 'destination-1',
      providerAccountRef: 'acct_test_1',
    })
  })

  it('allows legacy callers to keep their historical path', () => {
    expect(acceptedOrderPayoutRoute({}, null)).toBeNull()
  })

  it('returns the accepted provider for monitoring without inferring it for legacy or invalid snapshots', () => {
    expect(acceptedOrderPayoutProvider(order)).toEqual('STRIPE')
    expect(acceptedOrderPayoutProvider({ ...order, charge_provider_snapshot: 'BACHS' })).toEqual('BACHS')
    expect(acceptedOrderPayoutProvider({ ...order, charge_provider_snapshot: null })).toBeNull()
    expect(acceptedOrderPayoutProvider({})).toBeNull()
  })

  it('uses the accepted charge provider instead of a contradictory legacy currency route', () => {
    expect(resolveOrderChargeProvider({ ...order, charge_currency_snapshot: 'NGN' }, 'PAYSTACK'))
      .toEqual('STRIPE')
    expect(resolveOrderChargeProvider({ ...order, charge_provider_snapshot: 'BACHS' }, 'PAYSTACK'))
      .toEqual('BACHS')
    expect(resolveOrderChargeProvider({}, 'PAYSTACK')).toEqual('PAYSTACK')
    expect(resolveOrderChargeProvider({}, 'STRIPE')).toEqual('STRIPE')
    expect(resolveOrderChargeProvider({}, null)).toBeNull()
    expect(resolveOrderChargeProvider({}, null, 'STRIPE')).toEqual('STRIPE')
    expect(resolveOrderChargeProvider({ ...order, charge_provider_snapshot: null }, 'PAYSTACK')).toBeNull()
    expect(resolveOrderChargeProvider({ ...order, charge_provider_snapshot: null }, null, 'PAYSTACK')).toBeNull()
  })

  it('uses only the payout provider persisted on legacy orders, never currency', () => {
    expect(resolveOrderPayoutProvider({ tailor_payout_provider_locked: 'PAYSTACK' })).toEqual('PAYSTACK')
    expect(resolveOrderPayoutProvider({ tailor_payout_provider_locked: 'STRIPE' })).toEqual('STRIPE')
    expect(resolveOrderPayoutProvider({})).toBeNull()
    expect(resolveOrderPayoutProvider({ ...order, charge_provider_snapshot: 'BACHS', tailor_payout_provider_locked: 'STRIPE' })).toBeNull()
  })

  it('fails closed when a snapshot destination is missing', () => {
    expect(() => acceptedOrderPayoutRoute(order, null)).toThrow('ACCEPTED_ORDER_PAYOUT_SNAPSHOT_INCOMPLETE')
  })

  it('does not fall back when the destination capability is lost', () => {
    expect(() => acceptedOrderPayoutRoute(order, { ...destination, payouts_enabled: false }))
      .toThrow('ACCEPTED_ORDER_PAYOUT_DESTINATION_NOT_READY')
  })

  it('keeps checkout and payout release closed until the first-release review is cleared', () => {
    expect(() =>
      acceptedOrderPayoutRoute(order, {
        ...destination,
        first_withdrawal_review_status: 'PENDING',
        active: false,
      })
    ).toThrow('ACCEPTED_ORDER_PAYOUT_DESTINATION_NOT_READY')
  })

  it('preserves the immutable destination identity for reconciling an existing payout after capability loss', () => {
    const unavailable = { ...destination, active: false, payouts_enabled: false, capability_checked_at: null }
    expect(acceptedOrderPayoutIdentity(order, unavailable)).toEqual({
      provider: 'STRIPE',
      chargeCurrency: 'USD',
      payoutCurrency: 'USD',
      destinationId: 'destination-1',
      providerAccountRef: 'acct_test_1',
    })
    expect(() => acceptedOrderPayoutRoute(order, unavailable))
      .toThrow('ACCEPTED_ORDER_PAYOUT_DESTINATION_NOT_READY')
  })

  it('rejects a destination that no longer matches the order snapshot', () => {
    expect(() => acceptedOrderPayoutRoute(order, { ...destination, id: 'another-destination' }))
      .toThrow('ACCEPTED_ORDER_PAYOUT_DESTINATION_NOT_READY')
  })

  it('uses the accepted earning and locked payout currency rather than current profile values', () => {
    expect(acceptedOrderPayoutMoney({ ...order, accepted_earning_amount: 12_345 }))
      .toEqual({ provider: 'STRIPE', currency: 'USD', amount: 12_345 })
  })

  it('fails closed for a payout provider without a completed release adapter', () => {
    expect(() => acceptedOrderPayoutMoney({
      ...order,
      charge_provider_snapshot: 'BACHS',
      accepted_earning_amount: 12_345,
    })).toThrow('ACCEPTED_ORDER_PAYOUT_PROVIDER_NOT_READY')
  })

  it('pins fabric releases to the snapshotted tailor currency and supported provider', () => {
    const route = acceptedOrderPayoutRoute(order, destination)
    expect(acceptedFabricReleaseRoute(route, 'usd')).toEqual(route)
    expect(() => acceptedFabricReleaseRoute(route, 'GBP')).toThrow('FABRIC_RELEASE_CURRENCY_MISMATCH')
    expect(() => acceptedFabricReleaseRoute({ ...route!, provider: 'BACHS' }, 'USD'))
      .toThrow('FABRIC_RELEASE_PROVIDER_NOT_READY')
    expect(acceptedFabricReleaseRoute(null, 'USD')).toBeNull()
  })

  it('pins material-advance releases to the snapshotted tailor currency and supported provider', () => {
    const route = acceptedOrderPayoutRoute(order, destination)
    expect(acceptedMaterialAdvanceReleaseRoute(route, 'usd')).toEqual(route)
    expect(() => acceptedMaterialAdvanceReleaseRoute(route, 'GBP'))
      .toThrow('MATERIAL_ADVANCE_RELEASE_CURRENCY_MISMATCH')
    expect(() => acceptedMaterialAdvanceReleaseRoute({ ...route!, provider: 'BACHS' }, 'USD'))
      .toThrow('MATERIAL_ADVANCE_RELEASE_PROVIDER_NOT_READY')
    expect(acceptedMaterialAdvanceReleaseRoute(null, 'USD')).toBeNull()
  })
})
