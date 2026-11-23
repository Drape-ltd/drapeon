import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { customerVisibleMoneyStageNote, tailorVisibleMoneyStageNote, presentCustomerRefundReceipt, publicCancellationRefundStageNote } from './refund-receipt.ts'

Deno.test('customer refund receipt formats minor units and a Drapeon reference', () => {
  assertEquals(presentCustomerRefundReceipt({
    refund_reference: 'DRF-ABC123', amount_minor: 13531, currency: 'USD',
    refund_status: 'COMPLETED', recorded_at: '2026-11-08T16:41:47Z',
  }), {
    status: 'Refund completed', amount: '$135.31', date: 'Nov 8, 2026', reference: 'DRF-ABC123',
  })
})

Deno.test('internal review rationale stays out of customer stage copy', () => {
  assertEquals(customerVisibleMoneyStageNote('REFUNDED', 'Dev QA D1: internal money rationale'),
    'Your refund has been recorded. See the refund record for the amount and date.')
  assertEquals(tailorVisibleMoneyStageNote('REFUNDED', 'Dev QA D1: internal money rationale'),
    'This order was refunded. See the order status for details.')
  assertEquals(customerVisibleMoneyStageNote('IN_DISPUTE', 'Customer requested cancellation review.'),
    'Customer requested cancellation review.')
})

Deno.test('Money Desk cancellation stage note is fixed public copy', () => {
  assertEquals(publicCancellationRefundStageNote(),
    'Drapeon approved the cancellation and refunded the captured payments.')
})

Deno.test('unsettled refunds never read as completed', () => {
  for (const [raw, expected] of [
    ['PROCESSING', 'Refund processing'],
    ['FAILED', 'This refund attempt did not complete. Drapeon is handling it; no action is needed from you.'],
  ]) {
    assertEquals(presentCustomerRefundReceipt({
      refund_reference: 'DRF-ABC123', amount_minor: 300, currency: 'USD',
      refund_status: raw, recorded_at: '2026-11-09T02:41:05Z',
    }).status, expected)
  }
})
