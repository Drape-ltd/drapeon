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
    payout_claims: [], payout_provider_operations: [], payout_claim_retry_authorizations: [],
    orders: [{ id: orderId, reference: 'ORDER-TEST' }],
  }
  let queries = 0
  return {
    count: () => queries,
    tables,
    client: { from(table: string) {
      queries++
      const filters: Array<(row: Record<string, unknown>) => boolean> = []
      let limit = Infinity
      const query = {
        select() { return query }, order() { return query },
        eq(key: string, value: unknown) { filters.push((row) => row[key] === value); return query },
        is(key: string, value: unknown) { filters.push((row) => row[key] === value); return query },
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
  assertEquals(db.count(), 7)
})

Deno.test('malformed money filter never falls back to all orders', async () => {
  const db = fixture()
  await assertRejects(() => runOpsReadProjection(db.client, 'money', 'DEVELOPMENT', { orderId: 'invalid' }, principal), Error, 'Invalid order filter')
  assertEquals(db.count(), 0)
})

Deno.test('money projection includes a fully evidenced Stripe claim retry candidate', async () => {
  const db = fixture()
  const claimId = '8bd4354d-7517-4803-9f45-5ee2a7b02430'
  const operationId = 'ae1394d3-11f7-4f15-97f9-c5f61107c892'
  const payoutId = '33dc3d8d-b617-48f5-8a3f-25bc05809f99'
  const trancheId = '651f36a1-ef4d-4eec-beb5-a2a49d8eb9da'
  db.tables.payout_claims = [{
    id: claimId, source_kind: 'SETTLEMENT_TRANCHE', source_id: trancheId, order_id: orderId,
    provider: 'STRIPE', provider_destination_id: 'acct_test', currency: 'USD', amount: 8400,
    status: 'FAILED_RECONCILED', transfer_status: 'FAILED_RECONCILED', payout_id: payoutId,
    provider_transfer_id: null,
  }]
  db.tables.payout_provider_operations = [{
    id: operationId, claim_id: claimId, operation_number: 1, provider: 'STRIPE',
    provider_destination_id: 'acct_test', currency: 'USD', amount: 8400,
    status: 'FAILED_RETURNED', provider_source_transaction_id: 'ch_test',
    final_failure_reference: 'req_test', funds_return_reference: 'NOT_SENT:account_capability',
    funds_return_confirmed_at: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
    provider_transfer_id: null,
  }]
  db.tables.payouts.push({
    id: payoutId, order_id: orderId, status: 'FAILED', payout_purpose: 'SETTLEMENT_TRANCHE',
    provider: 'STRIPE', amount: 8400, currency: 'USD', provider_destination_id: 'acct_test',
  })
  db.tables.order_settlement_tranches.push({
    id: trancheId, order_id: orderId, status: 'BLOCKED', payout_id: payoutId, amount: 8400, currency: 'USD',
  })

  const result = await runOpsReadProjection(db.client, 'money', 'DEVELOPMENT', { orderId }, principal) as {
    retryCandidates: Array<{ claimId: string; amount: number; graceElapsed: boolean; orderReference: string | null }>
  }
  assertEquals(result.retryCandidates.length, 1)
  assertEquals(result.retryCandidates[0].claimId, claimId)
  assertEquals(result.retryCandidates[0].amount, 8400)
  assertEquals(result.retryCandidates[0].graceElapsed, true)
  assertEquals(result.retryCandidates[0].orderReference, 'ORDER-TEST')
})
