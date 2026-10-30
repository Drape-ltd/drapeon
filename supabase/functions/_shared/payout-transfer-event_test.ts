import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { assessPayoutTransferEvent } from './payout-transfer-event.ts'

const payout = {
  status: 'PROCESSING', amount: 1000, currency: 'USD',
  providerDestinationId: 'acct_tailor', providerTransferId: 'tr_exact',
}

Deno.test('platform transfer.created keeps the pinned destination and advances only matching identity', () => {
  assertEquals(assessPayoutTransferEvent({
    payout,
    transfer: { id: 'tr_exact', amount: 1000, currency: 'usd', destination: 'acct_tailor' },
    eventType: 'transfer.created',
  }), { matches: true, mismatches: [], nextStatus: 'PROCESSING', preserveCompletedAt: false })
})

Deno.test('late transfer.created never moves PAID backward', () => {
  const result = assessPayoutTransferEvent({
    payout: { ...payout, status: 'PAID' },
    transfer: { id: 'tr_exact', amount: 1000, currency: 'usd', destination: 'acct_tailor' },
    eventType: 'transfer.created',
  })
  assertEquals(result.nextStatus, 'PAID')
  assertEquals(result.preserveCompletedAt, true)
})

Deno.test('mismatched transfer identity is rejected before mutation', () => {
  assertEquals(assessPayoutTransferEvent({
    payout,
    transfer: { id: 'tr_wrong', amount: 900, currency: 'ngn', destination: 'acct_wrong' },
    eventType: 'transfer.created',
  }).mismatches, ['DESTINATION', 'AMOUNT', 'CURRENCY', 'TRANSFER_ID'])
})

