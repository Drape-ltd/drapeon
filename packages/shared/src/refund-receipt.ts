import { formatMoney } from './presentation.ts'

export type CustomerRefundReceipt = {
  refund_reference: string
  amount_minor: number
  currency: string
  refund_status: string
  recorded_at: string
}

export function presentCustomerRefundReceipt(receipt: CustomerRefundReceipt) {
  const status = receipt.refund_status === 'COMPLETED'
    ? 'Refund completed'
    : receipt.refund_status === 'FAILED'
      ? 'Refund needs attention'
      : 'Refund processing'
  const at = new Date(receipt.recorded_at)
  return {
    status,
    amount: formatMoney(receipt.amount_minor, receipt.currency),
    date: Number.isFinite(at.getTime())
      ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(at)
      : 'Date unavailable',
    reference: receipt.refund_reference,
  }
}

/** Stage updates can contain internal Money Desk rationale. Never repeat it to customers. */
export function customerVisibleMoneyStageNote(stage: string | null, note: string | null) {
  if (stage === 'REFUNDED') return 'Your refund has been recorded. See the refund record for the amount and date.'
  if (stage === 'IN_DISPUTE' && note?.startsWith('Customer requested cancellation review.')) {
    return 'Your cancellation request is under review.'
  }
  return note
}
