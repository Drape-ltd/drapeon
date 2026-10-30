import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { markPaymentAttemptStatus, type PaymentAttempt } from './payment-ledger.ts'

function payment(status: PaymentAttempt['status']): PaymentAttempt {
  return {
    id: 'payment-1', order_id: 'order-1', phase: 'TIP', provider: 'STRIPE',
    currency: 'USD', amount: 1000, refunded_amount: status === 'REFUNDED' ? 1000 : 0,
    status, idempotency_key: 'key-1', provider_payment_id: 'pi_1', provider_checkout_url: null,
  }
}

Deno.test('refund then late success is inert and runs no success side effects', async () => {
  const calls: string[] = []
  const supabase = {
    rpc: async () => ({
      data: { payment: payment('REFUNDED'), transitioned: false, fromStatus: 'REFUNDED', toStatus: 'SUCCEEDED' },
      error: null,
    }),
  }
  const result = await markPaymentAttemptStatus(supabase as never, {
    provider: 'STRIPE', providerPaymentId: 'pi_1', status: 'SUCCEEDED',
    providerResponse: { id: 'evt_late' },
  }, {
    recordCapture: async () => { calls.push('capture'); return {} as never },
    syncFabric: async () => { calls.push('fabric') },
    syncAdjustment: async () => { calls.push('adjustment') },
    syncTip: async () => { calls.push('tip') },
  })
  assertEquals(result.transitioned, false)
  assertEquals(result.payment?.status, 'REFUNDED')
  assertEquals(calls, [])
})

Deno.test('duplicate success is inert and does not re-run capture or tip sync', async () => {
  const calls: string[] = []
  const supabase = {
    rpc: async () => ({
      data: { payment: payment('SUCCEEDED'), transitioned: false, fromStatus: 'SUCCEEDED', toStatus: 'SUCCEEDED' },
      error: null,
    }),
  }
  await markPaymentAttemptStatus(supabase as never, {
    provider: 'STRIPE', providerPaymentId: 'pi_1', status: 'SUCCEEDED',
    providerResponse: { id: 'evt_duplicate' },
  }, {
    recordCapture: async () => { calls.push('capture'); return {} as never },
    syncFabric: async () => { calls.push('fabric') },
    syncAdjustment: async () => { calls.push('adjustment') },
    syncTip: async () => { calls.push('tip') },
  })
  assertEquals(calls, [])
})
