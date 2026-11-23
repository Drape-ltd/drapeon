import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createTailorLifecycleQuery, isMarketplaceCategoryColumnUnavailable, isTailorLifecycleStateColumnUnavailable, marketplaceProjection } from './marketplace-category-skew.mjs'

test('Ops Tailor Network reads legacy profiles when lifecycle_state is absent', async () => {
  let fallbackCalls = 0
  const result = await createTailorLifecycleQuery()(
    async () => ({ data: null, error: { code: '42703', message: 'column tailor_profiles.lifecycle_state does not exist' } }),
    async () => { fallbackCalls += 1; return { data: [{ id: 'tailor-1', display_name: 'Tailor' }], error: null } },
  )
  assert.deepEqual(result.data.map((profile) => profile.display_name), ['Tailor'])
  assert.equal(fallbackCalls, 1)
  const source = await readFile(new URL('./remaining-domain-data.ts', import.meta.url), 'utf8')
  assert.match(source, /const profiles = await queryWithTailorLifecycleFallback/u)
})

test('Ops lifecycle fallback accepts only the exact missing-column error', async () => {
  assert.equal(isTailorLifecycleStateColumnUnavailable({ code: 'PGRST204', message: "Could not find the 'lifecycle_state' column of 'tailor_profiles' in the schema cache" }), true)
  assert.equal(isTailorLifecycleStateColumnUnavailable({ code: '42703', message: 'column payout_status does not exist' }), false)
  let fallbackCalls = 0
  const failure = { code: '08006', message: 'connection failed' }
  const result = await createTailorLifecycleQuery()(
    async () => ({ data: null, error: failure }),
    async () => { fallbackCalls += 1; return { data: [], error: null } },
  )
  assert.equal(result.error, failure)
  assert.equal(fallbackCalls, 0)
})

test('Ops caches the missing lifecycle column and re-probes after its interval', async () => {
  let now = 100
  let probes = 0
  let legacyReads = 0
  let columnExists = false
  const query = createTailorLifecycleQuery(60, () => now)
  const read = () => query(
    async () => {
      probes += 1
      return columnExists
        ? { data: ['filtered tailor'], error: null }
        : { data: null, error: { code: '42703', message: 'column tailor_profiles.lifecycle_state does not exist' } }
    },
    async () => { legacyReads += 1; return { data: ['legacy tailor'], error: null } },
  )
  assert.deepEqual((await read()).data, ['legacy tailor'])
  now = 159
  assert.deepEqual((await read()).data, ['legacy tailor'])
  assert.deepEqual([probes, legacyReads], [1, 2])
  columnExists = true
  now = 160
  assert.deepEqual((await read()).data, ['filtered tailor'])
  assert.deepEqual([probes, legacyReads], [2, 2])
  assert.deepEqual((await read()).data, ['filtered tailor'])
  assert.deepEqual([probes, legacyReads], [3, 2])
})
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
