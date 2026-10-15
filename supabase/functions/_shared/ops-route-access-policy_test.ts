import { assertEquals } from 'jsr:@std/assert@1'
import { canAccessOpsArea, isOpsArea, OPS_AREA_ROLES } from '../../../apps/ops/lib/route-access-policy.ts'

Deno.test('every restricted Ops area has at least one named role', () => {
  for (const roles of Object.values(OPS_AREA_ROLES)) {
    assertEquals(roles.length > 0, true)
  }
})

Deno.test('Money Desk and workforce access remain narrowly authorized', () => {
  assertEquals(canAccessOpsArea('finance', 'money'), true)
  assertEquals(canAccessOpsArea('ops', 'money'), false)
  assertEquals(canAccessOpsArea('admin', 'access'), true)
  assertEquals(canAccessOpsArea('engineering', 'access'), false)
})

Deno.test('Trust and reliability routes do not inherit broad case visibility', () => {
  assertEquals(canAccessOpsArea('customer_success', 'trust'), false)
  assertEquals(canAccessOpsArea('trust', 'incidents'), false)
  assertEquals(canAccessOpsArea('engineering', 'incidents'), true)
  assertEquals(isOpsArea('trust'), true)
  assertEquals(isOpsArea('my-work'), false)
})

Deno.test('Order access does not implicitly grant access to related people or Money Desk', () => {
  for (const role of ['finance', 'ops', 'customer_success', 'admin'] as const) {
    assertEquals(canAccessOpsArea(role, 'orders'), true)
    assertEquals(canAccessOpsArea(role, 'customers'), role !== 'finance')
    assertEquals(canAccessOpsArea(role, 'tailors'), role !== 'finance')
    assertEquals(canAccessOpsArea(role, 'money'), role === 'finance' || role === 'admin')
  }
})
