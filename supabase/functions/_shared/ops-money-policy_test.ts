import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { canUseOpsMoneyCommand, isOpsMoneyCommand, selectOpsMoneyActorRole } from './ops-money-policy.ts'

Deno.test('unknown Money Desk commands fail closed', () => {
  assertEquals(isOpsMoneyCommand('ELEVATE'), true)
  assertEquals(isOpsMoneyCommand('SUBMIT'), false)
  assertEquals(isOpsMoneyCommand(''), false)
})

Deno.test('operations and customer success can elevate but cannot approve or execute', () => {
  for (const role of ['ops', 'customer_success']) {
    assertEquals(canUseOpsMoneyCommand([role], 'ELEVATE'), true)
    assertEquals(canUseOpsMoneyCommand([role], 'DECIDE'), false)
    assertEquals(canUseOpsMoneyCommand([role], 'EXECUTE'), false)
  }
})

Deno.test('only admin can approve or execute while finance can prepare', () => {
  assertEquals(canUseOpsMoneyCommand(['finance'], 'PREPARE'), true)
  assertEquals(canUseOpsMoneyCommand(['finance'], 'DECIDE'), false)
  assertEquals(canUseOpsMoneyCommand(['finance'], 'EXECUTE'), false)
  assertEquals(canUseOpsMoneyCommand(['admin'], 'DECIDE'), true)
  assertEquals(selectOpsMoneyActorRole(['trust', 'finance', 'admin'], 'EXECUTE'), 'admin')
})
