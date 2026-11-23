export type PaymentRouteEnablementEvidenceInput = {
  collection: unknown
  settlement: unknown
  transfer: unknown
  tailorWithdrawal: unknown
  customerFeeDisclosure: unknown
  settlementFeeReconciliation: unknown
  providerConfirmation?: unknown
}

export type PaymentRouteEnablementEvidence = {
  collection: string
  settlement: string
  transfer: string
  tailor_withdrawal: string
  customer_fee_disclosure: string
  settlement_fee_reconciliation: string
  provider_confirmation?: string
}

function evidenceReference(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length >= 1 && trimmed.length <= 500 ? trimmed : null
}

export function buildPaymentRouteEnablementEvidence(
  provider: string,
  input: PaymentRouteEnablementEvidenceInput,
): PaymentRouteEnablementEvidence | null {
  if (provider !== 'BACHS' && provider !== 'STRIPE') return null

  const collection = evidenceReference(input.collection)
  const settlement = evidenceReference(input.settlement)
  const transfer = evidenceReference(input.transfer)
  const tailorWithdrawal = evidenceReference(input.tailorWithdrawal)
  const customerFeeDisclosure = evidenceReference(input.customerFeeDisclosure)
  const settlementFeeReconciliation = evidenceReference(input.settlementFeeReconciliation)
  const providerConfirmation = provider === 'BACHS'
    ? evidenceReference(input.providerConfirmation)
    : input.providerConfirmation == null || input.providerConfirmation === ''
    ? undefined
    : evidenceReference(input.providerConfirmation)

  if (
    !collection || !settlement || !transfer || !tailorWithdrawal ||
    !customerFeeDisclosure || !settlementFeeReconciliation ||
    (provider === 'BACHS' && !providerConfirmation) ||
    (input.providerConfirmation != null && input.providerConfirmation !== '' && !providerConfirmation)
  ) return null

  return {
    collection,
    settlement,
    transfer,
    tailor_withdrawal: tailorWithdrawal,
    customer_fee_disclosure: customerFeeDisclosure,
    settlement_fee_reconciliation: settlementFeeReconciliation,
    ...(providerConfirmation ? { provider_confirmation: providerConfirmation } : {}),
  }
}
