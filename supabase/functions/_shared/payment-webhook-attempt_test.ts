import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import type { PaymentAttempt } from './payment-ledger.ts'
import { disputeMatchesPaymentAttempt, materialAdvanceWebhookLinkMismatch, paymentWebhookAttemptMismatch, resolveDisputeAssociation, shouldBlockDisputeMoneyMovement } from './payment-webhook-attempt.ts'

const attempt = {
  id: 'payment-1', order_id: 'order-1', phase: 'ADJUSTMENT', provider: 'STRIPE',
  currency: 'USD', amount: 500, status: 'PENDING', idempotency_key: 'key-1',
  provider_payment_id: 'pi-1', provider_checkout_url: null,
} as PaymentAttempt

Deno.test('payment attempt is authoritative when provider identity matches', () => {
  assertEquals(paymentWebhookAttemptMismatch(attempt, {
    orderId: 'order-1', phase: 'ADJUSTMENT', idempotencyKey: 'key-1', currency: 'usd', amountMinor: 500,
  }), null)
})

Deno.test('metadata order, phase, and idempotency mismatches are rejected', () => {
  for (const [identity, expected] of [
    [{ orderId: 'order-other' }, 'order_id'],
    [{ orderId: 123 }, 'order_id'],
    [{ orderId: '' }, 'order_id'],
    [{ phase: 'INITIAL_ORDER' }, 'phase'],
    [{ phase: 7 }, 'phase'],
    [{ idempotencyKey: 'key-other' }, 'idempotency_key'],
    [{ idempotencyKey: false }, 'idempotency_key'],
    [{ currency: 'GBP' }, 'currency'],
    [{ currency: 'USD', amountMinor: 5 }, 'amount'],
    [{ currency: 'USD', amountMinor: 50000 }, 'amount'],
  ] as const) {
    assertEquals(paymentWebhookAttemptMismatch(attempt, identity), expected)
  }
})

Deno.test('missing optional metadata does not override the linked attempt', () => {
  assertEquals(paymentWebhookAttemptMismatch(attempt, { currency: 'USD', amountMinor: 500 }), null)
})

Deno.test('material advance webhook metadata must match the attempt and exact advance link', () => {
  const materialAttempt = {
    ...attempt,
    phase: 'MATERIAL_ADVANCE',
    provider_response: { material_advance_id: 'advance-1' },
  } as PaymentAttempt
  const advance = {
    id: 'advance-1', order_id: 'order-1', payment_id: 'payment-1',
    payment_provider: 'STRIPE', provider_payment_id: 'pi-1',
  }

  assertEquals(paymentWebhookAttemptMismatch(materialAttempt, { materialAdvanceId: 'advance-other', currency: 'USD', amountMinor: 500 }), 'material_advance_id')
  assertEquals(paymentWebhookAttemptMismatch(materialAttempt, { materialAdvanceId: 'advance-1', currency: 'USD', amountMinor: 500 }), null)
  assertEquals(materialAdvanceWebhookLinkMismatch(materialAttempt, advance, 'advance-1'), null)
  assertEquals(materialAdvanceWebhookLinkMismatch(materialAttempt, advance, 'advance-other'), 'material_advance_id')
  assertEquals(materialAdvanceWebhookLinkMismatch(materialAttempt, { ...advance, payment_id: 'payment-other' }), 'material_advance_payment_attempt')
  assertEquals(materialAdvanceWebhookLinkMismatch(materialAttempt, { ...advance, provider_payment_id: 'pi-other' }), 'material_advance_provider_payment_id')
  assertEquals(materialAdvanceWebhookLinkMismatch(materialAttempt, { ...advance, order_id: 'order-other' }), 'material_advance_order_id')
  assertEquals(materialAdvanceWebhookLinkMismatch(materialAttempt, null), 'material_advance_missing')
})

Deno.test('partial disputes link only to a same-currency payment within the captured amount', () => {
  assertEquals(disputeMatchesPaymentAttempt(attempt, 250, 'usd'), true)
  assertEquals(disputeMatchesPaymentAttempt(attempt, 500, 'USD'), true)
  assertEquals(disputeMatchesPaymentAttempt(attempt, 501, 'USD'), false)
  assertEquals(disputeMatchesPaymentAttempt(attempt, 250, 'GBP'), false)
  assertEquals(disputeMatchesPaymentAttempt(attempt, 250.5, 'USD'), false)
  assertEquals(disputeMatchesPaymentAttempt(null, 250, 'USD'), false)
})

Deno.test('unreconciled dispute update preserves the last known association and stays blocked', () => {
  const prior = { paymentId: 'payment-1', orderId: 'order-1', customerId: 'customer-1', tailorId: 'tailor-1', reconciled: true }
  assertEquals(resolveDisputeAssociation(null, null, prior), { ...prior, reconciled: false })
  assertEquals(shouldBlockDisputeMoneyMovement(false, true), true)
})

Deno.test('terminal dispute can unblock only with a matching payment and its order', () => {
  const association = resolveDisputeAssociation(
    { id: 'payment-1', order_id: 'order-1' },
    { id: 'order-1', customer_id: 'customer-1', tailor_id: 'tailor-1' },
    { paymentId: null, orderId: null, customerId: null, tailorId: null, reconciled: false },
  )
  assertEquals(association, { paymentId: 'payment-1', orderId: 'order-1', customerId: 'customer-1', tailorId: 'tailor-1', reconciled: true })
  assertEquals(shouldBlockDisputeMoneyMovement(association.reconciled, true), false)
  assertEquals(shouldBlockDisputeMoneyMovement(association.reconciled, false), true)
})
