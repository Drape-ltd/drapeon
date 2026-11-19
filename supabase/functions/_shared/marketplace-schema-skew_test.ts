import { assertEquals } from 'jsr:@std/assert'
import {
  marketplaceCategoryCapabilities,
  isMarketplaceCategoryDecisionsTableUnavailable,
  isMarketplaceCategorySchemaUnavailable,
  isTailorLifecycleStateSchemaUnavailable,
  queryWithMarketplaceCategoryFallback,
  queryWithTailorLifecycleFallback,
} from './marketplace-schema-skew.ts'

Deno.test('legacy Explore retries without lifecycle_state and preserves category filtering', async () => {
  let legacyCalls = 0
  const result = await queryWithTailorLifecycleFallback(
    () => queryWithMarketplaceCategoryFallback(
      'TAILORING',
      async () => ({ data: null, error: { code: '42703', message: 'column tailor_profiles.lifecycle_state does not exist' } }),
      async () => ({ data: ['must not be returned'], error: null }),
      [],
    ),
    () => queryWithMarketplaceCategoryFallback(
      'TAILORING',
      async () => { legacyCalls += 1; return { data: ['live tailor'], error: null } },
      async () => ({ data: ['unfiltered tailor'], error: null }),
      [],
    ),
  )
  assertEquals(result, { data: ['live tailor'], error: null })
  assertEquals(legacyCalls, 1)
})

Deno.test('a missing marketplace category still hides Ready-made on the legacy schema', async () => {
  const result = await queryWithTailorLifecycleFallback(
    () => queryWithMarketplaceCategoryFallback(
      'READY_TO_WEAR',
      async () => ({ data: null, error: { code: '42703', message: 'column marketplace_category does not exist' } }),
      async () => ({ data: ['must not be returned'], error: null }),
      [],
    ),
    async () => ({ data: ['must not be returned'], error: null }),
  )
  assertEquals(result, { data: [], error: null, schemaFallback: true })
})

Deno.test('lifecycle fallback only accepts the exact missing tailor column error', async () => {
  assertEquals(isTailorLifecycleStateSchemaUnavailable({ code: '42703', message: 'column tailor_profiles.lifecycle_state does not exist' }), true)
  assertEquals(isTailorLifecycleStateSchemaUnavailable({ code: 'PGRST204', message: "Could not find the 'lifecycle_state' column of 'tailor_profiles' in the schema cache" }), true)
  assertEquals(isTailorLifecycleStateSchemaUnavailable({ code: '42703', message: 'column payout_status does not exist' }), false)
  assertEquals(isTailorLifecycleStateSchemaUnavailable({ code: 'FETCH_ERROR', message: 'https://db.example/lifecycle_state failed' }), false)
  const failure = { code: '08006', message: 'connection failed' }
  const result = await queryWithTailorLifecycleFallback(
    async () => ({ data: null, error: failure }),
    async () => ({ data: ['must not be returned'], error: null }),
  )
  assertEquals(result, { data: null, error: failure })
})

Deno.test('tailoring retries without the optional marketplace column', async () => {
  let fallbackCalls = 0
  const result = await queryWithMarketplaceCategoryFallback(
    'TAILORING',
    async () => ({ data: null, error: { code: '42703', message: 'column marketplace_category does not exist' } }),
    async () => { fallbackCalls += 1; return { data: ['legacy tailor'], error: null } },
    [],
  )

  assertEquals(result, { data: ['legacy tailor'], error: null, schemaFallback: true })
  assertEquals(fallbackCalls, 1)
})

Deno.test('Ready-made returns an empty result when the marketplace column is absent', async () => {
  let fallbackCalls = 0
  const result = await queryWithMarketplaceCategoryFallback(
    'READY_TO_WEAR',
    async () => ({ data: null, error: { code: 'PGRST204', message: 'column marketplace_category does not exist' } }),
    async () => { fallbackCalls += 1; return { data: ['unfiltered tailor'], error: null } },
    [],
  )

  assertEquals(result, { data: [], error: null, schemaFallback: true })
  assertEquals(fallbackCalls, 0)
})

Deno.test('an unrelated missing column on Ready-made remains an error', async () => {
  const failure = { code: '42703', message: 'column payout_status does not exist' }
  const result = await queryWithMarketplaceCategoryFallback(
    'READY_TO_WEAR',
    async () => ({ data: null, error: failure }),
    async () => ({ data: ['must not be returned'], error: null }),
    [],
  )

  assertEquals(result, { data: null, error: failure })
})

for (const category of ['TAILORING', 'READY_TO_WEAR'] as const) {
  Deno.test(`a network error mentioning marketplace_category remains an error for ${category}`, async () => {
    const failure = { code: 'FETCH_ERROR', message: 'Network request failed: https://db.example/rest/v1/marketplace_category' }
    const result = await queryWithMarketplaceCategoryFallback(
      category,
      async () => ({ data: null, error: failure }),
      async () => ({ data: ['must not be returned'], error: null }),
      [],
    )

    assertEquals(result, { data: null, error: failure })
  })
}

Deno.test('category capabilities advertise Ready-made only when the schema is available', () => {
  assertEquals(marketplaceCategoryCapabilities(true), { categories: ['TAILORING', 'READY_TO_WEAR'] })
  assertEquals(marketplaceCategoryCapabilities(false), { categories: ['TAILORING'] })
})

Deno.test('only an exact missing marketplace_category column error qualifies for fallback', () => {
  assertEquals(isMarketplaceCategorySchemaUnavailable({ code: '42703', message: 'column tailor_profiles.marketplace_category does not exist' }), true)
  assertEquals(isMarketplaceCategorySchemaUnavailable({ code: '42703', message: 'column payout_status does not exist' }), false)
  assertEquals(isMarketplaceCategorySchemaUnavailable({ code: '42P01', message: 'relation marketplace_category does not exist' }), false)
  assertEquals(isMarketplaceCategorySchemaUnavailable({ code: 'PGRST205', message: 'Could not find table marketplace_category in the schema cache' }), false)
  assertEquals(isMarketplaceCategorySchemaUnavailable({ code: 'PGRST204', message: "Could not find the 'marketplace_category' column of 'tailor_profiles' in the schema cache" }), true)
  assertEquals(isMarketplaceCategorySchemaUnavailable({ message: 'column marketplace_category does not exist' }), false)
})

Deno.test('Ops can separately recognize only a missing category-decisions relation', () => {
  assertEquals(isMarketplaceCategoryDecisionsTableUnavailable({ code: '42P01', message: 'relation "public.marketplace_category_decisions" does not exist' }), true)
  assertEquals(isMarketplaceCategoryDecisionsTableUnavailable({ code: 'PGRST205', message: "Could not find the table 'public.marketplace_category_decisions' in the schema cache" }), true)
  assertEquals(isMarketplaceCategoryDecisionsTableUnavailable({ code: '42P01', message: 'relation users does not exist' }), false)
  assertEquals(isMarketplaceCategoryDecisionsTableUnavailable({ message: 'marketplace_category_decisions' }), false)
})

Deno.test('non-schema errors remain errors', async () => {
  const failure = { code: '08006', message: 'connection failed' }
  const result = await queryWithMarketplaceCategoryFallback(
    'TAILORING',
    async () => ({ data: null, error: failure }),
    async () => ({ data: ['legacy tailor'], error: null }),
    [],
  )

  assertEquals(result, { data: null, error: failure })
})
