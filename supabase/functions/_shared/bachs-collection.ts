import { bachsAmountMinor } from './bachs.ts'

export type BachsCollectionSucceeded = {
  id: string
  type: 'collection.succeeded'
  organization_id: string
  account?: string
  data: {
    checkout_id: string | null
    charge_id: string | null
    reference: string | null
    status: string
    amount: string
    currency: string
    settlement_amount?: string | null
    settlement_currency?: string | null
    processing_fee?: string | null
    processing_fee_currency?: string | null
  }
}

type LinkedAttempt = {
  provider: string
  provider_payment_id: string | null
  provider_charge_id?: string | null
  idempotency_key: string
  currency: string
  amount: number
}

/** A signed event is still only a hint until its exact saved attempt matches. */
export function matchBachsCollection(input: {
  event: BachsCollectionSucceeded
  attempt: LinkedAttempt | null
  platformAccountId: string
}): { outcome: 'MATCH'; chargeId: string; settledMinor: number | null; feeMinor: number | null } | {
  outcome: 'UNMATCHED' | 'IDENTITY_CONFLICT' | 'UNRECONCILABLE'
} {
  const { event, attempt } = input
  if (event.type !== 'collection.succeeded' || event.data.status !== 'SUCCEEDED') return { outcome: 'UNRECONCILABLE' }
  if (event.organization_id !== input.platformAccountId || event.account) return { outcome: 'IDENTITY_CONFLICT' }
  if (!event.data.checkout_id?.startsWith('chk_') || !event.data.charge_id?.startsWith('ch_')) {
    return { outcome: 'UNRECONCILABLE' }
  }
  if (!attempt) return { outcome: 'UNMATCHED' }
  if (attempt.provider !== 'BACHS' || attempt.provider_payment_id !== event.data.checkout_id ||
    (attempt.provider_charge_id && attempt.provider_charge_id !== event.data.charge_id) ||
    attempt.idempotency_key !== event.data.reference || attempt.currency !== event.data.currency) {
    return { outcome: 'IDENTITY_CONFLICT' }
  }
  try {
    if (bachsAmountMinor(event.data.amount, event.data.currency) !== attempt.amount) return { outcome: 'IDENTITY_CONFLICT' }
    const settledMinor = event.data.settlement_amount == null ? null : bachsAmountMinor(event.data.settlement_amount, event.data.settlement_currency ?? '')
    const feeMinor = event.data.processing_fee == null ? null : bachsAmountMinor(event.data.processing_fee, event.data.processing_fee_currency ?? '')
    if (settledMinor != null && (settledMinor < 0 || event.data.settlement_currency !== event.data.currency)) {
      return { outcome: 'IDENTITY_CONFLICT' }
    }
    if (feeMinor != null && (feeMinor < 0 || event.data.processing_fee_currency !== event.data.currency)) {
      return { outcome: 'IDENTITY_CONFLICT' }
    }
    return { outcome: 'MATCH', chargeId: event.data.charge_id, settledMinor, feeMinor }
  } catch {
    return { outcome: 'IDENTITY_CONFLICT' }
  }
}
