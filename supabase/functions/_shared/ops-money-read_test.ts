import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { runOpsReadProjection } from './ops-read-projections.ts'

const orderId = '3c09f9ab-7893-44bc-b913-31287b6ab9bc'
const principal = { email: 'reviewer@example.test', subject: 'test', roles: ['admin'] }

function fixture() {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    money_desk_requests: [...Array.from({ length: 151 }, (_, i) => ({ id: `other-${i}`, order_id: 'other' })), { id: 'target-request', order_id: orderId }],
    money_desk_decisions: [...Array.from({ length: 501 }, () => ({ request_id: 'other' })), { id: 'decision', request_id: 'target-request' }],
    money_desk_execution_attempts: [...Array.from({ length: 501 }, () => ({ request_id: 'other' })), { id: 'attempt', request_id: 'target-request' }],
    payouts: [{ id: 'target-payout', order_id: orderId, status: 'BLOCKED' }, { id: 'other-payout', order_id: 'other', status: 'BLOCKED' }],
    order_settlement_tranches: [{ id: 'target-tranche', order_id: orderId, status: 'ELIGIBLE' }, { id: 'other-tranche', order_id: 'other', status: 'ELIGIBLE' }],
    orders: [{ id: orderId, reference: 'ORDER-TEST' }],
  }
  let queries = 0
  return {
    count: () => queries,
    client: { from(table: string) {
      queries++
      const filters: Array<(row: Record<string, unknown>) => boolean> = []
      let limit = Infinity
      const query = {
        select() { return query }, order() { return query },
        eq(key: string, value: unknown) { filters.push((row) => row[key] === value); return query },
        in(key: string, values: unknown[]) { filters.push((row) => values.includes(row[key])); return query },
        limit(value: number) { limit = value; return query },
        then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: tables[table].filter((row) => filters.every((filter) => filter(row))).slice(0, limit), error: null }).then(resolve) },
      }
      return query
    } } as unknown as SupabaseClient,
  }
}

Deno.test('order money query scopes before limits and retains older related decisions', async () => {
  const db = fixture()
  const result = await runOpsReadProjection(db.client, 'money', 'DEVELOPMENT', { orderId }, principal) as { requests: Array<{ id: string; decisions: unknown[]; attempts: unknown[] }>; payouts: Array<{ id: string }>; tranches: Array<{ id: string }> }
  assertEquals(result.requests.map((row) => row.id), ['target-request'])
  assertEquals(result.requests[0].decisions.length, 1)
  assertEquals(result.requests[0].attempts.length, 1)
  assertEquals(result.payouts.map((row) => row.id), ['target-payout'])
  assertEquals(result.tranches.map((row) => row.id), ['target-tranche'])
  assertEquals(db.count(), 6)
})

Deno.test('malformed money filter never falls back to all orders', async () => {
  const db = fixture()
  await assertRejects(() => runOpsReadProjection(db.client, 'money', 'DEVELOPMENT', { orderId: 'invalid' }, principal), Error, 'Invalid order filter')
  assertEquals(db.count(), 0)
})
