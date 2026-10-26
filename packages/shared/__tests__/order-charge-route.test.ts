import { acceptedOrderChargeRoute } from '../src/order-charge-route'

declare const describe: (name: string, fn: () => void) => void
declare const it: (name: string, fn: () => void) => void
declare const expect: (actual: unknown) => {
  toEqual(expected: unknown): void
  toBeNull(): void
  toThrow(message?: string): void
}

describe('acceptedOrderChargeRoute', () => {
  it('uses the snapshotted Stripe provider and currency', () => {
    expect(acceptedOrderChargeRoute({
      accepted_route_snapshot_at: '2026-10-25T12:00:00.000Z',
      charge_provider_snapshot: 'STRIPE',
      charge_currency_snapshot: 'USD',
    }, 'usd')).toEqual({ provider: 'STRIPE', currency: 'USD' })
  })

  it('returns null only for an order with no Phase 2 snapshot', () => {
    expect(acceptedOrderChargeRoute({ charge_currency_snapshot: 'NGN' }, 'NGN')).toBeNull()
  })

  it('fails closed on an incomplete accepted snapshot', () => {
    expect(() => acceptedOrderChargeRoute({
      accepted_route_snapshot_at: '2026-10-25T12:00:00.000Z',
      charge_provider_snapshot: 'STRIPE',
    })).toThrow('ACCEPTED_ORDER_ROUTE_SNAPSHOT_INVALID')
  })

  it('rejects a requested currency that differs from the accepted route', () => {
    expect(() => acceptedOrderChargeRoute({
      accepted_route_snapshot_at: '2026-10-25T12:00:00.000Z',
      charge_provider_snapshot: 'STRIPE',
      charge_currency_snapshot: 'USD',
    }, 'GBP')).toThrow('ORDER_CHARGE_CURRENCY_MISMATCH')
  })
})
