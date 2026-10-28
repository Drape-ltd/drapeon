import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { resolveWatchdogPayoutMoney } from './payout-watchdog.ts'

Deno.test('payout watchdog uses accepted earning, payout currency, and provider', () => {
  assertEquals(resolveWatchdogPayoutMoney({
    id: 'accepted-order',
    reference: 'DRA-1',
    stage: 'DELIVERED',
    order_kind: 'CUSTOM',
    tailor_id: 'tailor-1',
    customer_id: 'customer-1',
    accepted_route_snapshot_at: '2026-10-01T12:00:00.000Z',
    charge_provider_snapshot: 'BACHS',
    tailor_payout_provider_locked: null,
    tailor_payout_currency_locked: 'NGN',
    accepted_earning_amount: 725_000,
    currency: 'GBP',
    source_currency: 'GBP',
    source_amount: 1_000_000,
    subtotal_amount: 1_000_000,
    total_amount: 1_100_000,
    escrow_released: false,
    handoff_completed_at: null,
    customer_handoff_confirmed_at: '2026-10-01T12:00:00.000Z',
  }), {
    amount: 725_000,
    currency: 'NGN',
    provider: 'BACHS',
  })
})

Deno.test('incomplete accepted payout snapshot stays unknown instead of using legacy order fields', () => {
  assertEquals(resolveWatchdogPayoutMoney({
    id: 'incomplete-order',
    reference: 'DRA-2',
    stage: 'DELIVERED',
    order_kind: 'CUSTOM',
    tailor_id: 'tailor-1',
    customer_id: 'customer-1',
    accepted_route_snapshot_at: '2026-10-01T12:00:00.000Z',
    charge_provider_snapshot: null,
    tailor_payout_provider_locked: 'STRIPE',
    tailor_payout_currency_locked: null,
    accepted_earning_amount: null,
    currency: 'USD',
    source_currency: 'USD',
    source_amount: 20_000,
    subtotal_amount: 20_000,
    total_amount: 20_000,
    escrow_released: false,
    handoff_completed_at: null,
    customer_handoff_confirmed_at: '2026-10-01T12:00:00.000Z',
  }), {
    amount: null,
    currency: null,
    provider: null,
  })
})

Deno.test('legacy payout watchdog keeps its historical source fields and explicit provider lock', () => {
  assertEquals(resolveWatchdogPayoutMoney({
    id: 'legacy-order',
    reference: 'DRA-3',
    stage: 'DELIVERED',
    order_kind: 'CUSTOM',
    tailor_id: 'tailor-1',
    customer_id: 'customer-1',
    accepted_route_snapshot_at: null,
    charge_provider_snapshot: null,
    tailor_payout_provider_locked: 'STRIPE',
    tailor_payout_currency_locked: 'USD',
    accepted_earning_amount: null,
    currency: 'NGN',
    source_currency: 'USD',
    source_amount: 18_500,
    subtotal_amount: 20_000,
    total_amount: 22_000,
    escrow_released: false,
    handoff_completed_at: null,
    customer_handoff_confirmed_at: '2026-10-01T12:00:00.000Z',
  }), {
    amount: 18_500,
    currency: 'USD',
    provider: 'STRIPE',
  })
})
