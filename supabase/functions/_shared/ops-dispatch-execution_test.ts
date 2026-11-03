import { assert, assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@1'
import { DispatchCommandError, executeOpsDispatchCommand, type DispatchClient } from './ops-dispatch-execution.ts'

function fakeClient(options: { settlementError?: string; eventError?: string; issueWriteError?: boolean; quoteOutcome?: Record<string, unknown>; capturedAllowance?: number } = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  const rows: Array<{ table: string; operation: string; value: unknown }> = []
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args })
      if (name === 'record_order_fulfillment_quote') return Promise.resolve({ data: options.quoteOutcome ?? { runId: 'run-1', status: 'BOOKING_READY' }, error: null })
      if (name === 'record_order_fulfillment_event') return Promise.resolve({ data: { runId: 'run-1', eventId: 'event-1' }, error: options.eventError ? { message: options.eventError } : null })
      if (name === 'record_order_settlement_evidence') return Promise.resolve({ data: null, error: options.settlementError ? { message: options.settlementError } : null })
      return Promise.resolve({ data: null, error: null })
    },
    from(table: string) {
      const selected = table === 'orders'
        ? { id: 'order-1', reference: 'DRPTEST', order_kind: 'CUSTOM', item_title: 'Dress', customer_id: 'customer-1', tailor_id: 'tailor-1', currency: 'USD' }
        : table === 'order_fulfillment_runs'
          ? { id: 'run-1', captured_allowance_amount: options.capturedAllowance ?? 0 }
          : table === 'ops_issues'
            ? { id: 'issue-1', status: 'OPEN', assigned_to: null, resolved_at: null }
            : null
      const query = { eq() { return query }, order() { return query }, limit() { return query }, maybeSingle() { return Promise.resolve({ data: selected, error: null }) } }
      return {
        insert(value: unknown) { rows.push({ table, operation: 'insert', value }); return Promise.resolve({ error: null }) },
        upsert(value: unknown) { rows.push({ table, operation: 'upsert', value }); return Promise.resolve({ error: options.issueWriteError ? { message: 'issue write failed' } : null }) },
        update(value: unknown) { rows.push({ table, operation: 'update', value }); return { eq() { return Promise.resolve({ error: null }) } } },
        select() { return query },
      }
    },
    storage: { from() { return { upload() { return Promise.resolve({ error: null }) }, remove() { return Promise.resolve({ error: null }) } } } },
  } as unknown as DispatchClient
  return { client, calls, rows }
}

function queued(calls: Array<{ name: string; args: Record<string, unknown> }>, eventType: string) {
  return calls.filter((call) => call.name === 'enqueue_domain_event' && call.args.p_event_type === eventType).map((call) => call.args)
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
  assertEquals(rows.some((row) => row.table === 'ops_issues' && row.operation === 'update' && (row.value as Record<string, unknown>).status === 'RESOLVED'), true)
})

Deno.test('decision quote queues complete customer, tailor, email, push, and SMS payloads', async () => {
  const { client, calls } = fakeClient({ quoteOutcome: { runId: 'run-1', status: 'AWAITING_CUSTOMER_DECISION', customerDueAmount: 725 }, capturedAllowance: 1500 })
  const form = new FormData()
  Object.entries({ action: 'QUOTE', orderId: 'order-1', providerName: 'QA Courier', actualProviderCost: '22.25' }).forEach(([key, value]) => form.set(key, value))
  form.set('evidence', proof())
  await executeOpsDispatchCommand(client, actor, form)
  const customer = queued(calls, 'notification.dispatch_quote_recorded')[0].p_payload as Record<string, any>
  const tailor = queued(calls, 'notification.dispatch_quote_recorded_tailor')[0].p_payload as Record<string, any>
  const sms = queued(calls, 'notification.dispatch_quote_sms_requested')[0].p_payload as Record<string, any>
  for (const payload of [customer, tailor]) {
    assert(payload.order?.reference === 'DRPTEST')
    assert(typeof payload.notification?.title === 'string' && payload.notification.title.length > 0)
    assert(typeof payload.notification?.body === 'string' && payload.notification.body.length > 0)
    assertEquals(payload.notification.data.destination, 'ORDER_DETAIL')
  }
  assertStringIncludes(customer.body, '$7.25')
  assertStringIncludes(customer.notification.body, '$7.25')
  assertStringIncludes(sms.body, '$7.25')
  assertEquals(tailor.notification.preferenceKey, 'newOrders')
})

Deno.test('carrier custody records fulfillment and settlement evidence in order', async () => {
  const { client, calls, rows } = fakeClient()
  const form = new FormData()
  Object.entries({ action: 'EVENT', orderId: 'order-1', eventType: 'CARRIER_ACCEPTED', providerName: 'QA Courier', providerReference: 'custody-1', idempotencyKey: 'event-1' }).forEach(([key, value]) => form.set(key, value))
  form.set('evidence', proof())
  await executeOpsDispatchCommand(client, actor, form)
  assertEquals(calls.map((call) => call.name).filter((name) => name.startsWith('record_order_')), ['record_order_fulfillment_event', 'record_order_settlement_evidence'])
  assertEquals(calls[1].args.p_evidence_kind, 'CARRIER_ACCEPTED')
  assertEquals(rows.some((row) => row.table === 'ops_issues' && row.operation === 'update' && (row.value as Record<string, unknown>).status === 'RESOLVED'), true)
})

for (const eventType of ['OUT_FOR_DELIVERY', 'DELIVERED', 'PICKUP_READY', 'PICKED_UP']) {
  Deno.test(`${eventType} queues complete push/email payloads and SMS for both recipients`, async () => {
    const { client, calls } = fakeClient()
    const form = new FormData()
    Object.entries({ action: 'EVENT', orderId: 'order-1', eventType, providerReference: `ref-${eventType}` }).forEach(([key, value]) => form.set(key, value))
    if (['DELIVERED', 'PICKUP_READY', 'PICKED_UP'].includes(eventType)) form.set('evidence', proof())
    await executeOpsDispatchCommand(client, actor, form)
    const notifications = queued(calls, 'notification.dispatch_event_recorded')
    const sms = queued(calls, 'notification.dispatch_event_sms_requested')
    assertEquals(notifications.length, 2)
    assertEquals(sms.length, 2)
    for (const entry of notifications) {
      const payload = entry.p_payload as Record<string, any>
      assert(payload.order?.reference === 'DRPTEST')
      assert(typeof payload.notification?.title === 'string' && payload.notification.title.length > 0)
      assert(typeof payload.notification?.body === 'string' && payload.notification.body.length > 0)
      assertEquals(payload.notification.data.destination, 'ORDER_DETAIL')
    }
  })
}

Deno.test('custody proof is mandatory', async () => {
  const { client } = fakeClient()
  const form = new FormData()
  Object.entries({ action: 'EVENT', orderId: 'order-1', eventType: 'CARRIER_ACCEPTED' }).forEach(([key, value]) => form.set(key, value))
  await assertRejects(() => executeOpsDispatchCommand(client, actor, form), DispatchCommandError, 'Add a clear photo')
})

Deno.test('rejected custody transition returns the exact shared operator feedback', async () => {
  const { client } = fakeClient({ eventError: 'Trusted custody proof is required before tracking transit' })
  const form = new FormData()
  Object.entries({ action: 'EVENT', orderId: 'order-1', eventType: 'IN_TRANSIT' }).forEach(([key, value]) => form.set(key, value))
  const error = await assertRejects(() => executeOpsDispatchCommand(client, actor, form), DispatchCommandError)
  assertEquals(error.code, 'DISPATCH_CUSTODY_PROOF_REQUIRED')
  assertStringIncludes(error.message, 'provider-acceptance or parcel-collection photo')
})

Deno.test('ETA and location changes produce distinct event idempotency keys', async () => {
  const first = fakeClient()
  const second = fakeClient()
  const base = { action: 'EVENT', orderId: 'order-1', eventType: 'IN_TRANSIT', providerReference: 'move-1', trackingNumber: 'track-1', locationLabel: 'Austin hub', latitude: '30.2672', longitude: '-97.7431' }
  const firstForm = new FormData()
  Object.entries({ ...base, etaAt: '2026-11-03T15:00' }).forEach(([key, value]) => firstForm.set(key, value))
  const secondForm = new FormData()
  Object.entries({ ...base, etaAt: '2026-11-03T16:00' }).forEach(([key, value]) => secondForm.set(key, value))
  await executeOpsDispatchCommand(first.client, actor, firstForm)
  await executeOpsDispatchCommand(second.client, actor, secondForm)
  const firstKey = first.calls.find((call) => call.name === 'record_order_fulfillment_event')?.args.p_idempotency_key
  const secondKey = second.calls.find((call) => call.name === 'record_order_fulfillment_event')?.args.p_idempotency_key
  assert(typeof firstKey === 'string')
  assert(typeof secondKey === 'string')
  assert(firstKey !== secondKey)
})

Deno.test('settlement evidence failure opens a payout block and never reports success', async () => {
  const { client, rows } = fakeClient({ settlementError: 'settlement unavailable' })
  const form = new FormData()
  Object.entries({ action: 'EVENT', orderId: 'order-1', eventType: 'COLLECTED', providerReference: 'custody-2' }).forEach(([key, value]) => form.set(key, value))
  form.set('evidence', proof())
  await assertRejects(() => executeOpsDispatchCommand(client, actor, form), DispatchCommandError, 'payout evidence did not sync')
  assertEquals(rows.some((row) => row.table === 'ops_issues' && row.operation === 'upsert'), true)
  const issue = rows.find((row) => row.table === 'ops_issues' && row.operation === 'upsert')?.value as Record<string, any>
  assertEquals(issue.resolved_at, null)
  assertEquals(issue.metadata.error, 'settlement unavailable')
  assertEquals(rows.some((row) => row.table === 'audit_logs'), false)
})

Deno.test('settlement evidence failure fails closed when its payout-block case cannot be saved', async () => {
  const { client } = fakeClient({ settlementError: 'settlement unavailable', issueWriteError: true })
  const form = new FormData()
  Object.entries({ action: 'EVENT', orderId: 'order-1', eventType: 'COLLECTED' }).forEach(([key, value]) => form.set(key, value))
  form.set('evidence', proof())
  const error = await assertRejects(() => executeOpsDispatchCommand(client, actor, form), DispatchCommandError)
  assertEquals(error.code, 'PAYOUT_BLOCK_CASE_FAILED')
})
