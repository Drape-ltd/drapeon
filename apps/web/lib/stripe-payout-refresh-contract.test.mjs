import assert from 'node:assert/strict'
import test from 'node:test'

import { refreshStripePayoutDestination } from './stripe-payout-destination-refresh.mjs'

test('Ops Stripe destination refresh calls the protected Edge action', async () => {
  let requestUrl = ''
  let requestInit
  const result = await refreshStripePayoutDestination({
    supabaseUrl: 'https://dev-project.supabase.co/',
    serviceRoleKey: 'dev-service-role-key',
    destinationId: 'destination-123',
    fetchImpl: async (url, init) => {
      requestUrl = String(url)
      requestInit = init
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    },
  })

  assert.deepEqual(result, { ok: true })
  assert.match(requestUrl, /\/functions\/v1\/payout-account-action$/u)
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    action: 'ops-refresh-stripe-destination',
    destinationId: 'destination-123',
  })
  assert.equal(requestInit?.headers?.['X-Drape-Service-Key'], 'dev-service-role-key')
})

test('a forbidden Stripe destination refresh maps to a non-throwing failure', async () => {
  const result = await refreshStripePayoutDestination({
    supabaseUrl: 'https://dev-project.supabase.co',
    serviceRoleKey: 'dev-service-role-key',
    destinationId: 'destination-123',
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: 'Service authorization is required.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
  })

  assert.deepEqual(result, { ok: false, errorCode: 'HTTP_403' })
})
