import assert from 'node:assert/strict'
import test from 'node:test'
import { requestRefundOrderPayments } from '../lib/refund-order-payments-request.mjs'

test('Money Desk refund sends the service bearer expected by the Edge guard', async () => {
  const body = { orderId: 'dev-order', operationContext: { kind: 'ORDER_CANCELLATION' } }
  let calls = 0
  const response = await requestRefundOrderPayments({
    supabaseUrl: 'https://dev.supabase.co/',
    serviceRoleKey: 'test-service-key',
    body,
    fetchImpl: async (url, options) => {
      calls += 1
      assert.equal(url, 'https://dev.supabase.co/functions/v1/refund-order-payments')
      assert.deepEqual(JSON.parse(options.body), body)
      assert.equal(options.headers.apikey, 'test-service-key')
      assert.equal(options.headers['X-Drape-Service-Key'], 'test-service-key')
      assert.equal(options.headers.Authorization, 'Bearer test-service-key')
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    },
  })
  assert.equal(calls, 1)
  assert.equal(response.status, 200)
})
