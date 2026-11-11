import assert from 'node:assert/strict'
import test from 'node:test'
import { collapseReplacedPayoutAttempts } from './payout-attempts'

const base = { orderId: 'order-1', purpose: 'FABRIC_FUNDING', amount: 8000, currency: 'USD', failedAt: null }

test('a failed attempt replaced by a later success folds under it', () => {
  const rows = collapseReplacedPayoutAttempts([
    { ...base, id: 'ok', status: 'PAID', initiatedAt: '2026-11-02T12:00:00Z' },
    { ...base, id: 'failed', status: 'FAILED', initiatedAt: '2026-11-02T10:00:00Z', failedAt: '2026-11-02T10:05:00Z' },
  ])
  assert.deepEqual(rows.map((row) => row.id), ['ok'])
  assert.deepEqual(rows[0].replacedAttempts, [{ id: 'failed', failedAt: '2026-11-02T10:05:00Z', initiatedAt: '2026-11-02T10:00:00Z' }])
})

test('a failure with no later replacement stays visible as its own row', () => {
  const rows = collapseReplacedPayoutAttempts([
    { ...base, id: 'failed', status: 'FAILED', initiatedAt: '2026-11-02T10:00:00Z' },
    { ...base, id: 'other-amount', status: 'PAID', amount: 8400, initiatedAt: '2026-11-03T10:00:00Z' },
    { ...base, id: 'earlier-success', status: 'PAID', purpose: 'FABRIC_FUNDING', initiatedAt: '2026-11-01T10:00:00Z', orderId: 'order-2' },
  ])
  assert.deepEqual(rows.map((row) => row.id), ['failed', 'other-amount', 'earlier-success'])
  assert.deepEqual(rows[0].replacedAttempts, [])
})

test('a success that started before the failure does not replace it', () => {
  const rows = collapseReplacedPayoutAttempts([
    { ...base, id: 'old-ok', status: 'PAID', initiatedAt: '2026-11-01T10:00:00Z' },
    { ...base, id: 'failed', status: 'FAILED', initiatedAt: '2026-11-02T10:00:00Z' },
  ])
  assert.deepEqual(rows.map((row) => row.id), ['old-ok', 'failed'])
})
