import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  isUnclaimedAdjustmentForReview,
  isUnclaimedTrancheForReview,
  keyAfterMoneyDeskHistory,
  resolveMoneyDeskTargetRetryKey,
} from './money-desk-target-retry.mjs'

const base = 'settlement-tranche-release:tranche-1'
const failed = { id: 'failed-1', status: 'FAILED', idempotency_key: base }

test('a terminal failed request gets a distinct reviewed operation key', () => {
  assert.equal(keyAfterMoneyDeskHistory(base, failed, false), `${base}:after:failed-1`)
  assert.equal(keyAfterMoneyDeskHistory(base, { ...failed, id: 'failed-2' }, false),
    `${base}:after:failed-2`)
  assert.equal(keyAfterMoneyDeskHistory(base, null, false), base)
})

test('a double submit reuses the active request key', () => {
  assert.equal(keyAfterMoneyDeskHistory(base, {
    id: 'active-1', status: 'PENDING_APPROVAL', idempotency_key: `${base}:after:failed-1`,
  }, false), `${base}:after:failed-1`)
  for (const status of ['APPROVED', 'EXECUTING']) {
    assert.equal(keyAfterMoneyDeskHistory(base, {
      id: 'active-1', status, idempotency_key: `${base}:after:failed-1`,
    }, false), `${base}:after:failed-1`)
  }
})

test('a succeeded request blocks a new review even if a later request failed', () => {
  assert.throws(() => keyAfterMoneyDeskHistory(base, failed, true), /already succeeded/)
  assert.throws(() => keyAfterMoneyDeskHistory(base,
    { id: 'paid', status: 'SUCCEEDED', idempotency_key: base }, false), /already succeeded/)
})

test('cancelled and rejected reviews can be replaced; unknown state fails closed', () => {
  for (const status of ['CANCELLED', 'REJECTED']) {
    assert.equal(keyAfterMoneyDeskHistory(base, { ...failed, status }, false),
      `${base}:after:failed-1`)
  }
  assert.throws(() => keyAfterMoneyDeskHistory(base, { ...failed, status: 'MYSTERY' }, false),
    /unknown status/)
})

function fakeClient({ latest, active = null, succeeded = false, error = null }) {
  return {
    from(table) {
      assert.equal(table, 'money_desk_requests')
      const filters = {}
      const query = {
        select() { return query },
        eq(name, value) { filters[name] = value; return query },
        in(name, value) { filters[name] = value; return query },
        order() { return query },
        limit() {
          assert.equal(filters.action_type, 'PAYOUT_RELEASE')
          assert.equal(filters.target_type, 'SETTLEMENT_TRANCHE')
          assert.equal(filters.target_id, 'tranche-1')
          return Promise.resolve({
            data: filters.status === 'SUCCEEDED' ? (succeeded ? [{ id: 'paid' }] : []) :
              Array.isArray(filters.status) ? (active ? [active] : []) :
                (latest ? [latest] : []),
            error,
          })
        },
      }
      return query
    },
  }
}

test('database lookup selects the failed predecessor and rejects lookup failures', async () => {
  const args = { actionType: 'PAYOUT_RELEASE', targetType: 'SETTLEMENT_TRANCHE',
    targetId: 'tranche-1', baseKey: base }
  assert.equal(await resolveMoneyDeskTargetRetryKey(fakeClient({ latest: failed }), args),
    `${base}:after:failed-1`)
  await assert.rejects(resolveMoneyDeskTargetRetryKey(fakeClient({ error: new Error('db') }), args),
    /history could not be checked/)
  await assert.rejects(resolveMoneyDeskTargetRetryKey(fakeClient({ latest: failed, succeeded: true }), args),
    /already succeeded/)
  assert.equal(await resolveMoneyDeskTargetRetryKey(fakeClient({
    latest: failed,
    active: { id: 'active-1', status: 'APPROVED', idempotency_key: `${base}:after:older` },
  }), args), `${base}:after:older`)
})

test('released or claimed tranches cannot enter a fresh review', () => {
  const tranche = { status: 'ELIGIBLE', order_id: 'order-1', amount: 8400,
    currency: 'USD', payout_id: null, money_desk_request_id: null,
    release_ledger_transaction_id: null }
  const expected = { orderId: 'order-1', amount: 8400, currency: 'USD', claimCount: 0 }
  const plan = { status: 'ACTIVE' }
  assert.equal(isUnclaimedTrancheForReview(tranche, plan, expected), true)
  assert.equal(isUnclaimedTrancheForReview({ ...tranche, status: 'RELEASED' }, plan, expected), false)
  assert.equal(isUnclaimedTrancheForReview({ ...tranche, payout_id: 'payout' }, plan, expected), false)
  assert.equal(isUnclaimedTrancheForReview(tranche, plan, { ...expected, claimCount: 1 }), false)
  assert.equal(isUnclaimedTrancheForReview(tranche, plan, { ...expected, amount: 8500 }), false)
  assert.equal(isUnclaimedTrancheForReview(tranche, { status: 'FROZEN' }, expected), false)
})

test('claimed adjustment is blocked before review', () => {
  assert.equal(isUnclaimedAdjustmentForReview(0, 0), true)
  assert.equal(isUnclaimedAdjustmentForReview(1, 0), false)
  assert.equal(isUnclaimedAdjustmentForReview(0, 1), false)
})
