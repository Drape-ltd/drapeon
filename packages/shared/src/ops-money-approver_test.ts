import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { isConfiguredMoneyDeskApprover } from './ops-money-approver.ts'

Deno.test('third Dev approver needs the explicit runtime allowlist', () => {
  const third = 'founders+ops-qa-2@drapeon.co'
  assertEquals(isConfiguredMoneyDeskApprover(third, undefined), false)
  assertEquals(isConfiguredMoneyDeskApprover(third, `founders@drapeon.co, ${third}`), true)
  assertEquals(isConfiguredMoneyDeskApprover(third.toUpperCase(), `founders@drapeon.co, ${third}`), true)
  assertEquals(isConfiguredMoneyDeskApprover('outsider@example.com', `founders@drapeon.co, ${third}`), false)
  assertEquals(isConfiguredMoneyDeskApprover(third, 'founders@drapeon.co'), false)
})
