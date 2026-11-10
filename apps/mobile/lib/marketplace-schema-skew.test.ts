import assert from 'node:assert/strict'
import test from 'node:test'
import { isMarketplaceSchemaUnavailable, marketplaceCategoryFromOptionalResult } from './marketplace-schema-skew'

test('mobile treats a missing marketplace column as old-schema compatibility', () => {
  assert.equal(isMarketplaceSchemaUnavailable({ code: '42703', message: 'column marketplace_category does not exist' }), true)
  assert.equal(isMarketplaceSchemaUnavailable({ code: '23505', message: 'duplicate' }), false)
})

test('mobile preserves the server category when the optional read succeeds', () => {
  assert.equal(marketplaceCategoryFromOptionalResult({ data: { marketplace_category: 'STREETWEAR' } }), 'STREETWEAR')
  assert.equal(marketplaceCategoryFromOptionalResult({ error: { code: '42703' } }), 'TAILORING')
})
