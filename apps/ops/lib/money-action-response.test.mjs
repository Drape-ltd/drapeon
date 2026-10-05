import test from 'node:test'
import assert from 'node:assert/strict'
import { confirmedMoneyDecision, confirmedMoneyElevation, confirmedMoneyPreparation } from './money-action-response.mjs'

test('elevation requires a real grant and expiry, not only HTTP 200', () => {
  const success = { ok: true, result: { grantId: 'grant-1', expiresAt: '2026-10-02T22:00:00Z' } }
  assert.deepEqual(confirmedMoneyElevation(success, 200), success.result)
  assert.equal(confirmedMoneyElevation({ ok: true, result: {} }, 200), null)
  assert.equal(confirmedMoneyElevation({ ok: true, result: { grantId: 'grant-1', expiresAt: 'bad' } }, 200), null)
  assert.equal(confirmedMoneyElevation(success, 202), null)
})

test('decision requires the exact request and a decision-compatible state', () => {
  assert.deepEqual(confirmedMoneyDecision({ ok: true, result: { requestId: 'request-1', status: 'APPROVED' } }, 200, 'request-1', 'APPROVE'), { state: 'APPROVED' })
  assert.deepEqual(confirmedMoneyDecision({ ok: true, result: { requestId: 'request-1', status: 'PENDING_APPROVAL' } }, 200, 'request-1', 'APPROVE'), { state: 'PENDING_APPROVAL' })
  assert.deepEqual(confirmedMoneyDecision({ ok: true, result: { requestId: 'request-1', status: 'REJECTED' } }, 200, 'request-1', 'REJECT'), { state: 'REJECTED' })
  assert.equal(confirmedMoneyDecision({ ok: true, result: { requestId: 'another', status: 'APPROVED' } }, 200, 'request-1', 'APPROVE'), null)
  assert.equal(confirmedMoneyDecision({ ok: true, result: { requestId: 'request-1', status: 'REJECTED' } }, 200, 'request-1', 'APPROVE'), null)
  assert.equal(confirmedMoneyDecision({ ok: true, result: {} }, 200, 'request-1', 'APPROVE'), null)
})

test('preparation distinguishes a submitted request from a malformed response', () => {
  assert.deepEqual(confirmedMoneyPreparation({ ok: true, result: { requestId: 'request-2', status: 'PENDING_APPROVAL' } }, 200),
    { requestId: 'request-2', state: 'PENDING_APPROVAL' })
  assert.deepEqual(confirmedMoneyPreparation({ ok: true, result: { requestId: 'request-2', status: 'APPROVED' } }, 200),
    { requestId: 'request-2', state: 'APPROVED' })
  assert.equal(confirmedMoneyPreparation({ ok: true, result: {} }, 200), null)
  assert.equal(confirmedMoneyPreparation({ ok: true, result: { requestId: 'request-2', status: 'UNKNOWN' } }, 200), null)
})
