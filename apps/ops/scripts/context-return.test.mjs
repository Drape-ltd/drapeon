import { test } from 'node:test'
import assert from 'node:assert/strict'
import { opsContextReturn } from '../lib/context-return.mjs'

test('keeps source records and filtered queue state', () => {
  for (const value of ['/ops/providers?jobType=EMAIL&page=2#job-ledger', '/ops/queues/trust?caseType=TAILOR_VERIFICATION', '/ops/orders/3c09f9ab-7893-44bc-b913-31287b6ab9bc', '/ops/cases/OPS-12345678']) assert.equal(opsContextReturn(value), value)
})
test('rejects external, malformed and non-workspace destinations', () => {
  for (const value of [null, '//evil.test', 'https://evil.test', '/ops/../api/action', '/ops/orders/%2e%2e', '/ops/my-work\\evil', '/ops/my-work\n', '/ops/admin/access', '/api/actions/retry', '/ops/my-work?' + 'x'.repeat(2048)]) assert.equal(opsContextReturn(value), null)
})

test('preserves filtered job and communication pages through an encoded case link', () => {
  for (const source of ['/ops/providers?jobState=DEAD&jobType=SEND_OPS_VERIFICATION_EMAIL&page=2#job-ledger', '/ops/communications?view=dead-jobs&page=3#communication-job-ledger', '/ops/customers/f3b5e7ab-d1f4-4206-9b45-e28708af35e8', '/ops/tailors/4ad11c37-d70e-4a8b-877e-22e1dd4d78cc']) {
    const link = new URL(`/ops/cases/OPS-12345678?returnTo=${encodeURIComponent(source)}`, 'https://ops.example.test')
    assert.equal(opsContextReturn(link.searchParams.get('returnTo')), source)
  }
})
