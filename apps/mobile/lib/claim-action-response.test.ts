import assert from 'node:assert/strict'
import test from 'node:test'
import { claimActionServerError } from '../../../packages/shared/src/claim-action-response.ts'

test('uses a structured successful response error code', async () => {
  assert.equal(
    await claimActionServerError({ data: { error: 'INVALID_CODE' }, error: null }),
    'INVALID_CODE'
  )
})

test('extracts the server code from a non-2xx Functions response', async () => {
  const response = new Response(JSON.stringify({ error: 'ACCOUNT_CONFLICT' }), {
    status: 409,
    headers: { 'content-type': 'application/json' },
  })
  assert.equal(
    await claimActionServerError({ data: null, error: { context: response } }),
    'ACCOUNT_CONFLICT'
  )
})

test('keeps a transport failure distinct from a server rejection', async () => {
  assert.equal(
    await claimActionServerError({ data: null, error: new Error('network unavailable') }),
    null
  )
})
