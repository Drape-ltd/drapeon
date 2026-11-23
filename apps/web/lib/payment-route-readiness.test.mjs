import assert from 'node:assert/strict'
import test from 'node:test'
import {
  countMatchingActiveDestinations,
  summarizeMatchingDestinations,
} from './payment-route-readiness.mjs'

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
  capability_checked_at: '2026-10-26T12:00:00.000Z',
}

test('counts only exact, active, fully reviewed payout destinations', () => {
  assert.equal(
    countMatchingActiveDestinations(route, [
      capableDestination,
      { ...capableDestination, transfers_enabled: false },
      { ...capableDestination, first_withdrawal_review_status: 'PENDING' },
      { ...capableDestination, fees_collector: 'CONNECTED_ACCOUNT' },
      { ...capableDestination, currency: 'EUR' },
    ]),
    1
  )
})

test('missing and incomplete destination evidence never counts as ready', () => {
  assert.equal(countMatchingActiveDestinations(route, []), 0)
  assert.equal(
    countMatchingActiveDestinations(route, [{ ...capableDestination, active: false }]),
    0
  )
})

test('summarizes route-matching blockers without exposing destination identity', () => {
  const summary = summarizeMatchingDestinations(route, [
    capableDestination,
    { ...capableDestination, first_withdrawal_review_status: 'PENDING', active: false },
    {
      ...capableDestination,
      first_withdrawal_review_status: 'BLOCKED',
      active: false,
      transfers_enabled: false,
    },
    { ...capableDestination, active: false, payouts_enabled: false, capability_checked_at: null },
  ])

  assert.deepEqual(summary, {
    matchingCount: 4,
    readyCount: 1,
    reviewPendingCount: 1,
    reviewBlockedCount: 1,
    inactiveCount: 3,
    transfersUnavailableCount: 1,
    payoutsUnavailableCount: 1,
    capabilityCheckMissingCount: 1,
  })
})

test('missing capability-check time is a readiness blocker', () => {
  const summary = summarizeMatchingDestinations(route, [
    { ...capableDestination, capability_checked_at: null },
  ])

  assert.equal(summary.readyCount, 0)
  assert.equal(summary.capabilityCheckMissingCount, 1)
})
