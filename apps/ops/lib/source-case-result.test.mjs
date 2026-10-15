import test from 'node:test'
import assert from 'node:assert/strict'
import { sourceCaseResult } from './source-case-result.mjs'

const id = '12345678-1234-1234-1234-123456789012'
test('new source cases require a persisted receipt; existing cases need an exact destination', () => {
  const receipt = { caseNumber: 'OPS-1234', caseId: id }
  assert.equal(sourceCaseResult({ ok: true, receipt }), null)
  assert.equal(sourceCaseResult({ ok: false, receipt: { ...receipt, receiptId: id } }), null)
  assert.equal(sourceCaseResult({ ok: true, receipt: { ...receipt, existing: true } }).existing, true)
  assert.equal(sourceCaseResult({ ok: true, receipt: { ...receipt, receiptId: id } }).receiptId, id)
  assert.equal(sourceCaseResult({ ok: true, receipt: { ...receipt, existing: true, caseNumber: '//evil.test' } }), null)
})
