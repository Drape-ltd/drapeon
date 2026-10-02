import test from 'node:test'
import assert from 'node:assert/strict'
import { validProtectedActionSuccess } from './protected-action-response.ts'

test('protected action needs a terminal successful receipt, not just HTTP success', () => {
  assert.equal(validProtectedActionSuccess({ ok: true }), false)
  assert.equal(validProtectedActionSuccess({ ok: true, receipt: { id: 'r1', outcome: 'PENDING' } }), false)
  assert.equal(validProtectedActionSuccess({ ok: true, receipt: { id: 'r1', outcome: 'FAILED' } }), false)
  assert.equal(validProtectedActionSuccess({ ok: true, receipt: { id: 'r1', outcome: 'SUCCEEDED' } }), true)
  assert.equal(validProtectedActionSuccess({ ok: true, duplicate: true, receipt: { receiptId: 'r1', receiptOutcome: 'PENDING' } }), false)
  assert.equal(validProtectedActionSuccess({ ok: true, duplicate: true, receipt: { receiptId: 'r1', receiptOutcome: 'SUCCEEDED' } }), true)
})
