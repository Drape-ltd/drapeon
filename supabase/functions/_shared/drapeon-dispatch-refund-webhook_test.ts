import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  hasConfirmedProviderRefund,
  isRecoveredPriorDispatchRefund,
  recordReviewedDispatchRefundWebhookOutcome,
} from './drapeon-dispatch-refund-webhook.ts'

Deno.test('late failure for an unrecorded old refund cannot reverse a newer confirmed refund', async () => {
  const queried: Record<string, string> = {}
  const client = {
    from(table: string) {
      assertEquals(table, 'order_payment_provider_refunds')
      return { select() {
        const query = {
          eq(column: string, value: string) { queried[column] = value; return query },
          maybeSingle: async () => ({ data: null, error: null }),
        }
        return query
      } }
    },
  }
  assertEquals(await hasConfirmedProviderRefund(client as never, 'pay_1', 're_old_failed'), false)
  assertEquals(queried, { payment_id: 'pay_1', provider_refund_id: 're_old_failed' })
})

Deno.test('only the same confirmed refund ID permits failure reversal', async () => {
  for (const [recordStatus, expected] of [
    ['FAILED', false], ['PENDING', false], ['CONFIRMED', true],
  ] as const) {
    const client = { from() { return { select() {
      const query = {
        eq() { return query },
        maybeSingle: async () => ({ data: { id: 'row', status: recordStatus }, error: null }),
      }
      return query
    } } } }
    assertEquals(await hasConfirmedProviderRefund(client as never, 'pay_1', 're_old'), expected)
  }
})

Deno.test('a duplicate old failure after successful reviewed recovery does not reopen the case', async () => {
  const lookedUp: Record<string, string> = {}
  const client = { from(table: string) {
    assertEquals(table, 'dispatch_refund_retry_operations')
    return { select() {
      const q = {
        eq(column: string, value: string) { lookedUp[column] = value; return q },
        limit: async () => ({ data: [{ id: 'op_recovered' }], error: null }),
      }
      return q
    } }
  } }
  assertEquals(await isRecoveredPriorDispatchRefund(client as never, {
    runId: 'run_1', refundId: 're_old', hasConfirmedRefundRecord: false,
  }), true)
  assertEquals(lookedUp, {
    run_id: 'run_1', prior_refund_id: 're_old', status: 'SUCCEEDED',
  })
  assertEquals(await isRecoveredPriorDispatchRefund(client as never, {
    runId: 'run_1', refundId: 're_old', hasConfirmedRefundRecord: true,
  }), false)
})

Deno.test('reviewed refund webhook binds the provider outcome to one operation', async () => {
  const patches: Record<string, unknown>[] = []
  const client = {
    from(table: string) {
      if (table === 'dispatch_refund_retry_operations') return {
        select() { const q = { eq() { return q }, maybeSingle: async () => ({
          data: { id: 'op_1', run_id: 'run_1', payment_id: 'pay_1',
            prior_refund_id: 're_prior', provider_refund_id: null, status: 'PROCESSING' },
          error: null,
        }) }; return q },
        update(patch: Record<string, unknown>) { patches.push(patch); const q = {
          eq() { return q }, in: async () => ({ error: null }),
        }; return q },
      }
      if (table === 'order_fulfillment_runs') return { select() {
        const q = { eq() { return q }, maybeSingle: async () => ({ data: {
          id: 'run_1', customer_refund_amount: 300, customer_refund_tax_amount: 0,
        }, error: null }) }
        return q
      } }
      if (table === 'ops_issues') return { select() {
        const q = { eq() { return q }, maybeSingle: async () => ({ data: null, error: null }) }
        return q
      } }
      throw new Error(`Unexpected table: ${table}`)
    },
  }
  await recordReviewedDispatchRefundWebhookOutcome(client as never, {
    refund: { id: 're_new', status: 'succeeded', amount: 300,
      metadata: { dispatch_retry_operation_id: 'op_1', prior_refund_id: 're_prior' } },
    paymentId: 'pay_1', resolutionId: 'dispatch-refund:run_1', status: 'succeeded',
  })
  assertEquals(patches.length, 1)
  assertEquals(patches[0].status, 'SUCCEEDED')
  assertEquals(patches[0].provider_refund_id, 're_new')
  await assertRejects(() => recordReviewedDispatchRefundWebhookOutcome(client as never, {
    refund: { id: 're_other', status: 'succeeded', amount: 300,
      metadata: { dispatch_retry_operation_id: 'op_1', prior_refund_id: 're_prior' } },
    paymentId: 'different_payment', resolutionId: 'dispatch-refund:run_1', status: 'succeeded',
  }), Error, 'does not match')
  assertEquals(patches.length, 1)
})
