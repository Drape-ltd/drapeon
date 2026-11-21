import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import {
  bachsWithdrawalFeeReserveMinor,
  planBachsWithdrawalFeeReserve,
  reconcileBachsWithdrawalFee,
} from './bachs-withdrawal-fee.ts'

Deno.test('the default fee reserve is NGN 100 in minor units', () => {
  assertEquals(bachsWithdrawalFeeReserveMinor(undefined), 10_000)
  assertEquals(bachsWithdrawalFeeReserveMinor('5000'), 5_000)
  assertThrows(() => bachsWithdrawalFeeReserveMinor('50001'))
})

Deno.test('the reserve only tops up an already transferred earning once', () => {
  assertEquals(planBachsWithdrawalFeeReserve({
    availableMinor: 700_000,
    withdrawalAmountMinor: 700_000,
    reserveMinor: 10_000,
  }), { topUpMinor: 10_000, expectedAvailableAfterTopUpMinor: 710_000 })
  assertThrows(() => planBachsWithdrawalFeeReserve({
    availableMinor: 800_000,
    withdrawalAmountMinor: 700_000,
    reserveMinor: 10_000,
  }))
})

Deno.test('provider fee evidence controls the platform cost and exact sweep', () => {
  const base = {
    payoutId: 'pay_test_fee_1',
    payoutAmount: '7000.00',
    payoutCurrency: 'NGN',
    expectedAmountMinor: 700_000,
    reserveMinor: 10_000,
  }
  assertEquals(reconcileBachsWithdrawalFee({ ...base, fee: null }), {
    state: 'PENDING_FEE', payoutId: base.payoutId,
  })
  assertEquals(reconcileBachsWithdrawalFee({ ...base, fee: '50.000000000000000000' }), {
    state: 'FEE_CONFIRMED', payoutId: base.payoutId, actualFeeMinor: 5_000, sweepMinor: 5_000,
  })
  assertEquals(reconcileBachsWithdrawalFee({ ...base, fee: '100.00' }), {
    state: 'FEE_CONFIRMED', payoutId: base.payoutId, actualFeeMinor: 10_000, sweepMinor: 0,
  })
  assertThrows(() => reconcileBachsWithdrawalFee({ ...base, fee: '101.00' }))
  assertThrows(() => reconcileBachsWithdrawalFee({ ...base, payoutAmount: '7001.00', fee: '50.00' }))
})
