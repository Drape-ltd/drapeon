import { assertEquals, assertThrows } from 'jsr:@std/assert'
import { applyMarketplaceCategoryFilter, placementErrorFromMessage, resolveMarketplaceCategory } from './marketplace-category.ts'

Deno.test('marketplace category defaults to tailoring', () => assertEquals(resolveMarketplaceCategory(undefined), 'TAILORING'))
Deno.test('marketplace category rejects unknown values', () => {
  assertThrows(() => resolveMarketplaceCategory('SHOES'), Error, 'INVALID_MARKETPLACE_CATEGORY')
})
Deno.test('marketplace category applies a server-side profile filter', () => {
  const calls: Array<[string, string]> = []
  const builder = { eq(column: string, value: string) { calls.push([column, value]); return this } }
  assertEquals(applyMarketplaceCategoryFilter(builder, 'streetwear'), builder)
  assertEquals(calls, [['marketplace_category', 'READY_TO_WEAR']])
})

Deno.test('placement database errors become a code and a user-facing message', () => {
  assertEquals(
    placementErrorFromMessage('PLACEMENT_REQUIRES_CUSTOM_ORDERS: This shop is listed in Tailors, which requires custom orders.'),
    { code: 'PLACEMENT_REQUIRES_CUSTOM_ORDERS', message: 'This shop is listed in Tailors, which requires custom orders.' },
  )
  assertEquals(placementErrorFromMessage('duplicate key value violates unique constraint'), null)
  assertEquals(placementErrorFromMessage(undefined), null)
})
