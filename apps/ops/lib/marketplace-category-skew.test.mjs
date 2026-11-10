import assert from 'node:assert/strict'
import test from 'node:test'
import { marketplaceProjection } from './marketplace-category-skew.mjs'
test('Ops renders tailoring with no history when the category schema is absent', () => {
  assert.deepEqual(marketplaceProjection({ data: null, error: { code: '42703' } }, { data: null, error: { code: '42P01' } }), { supported: false, category: 'TAILORING', decisions: [] })
})
