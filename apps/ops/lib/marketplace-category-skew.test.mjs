import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { marketplaceProjection } from './marketplace-category-skew.mjs'
test('Ops renders tailoring with no history when the category schema is absent', () => {
  assert.deepEqual(marketplaceProjection({ data: null, error: { code: '42703' } }, { data: null, error: { code: '42P01' } }), { supported: false, category: 'TAILORING', decisions: [] })
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
