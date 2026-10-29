import { assertEquals } from 'jsr:@std/assert@1'
import { assessBachsPaymentSettlement, type BachsSettlementAttempt } from './bachs-payment-settlement.ts'
import type { BachsPayment } from './bachs-operations.ts'

const attempt: BachsSettlementAttempt = {
  id: 'payment-1',
  provider: 'BACHS',
  provider_payment_id: 'chk_1',
  provider_charge_id: 'ch_1',
  idempotency_key: 'order:1:initial',
  currency: 'NGN',
  amount: 700001,
}

const payment: BachsPayment = {
  payment_id: 'ch_1',
  checkout_id: 'chk_1',
  reference: 'order:1:initial',
  status: 'succeeded',
  amount: '7000.01',
  amount_paid: '7000.01',
  currency: 'NGN',
  fees: { amount: '105.00', currency: 'NGN' },
  fee_paid_by: 'merchant',
  updated_at: '2026-10-28T18:30:00Z',
  completed_at: '2026-10-28T18:29:00Z',
}
const settlementEvidence = {
  providerEventId: 'evt_1',
  settlementAmountMinor: 689501,
  settlementCurrency: 'NGN',
  processingFeeAmountMinor: 10500,
  processingFeeCurrency: 'NGN',
}

Deno.test('Bachs settled fee evidence is matched in minor units and retains fee payer', () => {
  assertEquals(assessBachsPaymentSettlement({ attempt, payment, settlementEvidence }), {
    kind: 'SETTLED',
    settlementMinor: 689501,
    settlementCurrency: 'NGN',
    feeMinor: 10500,
    feeCurrency: 'NGN',
    feePaidBy: 'merchant',
    providerUpdatedAt: '2026-10-28T18:30:00Z',
    providerCompletedAt: '2026-10-28T18:29:00Z',
  })
})

Deno.test('succeeded without final fees remains pending until Bachs reports settlement evidence', () => {
  assertEquals(assessBachsPaymentSettlement({
    attempt,
    payment: { ...payment, fees: null, fee_paid_by: null },
    settlementEvidence,
  }), { kind: 'PENDING', reason: 'fee_not_final' })
  assertEquals(assessBachsPaymentSettlement({
    attempt,
    payment: { ...payment, status: 'processing' },
    settlementEvidence,
  }), { kind: 'PENDING', reason: 'payment_not_settled' })
})

Deno.test('conflicting checkout, charge, reference, currency, or gross amount goes to review', () => {
  assertEquals(assessBachsPaymentSettlement({ attempt, payment: { ...payment, checkout_id: 'chk_other' }, settlementEvidence }), {
    kind: 'REVIEW', reason: 'payment_identity_mismatch',
  })
  assertEquals(assessBachsPaymentSettlement({ attempt, payment: { ...payment, payment_id: 'ch_other' }, settlementEvidence }), {
    kind: 'REVIEW', reason: 'payment_identity_mismatch',
  })
  assertEquals(assessBachsPaymentSettlement({ attempt, payment: { ...payment, reference: 'other' }, settlementEvidence }), {
    kind: 'REVIEW', reason: 'payment_identity_mismatch',
  })
  assertEquals(assessBachsPaymentSettlement({ attempt, payment: { ...payment, currency: 'USD' }, settlementEvidence }), {
    kind: 'REVIEW', reason: 'payment_identity_mismatch',
  })
  assertEquals(assessBachsPaymentSettlement({ attempt, payment: { ...payment, amount: '7000.00' }, settlementEvidence }), {
    kind: 'REVIEW', reason: 'payment_amount_mismatch',
  })
})

Deno.test('fee evidence rejects foreign currency, unknown payer, and impossible amount', () => {
  assertEquals(assessBachsPaymentSettlement({
    attempt,
    payment: { ...payment, fees: { amount: '1.00', currency: 'USD' } },
    settlementEvidence,
  }), { kind: 'REVIEW', reason: 'fee_identity_mismatch' })
  assertEquals(assessBachsPaymentSettlement({
    attempt,
    payment: { ...payment, fee_paid_by: 'customer' },
    settlementEvidence,
  }), { kind: 'REVIEW', reason: 'fee_identity_mismatch' })
  assertEquals(assessBachsPaymentSettlement({
    attempt,
    payment: { ...payment, fees: { amount: '7000.02', currency: 'NGN' } },
    settlementEvidence,
  }), { kind: 'REVIEW', reason: 'fee_identity_mismatch' })
})

Deno.test('settlement net must come from a signed event and its fee must match the GET receipt', () => {
  assertEquals(assessBachsPaymentSettlement({
    attempt,
    payment,
    settlementEvidence: { ...settlementEvidence, settlementAmountMinor: null },
  }), { kind: 'REVIEW', reason: 'settlement_net_evidence_missing' })
  assertEquals(assessBachsPaymentSettlement({
    attempt,
    payment,
    settlementEvidence: { ...settlementEvidence, processingFeeAmountMinor: 10499 },
  }), { kind: 'REVIEW', reason: 'settlement_fee_event_mismatch' })
  assertEquals(assessBachsPaymentSettlement({
    attempt,
    payment,
    settlementEvidence: { ...settlementEvidence, settlementCurrency: 'USD' },
  }), { kind: 'REVIEW', reason: 'settlement_fee_event_mismatch' })
})

Deno.test('a zero fee is valid final evidence without manufacturing a ledger debit', () => {
  assertEquals(assessBachsPaymentSettlement({
    attempt,
    payment: { ...payment, fees: { amount: '0.00', currency: 'NGN' }, fee_paid_by: 'platform' },
    settlementEvidence: { ...settlementEvidence, settlementAmountMinor: 700001, processingFeeAmountMinor: 0 },
  }), {
    kind: 'SETTLED', settlementMinor: 700001, settlementCurrency: 'NGN', feeMinor: 0, feeCurrency: 'NGN', feePaidBy: 'platform',
    providerUpdatedAt: '2026-10-28T18:30:00Z', providerCompletedAt: '2026-10-28T18:29:00Z',
  })
})
