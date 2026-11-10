import assert from 'node:assert/strict'
import test from 'node:test'
import { marketplaceCategoryFromGatewayResponse } from '../marketplace-category-skew'

test('web renders the legacy Tailoring state when the gateway has no new-schema value', () => {
  assert.equal(marketplaceCategoryFromGatewayResponse({ data: { profile: {} } }), 'TAILORING')
  assert.equal(marketplaceCategoryFromGatewayResponse(null), 'TAILORING')
})

test('web uses Streetwear when the gateway exposes it', () => {
  assert.equal(marketplaceCategoryFromGatewayResponse({ data: { profile: { marketplaceCategory: 'STREETWEAR' } } }), 'STREETWEAR')
})
