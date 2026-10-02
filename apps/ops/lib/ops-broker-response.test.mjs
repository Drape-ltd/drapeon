import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveOpsBrokerResponse } from './ops-broker-response.mjs'

test('an interrupted broker call is explicit and correlated', async () => {
  const result = await resolveOpsBrokerResponse(() => Promise.reject(new Error('network secret')), 'ref-1')
  assert.equal(result.status, 502)
  assert.equal(result.payload.code, 'OPS_BROKER_INTERRUPTED')
  assert.equal(result.payload.correlationId, 'ref-1')
})

test('malformed HTTP 200 never becomes an Ops success', async () => {
  const malformed = await resolveOpsBrokerResponse(() => Promise.resolve(new Response('<html>bad</html>', { status: 200 })), 'ref-2')
  assert.equal(malformed.status, 502)
  assert.equal(malformed.payload.code, 'OPS_BROKER_INVALID_RESPONSE')
  assert.equal(malformed.payload.correlationId, 'ref-2')
  const inconsistent = await resolveOpsBrokerResponse(() => Promise.resolve(Response.json({ error: 'failed' })), 'ref-3')
  assert.equal(inconsistent.status, 502)
  assert.equal(inconsistent.payload.code, 'OPS_BROKER_INVALID_RESPONSE')
  assert.equal(inconsistent.payload.correlationId, 'ref-3')
  const empty = await resolveOpsBrokerResponse(() => Promise.resolve(Response.json({})), 'ref-empty')
  assert.equal(empty.status, 502)
  assert.equal(empty.payload.code, 'OPS_BROKER_INVALID_RESPONSE')
  assert.equal(empty.payload.correlationId, 'ref-empty')
})

test('valid Edge success and error statuses retain their payload and reference', async () => {
  assert.deepEqual(await resolveOpsBrokerResponse(() => Promise.resolve(Response.json({ ok: true }, { status: 200 })), 'ref-4'),
    { status: 200, payload: { ok: true, correlationId: 'ref-4' } })
  assert.deepEqual(await resolveOpsBrokerResponse(() => Promise.resolve(Response.json({ error: 'stale', correlationId: 'edge-ref' }, { status: 409 })), 'ref-5'),
    { status: 409, payload: { error: 'stale', correlationId: 'edge-ref' } })
})
