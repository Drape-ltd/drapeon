import { bachsAmountMinor } from './bachs.ts'
import type { BachsPayment } from './bachs-operations.ts'

export type BachsSettlementAttempt = {
  id: string
  provider: string
  provider_payment_id: string | null
  provider_charge_id: string | null
  idempotency_key: string
  currency: string
  amount: number
}

export type BachsSettlementAssessment =
  | { kind: 'PENDING'; reason: 'payment_not_settled' | 'fee_not_final' }
  | {
    kind: 'REVIEW'
    reason:
      | 'payment_identity_mismatch'
      | 'payment_amount_mismatch'
      | 'fee_identity_mismatch'
      | 'settlement_net_evidence_missing'
      | 'settlement_fee_event_mismatch'
  }
  | {
    kind: 'SETTLED'
    settlementMinor: number
    settlementCurrency: string
    feeMinor: number
    feeCurrency: string
    feePaidBy: 'merchant' | 'platform'
    providerUpdatedAt: string | null
    providerCompletedAt: string | null
  }

/**
 * A provider read is accepted only when it still identifies the saved Bachs
 * attempt. `succeeded` alone is not settlement: Bachs reports the actual fee
 * payer only after settlement, so null fee evidence remains pending.
 */
export function assessBachsPaymentSettlement(input: {
  attempt: BachsSettlementAttempt
  payment: BachsPayment
  settlementEvidence: {
    providerEventId: string | null
    settlementAmountMinor: number | null
    settlementCurrency: string | null
    processingFeeAmountMinor: number | null
    processingFeeCurrency: string | null
  }
}): BachsSettlementAssessment {
  const { attempt, payment, settlementEvidence } = input
  if (
    attempt.provider !== 'BACHS' ||
    !attempt.provider_payment_id ||
    !attempt.provider_charge_id ||
    payment.payment_id !== attempt.provider_charge_id ||
    payment.checkout_id !== attempt.provider_payment_id ||
    (payment.reference != null && payment.reference !== attempt.idempotency_key) ||
    payment.currency.toUpperCase() !== attempt.currency.toUpperCase()
  ) {
    return { kind: 'REVIEW', reason: 'payment_identity_mismatch' }
  }

  if (payment.status.toLowerCase() !== 'succeeded') {
    return { kind: 'PENDING', reason: 'payment_not_settled' }
  }

  let grossMinor: number
  try {
    grossMinor = bachsAmountMinor(payment.amount, payment.currency)
    if (payment.amount_paid != null && bachsAmountMinor(payment.amount_paid, payment.currency) !== grossMinor) {
      return { kind: 'REVIEW', reason: 'payment_amount_mismatch' }
    }
  } catch {
    return { kind: 'REVIEW', reason: 'payment_amount_mismatch' }
  }
  if (grossMinor !== attempt.amount) {
    return { kind: 'REVIEW', reason: 'payment_amount_mismatch' }
  }

  if (!payment.fees || !payment.fee_paid_by) {
    return { kind: 'PENDING', reason: 'fee_not_final' }
  }
  const feeCurrency = payment.fees.currency.toUpperCase()
  const feePaidBy = payment.fee_paid_by.toLowerCase()
  if (feeCurrency !== attempt.currency.toUpperCase() || !['merchant', 'platform'].includes(feePaidBy)) {
    return { kind: 'REVIEW', reason: 'fee_identity_mismatch' }
  }

  try {
    const feeMinor = bachsAmountMinor(payment.fees.amount, feeCurrency)
    if (feeMinor < 0 || feeMinor > grossMinor) {
      return { kind: 'REVIEW', reason: 'fee_identity_mismatch' }
    }
    if (
      !settlementEvidence.providerEventId?.startsWith('evt_') ||
      settlementEvidence.settlementAmountMinor === null ||
      !settlementEvidence.settlementCurrency ||
      settlementEvidence.processingFeeAmountMinor === null ||
      !settlementEvidence.processingFeeCurrency
    ) {
      return { kind: 'REVIEW', reason: 'settlement_net_evidence_missing' }
    }
    if (
      !Number.isSafeInteger(settlementEvidence.settlementAmountMinor) ||
      settlementEvidence.settlementAmountMinor < 0 ||
      settlementEvidence.settlementAmountMinor > grossMinor ||
      settlementEvidence.settlementCurrency.toUpperCase() !== attempt.currency.toUpperCase() ||
      !Number.isSafeInteger(settlementEvidence.processingFeeAmountMinor) ||
      settlementEvidence.processingFeeAmountMinor !== feeMinor ||
      settlementEvidence.processingFeeCurrency.toUpperCase() !== feeCurrency
    ) {
      return { kind: 'REVIEW', reason: 'settlement_fee_event_mismatch' }
    }
    return {
      kind: 'SETTLED',
      settlementMinor: settlementEvidence.settlementAmountMinor,
      settlementCurrency: settlementEvidence.settlementCurrency.toUpperCase(),
      feeMinor,
      feeCurrency,
      feePaidBy: feePaidBy as 'merchant' | 'platform',
      providerUpdatedAt: isTimestamp(payment.updated_at) ? payment.updated_at : null,
      providerCompletedAt: isTimestamp(payment.completed_at) ? payment.completed_at : null,
    }
  } catch {
    return { kind: 'REVIEW', reason: 'fee_identity_mismatch' }
  }
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}
