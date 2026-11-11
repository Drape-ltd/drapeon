import { assertEquals } from 'jsr:@std/assert'
import { queryWithMarketplaceCategoryFallback } from './marketplace-schema-skew.ts'

Deno.test('tailoring retries without the optional marketplace column', async () => {
  let fallbackCalls = 0
  const result = await queryWithMarketplaceCategoryFallback(
    'TAILORING',
    async () => ({ data: null, error: { code: '42703', message: 'column marketplace_category does not exist' } }),
    async () => { fallbackCalls += 1; return { data: ['legacy tailor'], error: null } },
    [],
  )

  assertEquals(result, { data: ['legacy tailor'], error: null })
  assertEquals(fallbackCalls, 1)
})

Deno.test('streetwear returns an empty result when the marketplace column is absent', async () => {
  let fallbackCalls = 0
  const result = await queryWithMarketplaceCategoryFallback(
    'STREETWEAR',
    async () => ({ data: null, error: { code: 'PGRST204', message: 'schema cache missing marketplace_category' } }),
    async () => { fallbackCalls += 1; return { data: ['unfiltered tailor'], error: null } },
    [],
  )

  assertEquals(result, { data: [], error: null })
  assertEquals(fallbackCalls, 0)
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
