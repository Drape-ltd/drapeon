import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { failedStripeRefundEvidence } from './failed-refund-journal-recovery.ts'

const target = { refundId: 're_failed', paymentIntentId: 'pi_order', amount: 15500 }
const refund = {
  id: 're_failed', status: 'failed', amount: 15500,
  payment_intent: 'pi_order', failure_reason: 'expired_or_canceled_card',
}

Deno.test('requires one failed refund matching the exact payment and amount', () => {
  const now = '2026-11-11T07:20:00.000Z'
  const proof = failedStripeRefundEvidence(target, [refund], now)
  assertEquals(proof, { ok: true, evidence: {
    status: 'failed', refund_id: 're_failed', payment_intent: 'pi_order',
    amount: 15500, failure_reason: 'expired_or_canceled_card', observed_at: now,
  } })
  assertEquals(failedStripeRefundEvidence(target, [], now),
    { ok: false, code: 'PROVIDER_REFUND_NOT_UNIQUE' })
  assertEquals(failedStripeRefundEvidence(target, [refund, refund], now),
    { ok: false, code: 'PROVIDER_REFUND_NOT_UNIQUE' })
  assertEquals(failedStripeRefundEvidence(target, [{ ...refund, status: 'succeeded' }], now),
    { ok: false, code: 'PROVIDER_REFUND_NOT_FAILED' })
  assertEquals(failedStripeRefundEvidence(target, [{ ...refund, amount: 15499 }], now),
    { ok: false, code: 'PROVIDER_REFUND_MISMATCH' })
  assertEquals(failedStripeRefundEvidence(target, [{ ...refund, payment_intent: 'pi_other' }], now),
    { ok: false, code: 'PROVIDER_REFUND_MISMATCH' })
  assertEquals(failedStripeRefundEvidence(target, [{ ...refund, failure_reason: null }], now),
    { ok: false, code: 'PROVIDER_FAILURE_REASON_MISSING' })
})
