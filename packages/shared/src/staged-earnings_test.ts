import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import { projectStagedEarningsOrder, stagedEarningsOrderDisplay, stagedEarningsReadUnavailable, summarizeStagedEarnings } from './staged-earnings.ts'

const tranches = [
  { id: 'custody', amount: 8400, currency: 'USD', status: 'RELEASED' },
  { id: 'delivery', amount: 2400, currency: 'USD', status: 'LOCKED' },
  { id: 'completion', amount: 1200, currency: 'USD', status: 'LOCKED' },
]
const payout = {
  settlement_tranche_id: 'custody', payout_purpose: 'SETTLEMENT_TRANCHE',
  amount: 8400, currency: 'USD', provider: 'STRIPE', status: 'PROCESSING',
  provider_transfer_status: 'AVAILABLE_IN_PROVIDER_BALANCE',
  initiated_at: '2026-11-10T12:00:00Z',
}

Deno.test('a released custody tranche leaves only later tranches pending', () => {
  assertEquals(summarizeStagedEarnings(tranches, [payout]), {
    currency: 'USD', total: 12000, pending: 3600, available: 0,
    inProviderBalance: 8400, paidToBank: 0,
  })
})

Deno.test('eligible tranches are available and failed attempts do not replace a later payout', () => {
  const result = summarizeStagedEarnings(
    [...tranches, { id: 'extra', amount: 1000, currency: 'USD', status: 'ELIGIBLE' }],
    [{ ...payout, status: 'FAILED', initiated_at: '2026-11-09T12:00:00Z' }, payout],
  )
  assertEquals(result?.available, 1000)
  assertEquals(result?.inProviderBalance, 8400)
})

Deno.test('missing or mismatched release evidence fails closed', () => {
  assertThrows(() => summarizeStagedEarnings(tranches, []), Error, 'STAGED_EARNINGS_PAYOUT_MISMATCH')
  assertThrows(() => summarizeStagedEarnings(tranches, [{ ...payout, amount: 8500 }]), Error, 'STAGED_EARNINGS_PAYOUT_MISMATCH')
})

Deno.test('cancelled tranches are excluded and currencies cannot mix', () => {
  assertEquals(summarizeStagedEarnings([{ ...tranches[0], status: 'CANCELLED' }], []), null)
  assertThrows(() => summarizeStagedEarnings([...tranches, { id: 'other', amount: 100, currency: 'CAD', status: 'LOCKED' }], [payout]), Error, 'STAGED_EARNINGS_AMOUNT_CONFLICT')
})

Deno.test('C1 delivery-fee refund does not block a released custody tranche card', () => {
  // The order payment is PARTIAL_REFUND and the order stage is PARTIALLY_REFUNDED.
  // Those order-wide fields cannot override the authoritative tranche states.
  assertEquals(stagedEarningsOrderDisplay(tranches, [payout]), {
    status: 'IN_PROVIDER_BALANCE',
    reason: '$84.00 in your provider balance; $36.00 pending release. Bank withdrawals are tracked separately.',
  })
})

Deno.test('a blocked tranche stays visible even when another tranche has reached Stripe', () => {
  assertEquals(stagedEarningsOrderDisplay(
    [tranches[0]!, { ...tranches[1]!, status: 'BLOCKED' }], [payout],
  )?.status, 'BLOCKED')
})

Deno.test('an eligible later tranche is named without inventing a pending amount', () => {
  assertEquals(stagedEarningsOrderDisplay(
    [tranches[0]!, { ...tranches[1]!, status: 'ELIGIBLE' }], [payout],
  )?.reason, '$84.00 in your provider balance; $24.00 eligible. Bank withdrawals are tracked separately.')
})

Deno.test('a later successful payout supersedes a failed attempt on the same tranche', () => {
  assertEquals(stagedEarningsOrderDisplay(tranches, [
    { ...payout, status: 'FAILED', initiated_at: '2026-11-09T12:00:00Z' },
    payout,
  ])?.status, 'IN_PROVIDER_BALANCE')
  assertEquals(stagedEarningsOrderDisplay(tranches, [
    { ...payout, status: 'FAILED', provider_transfer_status: 'FAILED' },
  ])?.status, 'BLOCKED')
})

Deno.test('legacy orders without active tranches retain their own payout status path', () => {
  assertEquals(stagedEarningsOrderDisplay([], []), null)
  assertEquals(stagedEarningsOrderDisplay([{ ...tranches[0]!, status: 'CANCELLED' }], []), null)
})

Deno.test('failed staged reads cannot fall back to a whole-order money status', () => {
  assertEquals(stagedEarningsReadUnavailable({
    trancheErrorCode: '42501', payoutReadFailed: false, tranches: [], payouts: [],
  }), true)
  assertEquals(stagedEarningsReadUnavailable({
    trancheErrorCode: null, payoutReadFailed: true, tranches, payouts: [],
  }), true)
  assertEquals(stagedEarningsReadUnavailable({
    trancheErrorCode: '42P01', payoutReadFailed: false, tranches: [], payouts: [payout],
  }), true)
  assertEquals(stagedEarningsReadUnavailable({
    trancheErrorCode: '42P01', payoutReadFailed: false, tranches: [], payouts: [],
  }), false)
  assertEquals(stagedEarningsReadUnavailable({
    trancheErrorCode: 'PGRST205', payoutReadFailed: false, tranches: [], payouts: [],
  }), false)
  assertEquals(stagedEarningsReadUnavailable({
    trancheErrorCode: null, payoutReadFailed: false, tranches: [], payouts: [payout],
  }), false)
})

Deno.test('open dispute overrides locked staged tranches', () => {
  const result = projectStagedEarningsOrder(tranches.map((row) => ({ ...row, status: 'LOCKED' })), [], { openDispute: true })
  assertEquals(result.display, { status: 'BLOCKED', reason: 'Open dispute: unreleased earnings are on hold.' })
})

Deno.test('open dispute holds later tranches and names an already released amount', () => {
  const result = projectStagedEarningsOrder(tranches, [payout], { openDispute: true })
  assertEquals(result.display, {
    status: 'BLOCKED',
    reason: 'Open dispute: later tranches are on hold. $84.00 is already in your provider balance.',
  })
  assertEquals(result.summary?.inProviderBalance, 8400)
})

Deno.test('one malformed payout blocks only its order and excludes its staged totals', () => {
  const bad = projectStagedEarningsOrder(tranches, [])
  const good = projectStagedEarningsOrder(tranches, [payout])
  assertEquals(bad.errorCode, 'STAGED_EARNINGS_PAYOUT_MISMATCH')
  assertEquals(bad.summary, null)
  assertEquals(bad.display, { status: 'BLOCKED', reason: "This order's payout record needs Drapeon Ops review." })
  assertEquals(good.summary?.inProviderBalance, 8400)
  assertEquals(projectStagedEarningsOrder([], [payout]).errorCode, 'STAGED_EARNINGS_TRANCHES_UNAVAILABLE')
})
