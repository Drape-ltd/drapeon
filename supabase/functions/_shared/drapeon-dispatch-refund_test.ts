import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { processDispatchRefund } from './drapeon-dispatch-refund.ts'

Deno.test('successful dispatch refund records the Stripe re_ refund ID, never the pi_ payment ID', async () => {
  const run = {
    id: 'run_1', order_id: 'order_1', customer_refund_amount: 300,
    customer_refund_tax_amount: 0, customer_refund_status: 'QUEUED',
    currency: 'USD', correlation_id: 'correlation_1',
  }
  const updates: Record<string, unknown>[] = []
  const terminal: Record<string, unknown>[] = []
  const client = {
    from(table: string) {
      assertEquals(table, 'order_fulfillment_runs')
      return {
        select() { const query = {
          eq() { return query },
          maybeSingle: async () => ({ data: run, error: null }),
        }; return query },
        update(patch: Record<string, unknown>) {
          updates.push(patch)
          const query = { eq() { return query }, neq: async () => ({ error: null }) }
          return query
        },
      }
    },
  }
  const result = await processDispatchRefund(client as never, run.id, null, {
    refundPayments: async () => ({
      refundedAttempts: [{ id: 'pay_1', provider: 'STRIPE',
        providerPaymentId: 'pi_payment', providerRefundId: 're_refund',
        phase: 'INITIAL_ORDER', amount: 300, currency: 'USD',
        remainingRefundableAmount: 13231, totalRefundedAmount: 300, partial: true }],
      pendingAttempts: [], alreadyRefundedAttemptIds: [],
      totalRefundedAmount: 300, remainingRefundableAmount: 13231,
    }),
    markTerminal: async (_db, input) => { terminal.push(input); return true },
  })
  assertEquals(result.ok, true)
  assertEquals(updates.length, 1)
  assertEquals(terminal.length, 1)
  assertEquals(terminal[0].providerReference, 're_refund')
  assertEquals(terminal[0].providerReference === 'pi_payment', false)
})

Deno.test('reviewed dispatch job carries the approved operation and waits for a pending Stripe outcome', async () => {
  const run = { id: 'run_2', order_id: 'order_2', customer_refund_amount: 300,
    customer_refund_tax_amount: 0, customer_refund_status: 'FAILED',
    currency: 'USD', correlation_id: 'correlation_2' }
  const operation = { id: 'op_2', run_id: run.id, payment_id: 'pay_2',
    money_desk_request_id: 'md_2', prior_refund_id: 're_failed',
    idempotency_key: 'retry:op_2', status: 'QUEUED', provider_refund_id: null }
  const request = { id: 'md_2', action_type: 'CUSTOMER_REFUND',
    target_type: 'DISPATCH_REFUND_RETRY', target_id: run.id,
    order_id: run.order_id, amount: 300, currency: 'USD', status: 'SUCCEEDED' }
  const operationPatches: Record<string, unknown>[] = []
  const runPatches: Record<string, unknown>[] = []
  const client = { from(table: string) {
    if (table === 'order_fulfillment_runs') return {
      select() { const q = { eq() { return q }, maybeSingle: async () => ({ data: run, error: null }) }; return q },
      update(patch: Record<string, unknown>) { runPatches.push(patch)
        const q = { eq() { return q }, neq: async () => ({ error: null }) }; return q },
    }
    if (table === 'dispatch_refund_retry_operations') return {
      select() { const q = { eq() { return q }, maybeSingle: async () => ({ data: operation, error: null }) }; return q },
      update(patch: Record<string, unknown>) { operationPatches.push(patch)
        const q = { eq() { return q }, in: async () => ({ error: null }),
          then(resolve: (value: { error: null }) => void) { resolve({ error: null }) } }; return q },
    }
    if (table === 'money_desk_requests') return {
      select() { const q = { eq() { return q }, maybeSingle: async () => ({ data: request, error: null }) }; return q },
    }
    throw new Error(`Unexpected table: ${table}`)
  } }
  const receivedContexts: Record<string, unknown>[] = []
  const result = await processDispatchRefund(client as never, run.id, operation.id, {
    refundPayments: async (_db, input) => {
      receivedContexts.push(input.operationContext as Record<string, unknown>)
      return { refundedAttempts: [], pendingAttempts: [{ id: 'pay_2',
        provider: 'STRIPE', providerPaymentId: 'pi_2', providerRefundId: 're_pending',
        phase: 'INITIAL_ORDER', amount: 300, currency: 'USD', status: 'PENDING' }],
        alreadyRefundedAttemptIds: [], totalRefundedAmount: 0,
        remainingRefundableAmount: 13231 }
    },
    markTerminal: async () => { throw new Error('Pending refund must not finalize') },
  })
  assertEquals(result.pending, true)
  assertEquals(receivedContexts[0]?.dispatchRetryOperationId, operation.id)
  assertEquals(receivedContexts[0]?.idempotencyKey, operation.idempotency_key)
  assertEquals(operationPatches.map((patch) => patch.status), ['PROCESSING', 'PENDING'])
  assertEquals(operationPatches[1].provider_refund_id, 're_pending')
  assertEquals(runPatches.map((patch) => patch.customer_refund_status), ['PROCESSING', 'PENDING'])
})

Deno.test('reviewed refund completes Money Desk only at terminal Stripe outcome and replays once', async () => {
  const { completeReviewedDispatchRefundAttempt } = await import('./drapeon-dispatch-refund.ts')
  const operation = { id: 'op_terminal', money_desk_request_id: 'md_terminal',
    status: 'SUCCEEDED', provider_refund_id: 're_terminal' }
  const attempt = { id: 'attempt_terminal', status: 'PROCESSING', provider_reference: null as string | null }
  const completions: Record<string, unknown>[] = []
  const client = {
    from(table: string) {
      if (table === 'dispatch_refund_retry_operations') return {
        select() { const q = { eq() { return q }, maybeSingle: async () => ({ data: operation, error: null }) }; return q },
      }
      if (table === 'money_desk_execution_attempts') return {
        select() { const q = { eq() { return q }, order() { return q }, limit() { return q },
          maybeSingle: async () => ({ data: attempt, error: null }) }; return q },
      }
      throw new Error(`Unexpected table ${table}`)
    },
    async rpc(name: string, args: Record<string, unknown>) {
      assertEquals(name, 'complete_money_desk_execution')
      completions.push(args)
      attempt.status = String(args.p_status)
      attempt.provider_reference = String(args.p_provider_reference)
      return { data: { status: attempt.status }, error: null }
    },
  }
  assertEquals(await completeReviewedDispatchRefundAttempt(client as never,
    { runId: 'run_terminal', refundId: 're_terminal', status: 'SUCCEEDED' }), true)
  assertEquals(completions.length, 1)
  assertEquals(completions[0].p_provider_reference, 're_terminal')
  assertEquals(await completeReviewedDispatchRefundAttempt(client as never,
    { runId: 'run_terminal', refundId: 're_terminal', status: 'SUCCEEDED' }), true)
  assertEquals(completions.length, 1)
  operation.status = 'FAILED'
  attempt.status = 'PROCESSING'
  operation.provider_refund_id = 're_failed_terminal'
  assertEquals(await completeReviewedDispatchRefundAttempt(client as never,
    { runId: 'run_terminal', refundId: 're_failed_terminal', status: 'FAILED', providerStatus: 'canceled' }), true)
  assertEquals(completions.length, 2)
  assertEquals(completions[1].p_status, 'FAILED')
  assertEquals(completions[1].p_provider_reference, 're_failed_terminal')
})
