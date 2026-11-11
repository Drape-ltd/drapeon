import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isMarketplaceSchemaUnavailable,
  marketplaceCategoriesForUi,
  marketplaceCategoryFromOptionalResult,
  marketplaceSearchSchemaFallback,
} from './marketplace-schema-skew'

test('mobile treats a missing marketplace column as old-schema compatibility', () => {
  assert.equal(isMarketplaceSchemaUnavailable({ code: '42703', message: 'column marketplace_category does not exist' }), true)
  assert.equal(isMarketplaceSchemaUnavailable({ code: '23505', message: 'duplicate' }), false)
  assert.equal(isMarketplaceSchemaUnavailable({ code: '42703', message: 'column payout_status does not exist' }), false)
  assert.equal(isMarketplaceSchemaUnavailable({ code: 'FETCH_ERROR', message: 'request to /marketplace_category failed' }), false)
  assert.equal(isMarketplaceSchemaUnavailable({ code: 'PGRST202', message: 'marketplace_category RPC missing' }), false)
  assert.equal(isMarketplaceSchemaUnavailable({ code: 'PGRST204', message: "Could not find the 'marketplace_category' column of 'tailor_profiles' in the schema cache" }), true)
})

test('mobile preserves the server category when the optional read succeeds', () => {
  assert.equal(marketplaceCategoryFromOptionalResult({ data: { marketplace_category: 'STREETWEAR' } }), 'STREETWEAR')
  assert.equal(marketplaceCategoryFromOptionalResult({ error: { code: '42703', message: 'column marketplace_category does not exist' } }), 'TAILORING')
})

test('mobile hides Streetwear until the read gateway advertises the category', () => {
  assert.deepEqual(marketplaceCategoriesForUi(undefined), ['TAILORING'])
  assert.deepEqual(marketplaceCategoriesForUi({ categories: ['TAILORING'] }), ['TAILORING'])
  assert.deepEqual(marketplaceCategoriesForUi({ categories: ['TAILORING', 'STREETWEAR'] }), ['TAILORING', 'STREETWEAR'])
})

test('mobile Streetwear search fails closed when Production lacks the category column', () => {
  const missingColumn = { code: '42703', message: 'column marketplace_category does not exist' }
  assert.equal(marketplaceSearchSchemaFallback(missingColumn, 'STREETWEAR'), 'empty')
  assert.equal(marketplaceSearchSchemaFallback(missingColumn, 'TAILORING'), 'legacy_tailoring')
  assert.equal(marketplaceSearchSchemaFallback({ code: 'PGRST202' }, 'STREETWEAR'), 'error')
  assert.equal(marketplaceSearchSchemaFallback({ code: '08006', message: 'connection failed' }, 'STREETWEAR'), 'error')
})
