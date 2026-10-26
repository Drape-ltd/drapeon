import assert from 'node:assert/strict'
import test from 'node:test'
import { countMatchingActiveDestinations } from './payment-route-readiness.mjs'

const route = {
  provider: 'STRIPE',
  legal_entity: 'O4_GROUP_LLC',
  tailor_country_code: 'US',
  payout_currency: 'USD',
  fees_collector: 'PLATFORM',
}

const capableDestination = {
  provider: 'STRIPE',
  legal_entity: 'O4_GROUP_LLC',
  country_code: 'US',
  currency: 'USD',
  fees_collector: 'PLATFORM',
  active: true,
  transfers_enabled: true,
  payouts_enabled: true,
  first_withdrawal_review_status: 'CLEARED',
}

test('counts only exact, active, fully reviewed payout destinations', () => {
  assert.equal(countMatchingActiveDestinations(route, [
    capableDestination,
    { ...capableDestination, transfers_enabled: false },
    { ...capableDestination, first_withdrawal_review_status: 'PENDING' },
    { ...capableDestination, fees_collector: 'CONNECTED_ACCOUNT' },
    { ...capableDestination, currency: 'EUR' },
  ]), 1)
})

test('missing and incomplete destination evidence never counts as ready', () => {
  assert.equal(countMatchingActiveDestinations(route, []), 0)
  assert.equal(countMatchingActiveDestinations(route, [{ ...capableDestination, active: false }]), 0)
})
