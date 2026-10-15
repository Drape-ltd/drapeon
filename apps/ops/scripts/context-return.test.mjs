import { test } from 'node:test'
import assert from 'node:assert/strict'
import { opsContextReturn } from '../lib/context-return.mjs'

test('keeps source records and filtered queue state', () => {
  for (const value of ['/ops/providers?jobType=EMAIL&page=2#job-ledger', '/ops/queues/trust?caseType=TAILOR_VERIFICATION', '/ops/orders/3c09f9ab-7893-44bc-b913-31287b6ab9bc', '/ops/cases/OPS-12345678']) assert.equal(opsContextReturn(value), value)
})
test('rejects external, malformed and non-workspace destinations', () => {
  for (const value of [null, '//evil.test', 'https://evil.test', '/ops/../api/action', '/ops/orders/%2e%2e', '/ops/my-work\\evil', '/ops/my-work\n', '/ops/admin/access', '/api/actions/retry', '/ops/my-work?' + 'x'.repeat(2048)]) assert.equal(opsContextReturn(value), null)
})
