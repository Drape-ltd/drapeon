import assert from 'node:assert/strict'
import test from 'node:test'
import { marketplaceCategoryFromGatewayResponse, marketplaceCategoryReported } from '../marketplace-category-skew'

test('web renders the legacy Tailoring state when the gateway has no new-schema value', () => {
  assert.equal(marketplaceCategoryFromGatewayResponse({ data: { profile: {} } }), 'TAILORING')
  assert.equal(marketplaceCategoryFromGatewayResponse(null), 'TAILORING')
})

test('web uses Ready-to-wear when the gateway exposes it, including the pre-rename value', () => {
  assert.equal(marketplaceCategoryFromGatewayResponse({ data: { profile: { marketplaceCategory: 'READY_TO_WEAR' } } }), 'READY_TO_WEAR')
  assert.equal(marketplaceCategoryFromGatewayResponse({ data: { profile: { marketplaceCategory: 'STREETWEAR' } } }), 'READY_TO_WEAR')
})

test('web knows when the gateway did not report a placement', () => {
  assert.equal(marketplaceCategoryReported({ data: { profile: {} } }), false)
  assert.equal(marketplaceCategoryReported(null), false)
  assert.equal(marketplaceCategoryReported({ data: { profile: { marketplaceCategory: 'TAILORING' } } }), true)
})
