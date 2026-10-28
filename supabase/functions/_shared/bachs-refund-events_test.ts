import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { matchBachsRefundClaim, parseBachsRefundLifecycleEvent } from './bachs-refund-events.ts'
import type { BachsConnectEvent } from './bachs-connect-events.ts'

function refundEvent(type: string, overrides: Record<string, unknown> = {}): BachsConnectEvent {
  const data = {
    refund_id: 'rfnd_test123',
    charge_id: 'ch_test123',
    reference: 'refund:payment-1:0:5000',
    status: type === 'refund.created' ? 'processing' : type === 'refund.paid' ? 'success' : 'failed',
    requested_amount: '50.00',
    refunded_amount: type === 'refund.paid' ? '50.00' : null,
    ...overrides,
  }
  return {
    id: 'evt_test123',
    type,
    organization_id: 'acct_platform1',
    data,
  }
}

Deno.test('Bachs refund parser accepts the three documented lifecycle states', () => {
  assertEquals(parseBachsRefundLifecycleEvent(refundEvent('refund.created'))?.status, 'processing')
  assertEquals(parseBachsRefundLifecycleEvent(refundEvent('refund.paid'))?.status, 'success')
  assertEquals(parseBachsRefundLifecycleEvent(refundEvent('refund.failed'))?.status, 'failed')
  assertEquals(parseBachsRefundLifecycleEvent({ ...refundEvent('collection.succeeded') }), null)
})

Deno.test('Bachs refund parser rejects identity, account and status mismatches', () => {
  assertThrows(
    () => parseBachsRefundLifecycleEvent(refundEvent('refund.paid', { status: 'processing' })),
    Error,
    'BACHS_REFUND_EVENT_IDENTITY_INVALID',
  )
  assertThrows(
    () => parseBachsRefundLifecycleEvent(refundEvent('refund.created', { charge_id: 'not-a-charge' })),
    Error,
    'BACHS_REFUND_EVENT_IDENTITY_INVALID',
  )
  assertThrows(
    () => parseBachsRefundLifecycleEvent({ ...refundEvent('refund.paid'), account: 'acct_other' }),
    Error,
    'BACHS_REFUND_EVENT_IDENTITY_INVALID',
  )
  assertThrows(
    () => parseBachsRefundLifecycleEvent(refundEvent('refund.paid', { refunded_amount: null })),
    Error,
    'BACHS_REFUND_EVENT_AMOUNT_INVALID',
  )
})

Deno.test('Bachs refund claim matcher binds provider, charge, reference and exact NGN amount', () => {
  const event = parseBachsRefundLifecycleEvent(refundEvent('refund.paid'))!
  const claim = {
    provider: 'BACHS',
    provider_payment_id: 'ch_test123',
    provider_refund_id: null,
    operation_key: event.reference,
    currency: 'NGN',
    refund_amount: 5000,
  }
  assertEquals(matchBachsRefundClaim({ event, claim }), { matches: true, reason: null })
  assertEquals(
    matchBachsRefundClaim({ event, claim: { ...claim, provider_payment_id: 'ch_other' } }).reason,
    'refund_charge_mismatch',
  )
  assertEquals(
    matchBachsRefundClaim({ event, claim: { ...claim, provider_refund_id: 'rfnd_other' } }).reason,
    'refund_id_mismatch',
  )
  assertEquals(
    matchBachsRefundClaim({ event, claim: { ...claim, refund_amount: 4999 } }).reason,
    'refund_requested_amount_mismatch',
  )
  assertEquals(
    matchBachsRefundClaim({ event, claim: { ...claim, operation_key: 'other' } }).reason,
    'refund_reference_mismatch',
  )
  assertEquals(matchBachsRefundClaim({ event, claim: null }).reason, 'refund_claim_not_found')
})

Deno.test('Bachs refund paid event rejects refunded total that differs from reserved amount', () => {
  const event = parseBachsRefundLifecycleEvent(refundEvent('refund.paid', { refunded_amount: '49.99' }))!
  const result = matchBachsRefundClaim({
    event,
    claim: {
      provider: 'BACHS',
      provider_payment_id: 'ch_test123',
      provider_refund_id: null,
      operation_key: event.reference,
      currency: 'NGN',
      refund_amount: 5000,
    },
  })
  assertEquals(result, { matches: false, reason: 'refund_paid_amount_mismatch' })
})
