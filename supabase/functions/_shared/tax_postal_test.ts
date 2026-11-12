import { assertEquals, assertRejects } from 'jsr:@std/assert'
import { resolveOrderTax, TaxResolutionError } from './tax.ts'

Deno.test('free-text digits never substitute for a missing structured US ZIP', async () => {
  const originalFetch = globalThis.fetch
  let fetchCalls = 0
  globalThis.fetch = (() => {
    fetchCalls += 1
    throw new Error('ZipTax must not be called')
  }) as typeof fetch

  try {
    const error = await assertRejects(
      () => resolveOrderTax({
        supabase: {} as never,
        currency: 'USD',
        countryCode: 'US',
        address: '12345 Main St, Austin TX',
        postalCode: null,
        stateRegion: 'TX',
      }),
      TaxResolutionError,
    )
    assertEquals(error.code, 'DELIVERY_POSTAL_CODE_REQUIRED')
    assertEquals(fetchCalls, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})
