import test from 'node:test'
import assert from 'node:assert/strict'
import { validTrustExceptionAction, validTrustExceptionRead } from './trust-exception-response.ts'

const record = { id: 'case-1', caseNumber: 'OPS-123', recordVersion: 1, status: 'OPEN', metadata: {} }
const requirements = { name: true, phone: false, avatar: true, specialties: true, portfolio: true }

test('waiver read accepts a complete case and explicit profile requirements', () => {
  assert.equal(validTrustExceptionRead({ ok: true, case: record, profileRequirements: requirements }), true)
  assert.equal(validTrustExceptionRead({ ok: true, case: null, profileRequirements: null }), true)
})

test('waiver read rejects malformed success without enabling a decision', () => {
  for (const value of [
    { ok: true },
    { ok: true, case: { ...record, metadata: null }, profileRequirements: requirements },
    { ok: true, case: record, profileRequirements: { ...requirements, phone: 'yes' } },
    { ok: true, case: { ...record, recordVersion: '1' }, profileRequirements: requirements },
  ]) assert.equal(validTrustExceptionRead(value), false)
})

test('waiver action requires a valid persisted case', () => {
  assert.equal(validTrustExceptionAction({ ok: true, case: record }), true)
  assert.equal(validTrustExceptionAction({ ok: true, case: null }), false)
  assert.equal(validTrustExceptionAction({ ok: true, case: { ...record, id: '' } }), false)
})
