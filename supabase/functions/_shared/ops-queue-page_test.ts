import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { readOpsQueuePage, readOpsNavigationCounts } from './ops-queue-page.ts'

const principal = { roles: ['admin'], email: 'operator@example.test' }
const page = { ids: ['case-1'], total: 310, page: 16, pages: 16, summary: { open: 112, urgent: 43, unassigned: 112, slaTracked: 101, breached: 101, approvals: 9 } }

Deno.test('navigation uses one role-scoped query and returns counts only', async () => {
  let calls = 0
  const result = await readOpsNavigationCounts({ rpc: async (_name, args) => {
    calls++
    assertEquals(args.p_filters, { scope: 'open', ownership: 'mine' })
    assertEquals(args.p_roles, principal.roles)
    assertEquals(args.p_actor_email, principal.email)
    assertEquals(args.p_environment, 'DEVELOPMENT')
    return { data: { ...page, total: 0 }, error: null }
  } }, 'DEVELOPMENT', principal)
  assertEquals(result, { mine: 0, open: 112, approvals: 9 })
  assertEquals(calls, 1)
})

Deno.test('navigation does not convert missing, invalid or failed counts to zero', async () => {
  for (const value of [undefined, null, -1, 1.5, '9']) {
    await assertRejects(() => readOpsNavigationCounts({ rpc: async () => ({ data: { ...page, summary: { ...page.summary, approvals: value } }, error: null }) }, 'DEVELOPMENT', principal))
  }
  await assertRejects(() => readOpsNavigationCounts({ rpc: async () => ({ data: null, error: { message: 'offline' } }) }, 'DEVELOPMENT', principal))
})

Deno.test('queue read preserves full totals and verified identity, not filter identity', async () => {
  const filters = { scope: 'closed', page: '16', roles: ['finance'], email: 'other@example.test' }
  let calls = 0
  const client = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls++
    assertEquals(name, 'ops_queue_page')
    assertEquals(args.p_roles, principal.roles)
    assertEquals(args.p_actor_email, principal.email)
    assertEquals(args.p_environment, 'DEVELOPMENT')
    return { data: page, error: null }
  } }
  assertEquals(await readOpsQueuePage(client, 'DEVELOPMENT', principal, filters), page)
  assertEquals(calls, 1)
})

Deno.test('queue read fails closed for malformed filters and database failures', async () => {
  let calls = 0
  const client = { rpc: async () => { calls++; return { data: null, error: { message: 'unavailable' } } } }
  await assertRejects(() => readOpsQueuePage(client, 'DEVELOPMENT', principal, []), Error, 'Invalid queue filters')
  assertEquals(calls, 0)
  await assertRejects(() => readOpsQueuePage(client, 'DEVELOPMENT', principal, {}), Error, 'unavailable')
})

Deno.test('queue read rejects a broken or oversized database page', async () => {
  for (const data of [null, { ...page, ids: Array(21).fill('case') }, { ...page, page: 17 }]) {
    await assertRejects(() => readOpsQueuePage({ rpc: async () => ({ data, error: null }) }, 'DEVELOPMENT', principal, {}), Error, 'Invalid authoritative queue page')
  }
})
