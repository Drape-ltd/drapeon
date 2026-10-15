import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { readOpsSearch, searchPattern, type OpsSearchClient } from './ops-search.ts'

function fixture() {
  const calls: { table: string; columns?: string; filters: unknown[] }[] = []
  const rpcInputs: Record<string, unknown>[] = []
  const client = {
    rpc: async (_name: string, args: Record<string, unknown>) => {
      rpcInputs.push(args)
      return { data: { ids: ['case-1'], total: 1, page: 1, pages: 1, summary: {} }, error: null }
    },
    from: (table: string) => {
      const call = { table, columns: '', filters: [] as unknown[] }
      calls.push(call)
      const result = table === 'ops_issues' ? [{ id: 'case-1', case_number: 'OPS-CLOSED', title: 'Closed example' }] : [{ id: 'record-1', display_name: 'Anna', email: 'private@example.test' }]
      const builder = {
        select: (columns: string) => { call.columns = columns; return builder },
        eq: (key: string, value: unknown) => { call.filters.push([key, value]); return builder },
        ilike: (key: string, value: unknown) => { call.filters.push([key, value]); return builder },
        in: (key: string, value: unknown) => { call.filters.push([key, value]); return builder },
        order: (_key: string) => builder,
        limit: (value: number) => { assertEquals(value, 20); return builder },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: result, error: null })),
      }
      return builder
    },
  } as unknown as OpsSearchClient
  return { client, calls, rpcInputs }
}

Deno.test('search includes closed cases, caps query work, and never returns contact data', async () => {
  const { client, calls, rpcInputs } = fixture()
  const data = await readOpsSearch(client, 'DEVELOPMENT', { roles: ['admin'], email: 'operator@example.test' }, 'Anna')
  assertEquals(data.groups.length, 4)
  assertEquals(data.groups[2].results.length, 1) // name/email results deduplicate
  assertEquals(JSON.stringify(data).includes('private@example.test'), false)
  assertEquals(rpcInputs[0].p_filters, { scope: 'all', q: 'Anna' })
  assertEquals(calls.length + rpcInputs.length + 1, 8) // includes principal lookup
  assertEquals(calls.filter((c) => c.table === 'users').every((c) => c.columns === 'id,display_name' && c.filters.some((f) => JSON.stringify(f) === '["role","CUSTOMER"]')), true)
})

Deno.test('search enforces destination permissions before querying people and orders', async () => {
  for (const [role, tables] of [['engineering', ['ops_issues']], ['finance', ['ops_issues', 'orders']], ['trust', ['ops_issues', 'tailor_profiles', 'tailor_profiles']]] as const) {
    const { client, calls } = fixture()
    await readOpsSearch(client, 'DEVELOPMENT', { roles: [role], email: 'operator@example.test' }, 'Anna')
    assertEquals(calls.map((call) => call.table), [...tables])
  }
})

Deno.test('search rejects invalid requests and unauthorized roles without querying', async () => {
  const { client, calls, rpcInputs } = fixture()
  for (const query of ['', 'a', 'x'.repeat(161), {}, 'abc\n']) await assertRejects(() => readOpsSearch(client, 'DEVELOPMENT', { roles: ['admin'], email: 'operator@example.test' }, query))
  await assertRejects(() => readOpsSearch(client, 'DEVELOPMENT', { roles: ['unknown'], email: 'operator@example.test' }, 'Anna'))
  assertEquals(calls.length + rpcInputs.length, 0)
  assertEquals(searchPattern('a%_\\b'), '%a\\%\\_\\\\b%')
})
