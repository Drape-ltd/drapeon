import assert from 'node:assert/strict'
import test from 'node:test'
import { isPayoutBlockResolutionAllowed } from './ops-payout-resolution-policy.mjs'

test('legacy payout blockers retain their reviewed resolution choices', () => {
  for (const mode of ['ORIGINAL_CURRENCY', 'CONVERT_TO_CURRENT', 'REFUND_CUSTOMER']) {
    assert.equal(isPayoutBlockResolutionAllowed({ hasAcceptedRouteSnapshot: false, mode }), true)
  }
})

test('accepted snapshot payout routes cannot be overridden by currency or provider inference', () => {
  assert.equal(isPayoutBlockResolutionAllowed({ hasAcceptedRouteSnapshot: true, mode: 'ORIGINAL_CURRENCY' }), false)
  assert.equal(isPayoutBlockResolutionAllowed({ hasAcceptedRouteSnapshot: true, mode: 'CONVERT_TO_CURRENT' }), false)
  assert.equal(isPayoutBlockResolutionAllowed({ hasAcceptedRouteSnapshot: true, mode: 'REFUND_CUSTOMER' }), true)
})

test('unknown modes fail closed', () => {
  assert.equal(isPayoutBlockResolutionAllowed({ hasAcceptedRouteSnapshot: false, mode: 'RETRY_ANYWAY' }), false)
})
