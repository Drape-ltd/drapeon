import assert from 'node:assert/strict'
import test from 'node:test'
import { stagedReleaseBreakdownForOrder } from './money-history-staged-breakdown'

test('C1 shows the released and pending split when it equals total order earnings', () => {
  assert.deepEqual(stagedReleaseBreakdownForOrder({
    status: 'IN_PROVIDER_BALANCE',
    netAmount: 12000,
    netCurrency: 'USD',
    summary: { currency: 'USD', total: 12000, inProviderBalance: 8400, pending: 3600 },
  }), { currency: 'USD', inProviderBalance: 8400, pending: 3600 })
})

test('a ready tranche makes the two-part split incomplete', () => {
  assert.equal(stagedReleaseBreakdownForOrder({
    status: 'IN_PROVIDER_BALANCE',
    netAmount: 12000,
    netCurrency: 'USD',
    summary: { currency: 'USD', total: 12000, inProviderBalance: 8400, pending: 2400 },
  }), null)
})

test('a different currency cannot be presented as the order split', () => {
  assert.equal(stagedReleaseBreakdownForOrder({
    status: 'IN_PROVIDER_BALANCE',
    netAmount: 12000,
    netCurrency: 'USD',
    summary: { currency: 'NGN', total: 12000, inProviderBalance: 8400, pending: 3600 },
  }), null)
})
