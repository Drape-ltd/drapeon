export function buildTailorAdjustmentRefundUnavailableIssue(input: {
  requestId: string
  adjustmentId: string
  orderId: string | null
  amount: number | null
  currency: string | null
  now: string
}) {
  return {
    issue_type: 'REFUND_FAILED',
    severity: 'HIGH',
    status: 'OPEN',
    source: 'ops-money-desk-adjustment-refund',
    order_id: input.orderId,
    related_entity_type: 'TAILOR_ADJUSTMENT',
    related_entity_id: input.adjustmentId,
    title: 'Tailor adjustment refund needs review',
    description:
      'The adjustment refund workflow is not available yet. No provider refund was requested, and the adjustment earning or payout was not changed.',
    recommended_action:
      'Confirm whether the additional work was completed and whether its payout is reserved or transferred. Keep this case open until the reviewed adjustment-refund path is available; do not retry through another refund target.',
    dedupe_key: `tailor-adjustment-refund-unavailable:${input.requestId}`,
    queue_key: 'money-desk',
    priority: 'P1',
    metadata: {
      money_desk_request_id: input.requestId,
      adjustment_id: input.adjustmentId,
      amount: input.amount,
      currency: input.currency,
    },
    resolved_at: null,
    last_seen_at: input.now,
  } as const
}
