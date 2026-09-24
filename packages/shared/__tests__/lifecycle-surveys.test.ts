import {
  getSurveyDefinition,
  getSurveyInviteDelayHours,
  isNegativeSurveyResponse,
  isPositiveReviewInvitationEligible,
  sanitizeSurveyResponse,
  summarizeSurveyResponses,
  surveyIdempotencyKey,
} from '../src/lifecycle-surveys'

describe('survey contract', () => {
  it('keeps the initial survey set bounded and role-specific', () => {
    const customer = getSurveyDefinition('CUSTOMER_POST_COMPLETION_CSAT')
    expect(customer.subjectType).toBe('ORDER')
    expect(customer.allowedRoles).toEqual(['CUSTOMER'])
    expect(customer.maxResponsesPerSubject).toBe(1)

    const tailor = getSurveyDefinition('TAILOR_FIRST_ORDER_CSAT')
    expect(tailor.allowedRoles).toEqual(['TAILOR'])
    expect(tailor.trigger).toContain('payout')
  })

  it('sanitizes response shape and drops unknown tags', () => {
    const response = sanitizeSurveyResponse('SUPPORT_RESOLUTION_CSAT', {
      score: 4,
      tags: [' Slow ', 'unknown', 'SLOW'],
      comment: `  ${'x'.repeat(1200)}  `,
    })
    expect(response).not.toBeNull()
    expect(response?.tags).toEqual(['slow'])
    expect(response?.comment).toHaveLength(1000)
    expect(sanitizeSurveyResponse('ONBOARDING_PULSE', { score: 6 })).toBeNull()
  })

  it('makes negative routing and positive invitation thresholds explicit', () => {
    expect(isNegativeSurveyResponse('CUSTOMER_POST_COMPLETION_CSAT', 2)).toBe(true)
    expect(isNegativeSurveyResponse('CUSTOMER_POST_COMPLETION_CSAT', 3)).toBe(false)
    expect(isPositiveReviewInvitationEligible('CUSTOMER_POST_COMPLETION_CSAT', 4)).toBe(true)
    expect(isPositiveReviewInvitationEligible('CUSTOMER_POST_COMPLETION_CSAT', 3)).toBe(false)
  })

  it('keeps invite delays explicit and bounded by survey kind', () => {
    expect(getSurveyInviteDelayHours('CUSTOMER_POST_COMPLETION_CSAT')).toBe(24)
    expect(getSurveyInviteDelayHours('SUPPORT_RESOLUTION_CSAT')).toBe(2)
    expect(getSurveyInviteDelayHours('TAILOR_FIRST_ORDER_CSAT')).toBe(24)
    expect(getSurveyInviteDelayHours('ONBOARDING_PULSE')).toBe(24)
  })

  it('uses a stable subject key and rejects missing identifiers', () => {
    expect(surveyIdempotencyKey('user-123', 'order-456', 'CUSTOMER_POST_COMPLETION_CSAT')).toBe(
      'survey:customer_post_completion_csat:user-123:order-456:v1'
    )
    expect(() => surveyIdempotencyKey('', 'order-456', 'ONBOARDING_PULSE')).toThrow('userId')
    expect(() => surveyIdempotencyKey('user-123', '  ', 'ONBOARDING_PULSE')).toThrow('subjectId')
  })

  it('summarizes private responses without requiring private fields', () => {
    const summary = summarizeSurveyResponses([
      { kind: 'CUSTOMER_POST_COMPLETION_CSAT', score: 5, status: 'RECORDED' },
      { kind: 'CUSTOMER_POST_COMPLETION_CSAT', score: 2, status: 'ROUTED' },
      { kind: 'TAILOR_FIRST_ORDER_CSAT', score: 4, status: 'RECORDED' },
      { kind: 'SUPPORT_RESOLUTION_CSAT', score: 3, status: 'SUPPRESSED' },
    ])
    expect(summary).toMatchObject({
      responseCount: 4,
      averageScore: 3.5,
      negativeCount: 1,
      reviewEligibleCount: 2,
      routedCount: 1,
      suppressedCount: 1,
    })
    expect(summary.byKind.find((row) => row.kind === 'CUSTOMER_POST_COMPLETION_CSAT')).toEqual({
      kind: 'CUSTOMER_POST_COMPLETION_CSAT',
      responseCount: 2,
      averageScore: 3.5,
    })
  })
})
