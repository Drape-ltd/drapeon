import { assertEquals, assertThrows } from 'jsr:@std/assert'
import { marketplaceProjection } from './ops-read-projections.ts'

Deno.test('Ops hides category controls and history when the category column is absent', () => {
  assertEquals(marketplaceProjection(
    { data: null, error: { code: '42703', message: 'column tailor_profiles.marketplace_category does not exist' } },
    { data: null, error: { code: '42P01', message: 'relation "public.marketplace_category_decisions" does not exist' } },
  ), { supported: false, category: 'TAILORING', decisions: [] })
})

Deno.test('Ops does not hide controls for unrelated missing columns', () => {
  assertThrows(() => marketplaceProjection(
    { data: null, error: { code: '42703', message: 'column payout_status does not exist' } },
    { data: [], error: null },
  ))
})

Deno.test('Ops does not hide an unrelated category failure when decision history is absent', () => {
  assertThrows(() => marketplaceProjection(
    { data: null, error: { code: 'FETCH_ERROR', message: 'https://db.example/marketplace_category request failed' } },
    { data: null, error: { code: '42P01', message: 'relation "public.marketplace_category_decisions" does not exist' } },
  ))
})
