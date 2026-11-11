import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { isMarketplaceCategoryColumnUnavailable, marketplaceProjection } from './marketplace-category-skew.mjs'
test('Ops renders tailoring with no history when the category schema is absent', () => {
  assert.deepEqual(marketplaceProjection(
    { data: null, error: { code: '42703', message: 'column tailor_profiles.marketplace_category does not exist' } },
    { data: null, error: { code: '42P01', message: 'relation "public.marketplace_category_decisions" does not exist' } },
  ), { supported: false, category: 'TAILORING', decisions: [] })
})

test('Ops does not hide category support for unrelated column errors or broad text matches', () => {
  assert.equal(isMarketplaceCategoryColumnUnavailable({ code: '42703', message: 'column payout_status does not exist' }), false)
  assert.equal(isMarketplaceCategoryColumnUnavailable({ code: 'FETCH_ERROR', message: 'https://db.example/marketplace_category' }), false)
  assert.equal(isMarketplaceCategoryColumnUnavailable({ code: 'PGRST204', message: "Could not find the 'marketplace_category' column of 'tailor_profiles' in the schema cache" }), true)
  assert.throws(() => marketplaceProjection(
    { data: null, error: { code: '42703', message: 'column payout_status does not exist' } },
    { data: [], error: null },
  ))
})

test('Ops does not hide an unrelated category failure when decision history is absent', () => {
  assert.throws(() => marketplaceProjection(
    { data: null, error: { code: 'FETCH_ERROR', message: 'https://db.example/marketplace_category request failed' } },
    { data: null, error: { code: '42P01', message: 'relation "public.marketplace_category_decisions" does not exist' } },
  ))
})

test('Ops category reads are scoped to the profiles returned by the page query', async () => {
  const sources = await Promise.all([
    readFile(new URL('./remaining-domain-data.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../../supabase/functions/_shared/ops-read-projections.ts', import.meta.url), 'utf8'),
  ])
  for (const source of sources) {
    assert.match(source, /select\('id,marketplace_category'\)\.in\('id', profileIds\)/u)
    assert.doesNotMatch(source, /select\('id,marketplace_category'\)\.limit\(200\)/u)
  }
})
