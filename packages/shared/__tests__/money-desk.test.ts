import {
  buildTailorAdjustmentRefundUnavailableIssue,
  deriveMoneyDeskRisk,
  moneyDeskPolicySnapshot,
  validateMoneyDeskReason,
} from '../src/money-desk'

describe('Money Desk controls', () => {
  it('requires one independent approval for a standard action below the threshold', () => {
    expect(deriveMoneyDeskRisk({ actionType: 'PAYOUT_RELEASE', amountUsdEquivalent: 49_999 })).toEqual({
      approvalCount: 1,
      riskLevel: 'STANDARD',
      riskReasons: [],
    })
  })

  it('requires dual approval at the USD 500 equivalent threshold', () => {
    expect(deriveMoneyDeskRisk({ actionType: 'CUSTOMER_REFUND', amountUsdEquivalent: 50_000 })).toMatchObject({
      approvalCount: 2,
      riskLevel: 'HIGH',
      riskReasons: ['USD_500_EQUIVALENT_OR_MORE'],
    })
  })

  it('fails unresolved FX and always-sensitive actions into dual approval', () => {
    const risk = deriveMoneyDeskRisk({ actionType: 'MANUAL_FX', amountUsdEquivalent: null })
    expect(risk.approvalCount).toBe(2)
    expect(risk.riskReasons).toEqual([
      'ACTION_ALWAYS_REQUIRES_DUAL_APPROVAL',
      'USD_EQUIVALENT_UNRESOLVED',
    ])
  })

  it('requires a useful reason and publishes the frozen policy', () => {
    expect(() => validateMoneyDeskReason('too short')).toThrow()
    expect(validateMoneyDeskReason('Customer-approved material release with receipt evidence.')).toContain('receipt')
    expect(moneyDeskPolicySnapshot()).toMatchObject({
      policyVersion: 'commercial-2026-07-31-v1',
      jitDurationMinutes: 15,
      allActionsRequireIndependentApproval: true,
    })
  })

  it('builds one deduplicated visible case when an adjustment refund is unavailable', () => {
    const issue = buildTailorAdjustmentRefundUnavailableIssue({
      requestId: 'request-1',
      adjustmentId: 'adjustment-1',
      orderId: 'order-1',
      amount: 12_500,
      currency: 'NGN',
      now: '2026-10-29T18:00:00.000Z',
    })

    expect(issue).toMatchObject({
      issue_type: 'REFUND_FAILED',
      status: 'OPEN',
      order_id: 'order-1',
      related_entity_type: 'TAILOR_ADJUSTMENT',
      related_entity_id: 'adjustment-1',
      dedupe_key: 'tailor-adjustment-refund-unavailable:request-1',
      queue_key: 'money-desk',
      last_seen_at: '2026-10-29T18:00:00.000Z',
      metadata: {
        money_desk_request_id: 'request-1',
        adjustment_id: 'adjustment-1',
        amount: 12_500,
        currency: 'NGN',
      },
    })
    expect(issue.description).toContain('No provider refund was requested')
    expect(issue.recommended_action).toContain('do not retry through another refund target')
  })
})
