import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(
  new URL('../supabase/functions/payment-action/index.ts', import.meta.url),
  'utf8',
)

test('custom Bachs retry carries the corrected promotional due into the pricing reservation', () => {
  const due = source.indexOf('amount = initialOrderPromotionCustomerDue({')
  const benefit = source.indexOf('activeBenefit = { ...activeBenefit, customer_due_amount: amount }', due)
  const pricing = source.indexOf('prepareCommercialPricingReservation(supabase, {', benefit)

  assert.ok(due >= 0, 'payment action must derive the retry due from the locked Bachs route')
  assert.ok(benefit > due, 'payment action must update the benefit passed to pricing after correcting due')
  assert.ok(pricing > benefit, 'the corrected benefit must be in place before pricing is reserved')
})
