import { assertEquals, assertRejects } from 'jsr:@std/assert@1'
import { DispatchCommandError, executeOpsDispatchCommand, type DispatchClient } from './ops-dispatch-execution.ts'

function fakeClient(options: { settlementError?: string } = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  const rows: Array<{ table: string; operation: string; value: unknown }> = []
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args })
      if (name === 'record_order_fulfillment_quote') return Promise.resolve({ data: { runId: 'run-1', status: 'BOOKING_READY' }, error: null })
      if (name === 'record_order_fulfillment_event') return Promise.resolve({ data: { runId: 'run-1', eventId: 'event-1' }, error: null })
      if (name === 'record_order_settlement_evidence') return Promise.resolve({ data: null, error: options.settlementError ? { message: options.settlementError } : null })
      return Promise.resolve({ data: null, error: null })
    },
    from(table: string) {
      const query = { eq() { return query }, maybeSingle() { return Promise.resolve({ data: { id: 'order-1', reference: 'DRPTEST', customer_id: 'customer-1', tailor_id: 'tailor-1', currency: 'USD' }, error: null }) } }
      return {
        insert(value: unknown) { rows.push({ table, operation: 'insert', value }); return Promise.resolve({ error: null }) },
        upsert(value: unknown) { rows.push({ table, operation: 'upsert', value }); return Promise.resolve({ error: null }) },
        select() { return query },
      }
    },
    storage: { from() { return { upload() { return Promise.resolve({ error: null }) }, remove() { return Promise.resolve({ error: null }) } } } },
  } as unknown as DispatchClient
  return { client, calls, rows }
}

function proof() { return new File([new Uint8Array([1, 2, 3])], 'proof.jpg', { type: 'image/jpeg' }) }
const actor = { principalId: 'principal-1', label: 'ops@drapeon.co', role: 'ops' as const }

Deno.test('provider quote records private proof through the authoritative quote RPC', async () => {
  const { client, calls, rows } = fakeClient()
  const form = new FormData()
  Object.entries({ action: 'QUOTE', orderId: 'order-1', providerName: 'QA Courier', actualProviderCost: '15.00', shortfallTax: '0', shortfallFee: '0', idempotencyKey: 'quote-1' }).forEach(([key, value]) => form.set(key, value))
  form.set('evidence', proof())
  const result = await executeOpsDispatchCommand(client, actor, form)
  assertEquals(result.ok, true)
  assertEquals(calls[0].name, 'record_order_fulfillment_quote')
  assertEquals(calls[0].args.p_actual_provider_cost_amount, 1500)
  assertEquals(rows.some((row) => row.table === 'audit_logs'), true)
})

Deno.test('carrier custody records fulfillment and settlement evidence in order', async () => {
  const { client, calls } = fakeClient()
  const form = new FormData()
  Object.entries({ action: 'EVENT', orderId: 'order-1', eventType: 'CARRIER_ACCEPTED', providerName: 'QA Courier', providerReference: 'custody-1', idempotencyKey: 'event-1' }).forEach(([key, value]) => form.set(key, value))
  form.set('evidence', proof())
  await executeOpsDispatchCommand(client, actor, form)
  assertEquals(calls.map((call) => call.name).filter((name) => name.startsWith('record_order_')), ['record_order_fulfillment_event', 'record_order_settlement_evidence'])
  assertEquals(calls[1].args.p_evidence_kind, 'CARRIER_ACCEPTED')
})

Deno.test('custody proof is mandatory', async () => {
  const { client } = fakeClient()
  const form = new FormData()
  Object.entries({ action: 'EVENT', orderId: 'order-1', eventType: 'CARRIER_ACCEPTED' }).forEach(([key, value]) => form.set(key, value))
  await assertRejects(() => executeOpsDispatchCommand(client, actor, form), DispatchCommandError, 'Add a clear photo')
})

Deno.test('settlement evidence failure opens a payout block and never reports success', async () => {
  const { client, rows } = fakeClient({ settlementError: 'settlement unavailable' })
  const form = new FormData()
  Object.entries({ action: 'EVENT', orderId: 'order-1', eventType: 'COLLECTED', providerReference: 'custody-2' }).forEach(([key, value]) => form.set(key, value))
  form.set('evidence', proof())
  await assertRejects(() => executeOpsDispatchCommand(client, actor, form), DispatchCommandError, 'payout evidence did not sync')
  assertEquals(rows.some((row) => row.table === 'ops_issues' && row.operation === 'upsert'), true)
  assertEquals(rows.some((row) => row.table === 'audit_logs'), false)
})
