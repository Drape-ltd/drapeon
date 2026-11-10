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
      ? 'This refund attempt did not complete. Drapeon is handling it; no action is needed from you.'
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

/** Ops refund updates can contain internal Money Desk rationale. Never repeat it to either party. */
export function customerVisibleMoneyStageNote(stage: string | null, note: string | null) {
  if (stage === 'REFUNDED') return 'Your refund has been recorded. See the refund record for the amount and date.'
  return note
}

export function tailorVisibleMoneyStageNote(stage: string | null, note: string | null) {
  if (stage === 'REFUNDED') return 'This order was refunded. See the order status for details.'
  return note
}

export function publicCancellationRefundStageNote() {
  return 'Drapeon approved the cancellation and refunded the captured payments.'
}
