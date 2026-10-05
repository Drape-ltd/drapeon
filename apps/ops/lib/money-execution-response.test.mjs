import test from 'node:test'
import assert from 'node:assert/strict'
import { confirmedMoneyExecution } from './money-execution-response.mjs'

test('requires a recorded terminal attempt before showing provider success', () => {
  assert.deepEqual(confirmedMoneyExecution({ ok: true, result: { ok: true, attemptId: 'attempt-1', state: 'SUCCEEDED', pending: false } }, 200),
    { state: 'SUCCEEDED', attemptId: 'attempt-1' })
  assert.equal(confirmedMoneyExecution({ ok: true, result: {} }, 200), null)
  assert.equal(confirmedMoneyExecution({ ok: true, result: { ok: true, state: 'SUCCEEDED' } }, 200), null)
  assert.equal(confirmedMoneyExecution({ ok: false, result: { ok: true, attemptId: 'attempt-1', state: 'SUCCEEDED' } }, 200), null)
})

test('processing is explicit and never displayed as a terminal outcome', () => {
  assert.deepEqual(confirmedMoneyExecution({ ok: true, result: { ok: true, attemptId: 'attempt-2', state: 'PROCESSING', pending: true } }, 202),
    { state: 'PROCESSING', attemptId: 'attempt-2' })
  assert.equal(confirmedMoneyExecution({ ok: true, result: { ok: true, attemptId: 'attempt-2', state: 'PROCESSING', pending: true } }, 200), null)
  assert.equal(confirmedMoneyExecution({ ok: true, result: { ok: true, attemptId: 'attempt-2', state: 'SUCCEEDED', pending: true } }, 200), null)
  assert.equal(confirmedMoneyExecution({ ok: true, result: { ok: true, attemptId: 'attempt-2', state: 'FAILED' } }, 200), null)
})
