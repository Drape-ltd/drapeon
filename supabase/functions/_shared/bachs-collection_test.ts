import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { matchBachsCollection, type BachsCollectionSucceeded } from './bachs-collection.ts'

const event: BachsCollectionSucceeded = {
  id: 'evt_test', type: 'collection.succeeded', organization_id: 'acct_platform',
  data: {
    checkout_id: 'chk_test', charge_id: 'ch_test', reference: 'payment:test', status: 'SUCCEEDED',
    amount: '7000.01', currency: 'NGN', settlement_amount: '6930.01', settlement_currency: 'NGN', processing_fee: '70.00', processing_fee_currency: 'NGN',
  },
}
const attempt = {
  provider: 'BACHS', provider_payment_id: 'chk_test', provider_charge_id: null,
  idempotency_key: 'payment:test', currency: 'NGN', amount: 700001,
}

Deno.test('Bachs collection matches exact checkout, charge, reference and minor units', () => {
  assertEquals(matchBachsCollection({ event, attempt, platformAccountId: 'acct_platform' }), {
    outcome: 'MATCH', chargeId: 'ch_test', settledMinor: 693001, feeMinor: 7000,
  })
})

Deno.test('Bachs collection never matches by order metadata or approximate amount', () => {
  assertEquals(matchBachsCollection({ event, attempt: null, platformAccountId: 'acct_platform' }).outcome, 'UNMATCHED')
  assertEquals(matchBachsCollection({ event, attempt: { ...attempt, amount: 70000100 }, platformAccountId: 'acct_platform' }).outcome, 'IDENTITY_CONFLICT')
  assertEquals(matchBachsCollection({ event, attempt: { ...attempt, idempotency_key: 'another' }, platformAccountId: 'acct_platform' }).outcome, 'IDENTITY_CONFLICT')
})

Deno.test('Bachs collection from a connected account or without a charge fails closed', () => {
  assertEquals(matchBachsCollection({ event: { ...event, account: 'acct_tailor' }, attempt, platformAccountId: 'acct_platform' }).outcome, 'IDENTITY_CONFLICT')
  assertEquals(matchBachsCollection({ event: { ...event, data: { ...event.data, charge_id: null } }, attempt, platformAccountId: 'acct_platform' }).outcome, 'UNRECONCILABLE')
})
