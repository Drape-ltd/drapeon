export const PAYMENT_STATUSES = [
  'INITIATED',
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'CANCELED',
  'PARTIAL_REFUND',
  'REFUNDED',
] as const

export type ForwardPaymentStatus = typeof PAYMENT_STATUSES[number]

export function paymentStatusTransitionDisposition(input: {
  from: ForwardPaymentStatus
  to: ForwardPaymentStatus
  evidencedLateSuccess?: boolean
  superseded?: boolean
  hasNewerAttempt?: boolean
  refundedAmount?: number
}): 'transition' | 'noop' | 'reject' {
  if (input.from === input.to) return 'noop'
  if (
    (input.from === 'INITIATED' || input.from === 'PENDING')
    && ['PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED'].includes(input.to)
  ) return 'transition'
  if (
    input.from === 'FAILED'
    && input.to === 'SUCCEEDED'
    && input.evidencedLateSuccess
    && !input.superseded
    && !input.hasNewerAttempt
    && (input.refundedAmount ?? 0) === 0
  ) return 'transition'
  if (input.from === 'SUCCEEDED' && ['PARTIAL_REFUND', 'REFUNDED'].includes(input.to)) return 'transition'
  if (input.from === 'PARTIAL_REFUND' && input.to === 'REFUNDED') return 'transition'
  return 'reject'
}
