import assert from 'node:assert/strict'
import test from 'node:test'
import { notifyBachsPayoutDestinationReview, refreshBachsPayoutDestination, shouldRefreshPayoutDestinationBeforeReview } from './bachs-payout-destination-refresh.mjs'

test('Ops refreshes Bachs before clearance and blocking, including stale blocks', () => {
  assert.equal(shouldRefreshPayoutDestinationBeforeReview('BACHS', 'CLEARED'), true)
  assert.equal(shouldRefreshPayoutDestinationBeforeReview('BACHS', 'BLOCKED'), true)
  assert.equal(shouldRefreshPayoutDestinationBeforeReview('STRIPE', 'CLEARED'), true)
  assert.equal(shouldRefreshPayoutDestinationBeforeReview('STRIPE', 'BLOCKED'), false)
})

test('Ops Bachs refresh calls the service-only action before clearance', async () => {
  let request
  const result = await refreshBachsPayoutDestination({
    supabaseUrl: 'https://dev.example/',
    serviceRoleKey: 'test-service-key',
    destinationId: '00000000-0000-4000-8000-000000000001',
    fetchImpl: async (url, options) => {
      request = { url, options }
      return { ok: true, json: async () => ({ ok: true }) }
    },
  })
  assert.deepEqual(result, { ok: true })
  assert.equal(request.url, 'https://dev.example/functions/v1/payout-account-action')
  assert.deepEqual(JSON.parse(request.options.body), {
    action: 'ops-refresh-bachs-destination',
    destinationId: '00000000-0000-4000-8000-000000000001',
  })
  assert.equal(request.options.cache, 'no-store')
})

test('Ops Bachs refresh preserves a safe provider review reason', async () => {
  const result = await refreshBachsPayoutDestination({
    supabaseUrl: 'https://dev.example',
    serviceRoleKey: 'test-service-key',
    destinationId: '00000000-0000-4000-8000-000000000001',
    fetchImpl: async () => ({
      ok: false,
      status: 409,
      json: async () => ({ code: 'AMBIGUOUS_DESTINATION' }),
    }),
  })
  assert.deepEqual(result, { ok: false, errorCode: 'AMBIGUOUS_DESTINATION' })
})

test('Ops Bachs review notice queues a recorded follow-up after the review', async () => {
  let body
  const result = await notifyBachsPayoutDestinationReview({
    supabaseUrl: 'https://dev.example',
    serviceRoleKey: 'test-service-key',
    destinationId: '00000000-0000-4000-8000-000000000001',
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body)
      return { ok: true, json: async () => ({ ok: true, pushJobId: 'push-job', emailJobId: 'email-job' }) }
    },
  })
  assert.deepEqual(body, {
    action: 'ops-notify-bachs-first-review',
    destinationId: '00000000-0000-4000-8000-000000000001',
  })
  assert.deepEqual(result, { ok: true, pushJobId: 'push-job', emailJobId: 'email-job' })
})
