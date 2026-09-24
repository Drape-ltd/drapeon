/**
 * Feedback and CSAT contract.
 *
 * This describes eligibility and safe response shape only. Persistence,
 * support-case creation, suppression, and delivery remain server-owned.
 */

export const SURVEY_KINDS = [
  'CUSTOMER_POST_COMPLETION_CSAT',
  'SUPPORT_RESOLUTION_CSAT',
  'TAILOR_FIRST_ORDER_CSAT',
  'ONBOARDING_PULSE',
] as const
export type SurveyKind = (typeof SURVEY_KINDS)[number]

/**
 * Delay before an eligible survey invite becomes available to a delivery
 * worker. The delay is part of the lifecycle contract so a future email or
 * in-product sender cannot accidentally fire at the moment an order/case
 * changes state.
 */
export const SURVEY_INVITE_DELAY_HOURS: Readonly<Record<SurveyKind, number>> = {
  CUSTOMER_POST_COMPLETION_CSAT: 24,
  SUPPORT_RESOLUTION_CSAT: 2,
  TAILOR_FIRST_ORDER_CSAT: 24,
  ONBOARDING_PULSE: 24,
}

export const SURVEY_SUBJECT_TYPES = ['ORDER', 'SUPPORT_CASE', 'ACCOUNT'] as const
export type SurveySubjectType = (typeof SURVEY_SUBJECT_TYPES)[number]

export type SurveyDefinition = {
  kind: SurveyKind
  version: 1
  subjectType: SurveySubjectType
  maxResponsesPerSubject: 1
  allowedRoles: readonly ('CUSTOMER' | 'TAILOR')[]
  trigger: string
  suppressedWhen: readonly string[]
  negativeScoreThreshold: 1 | 2
  positiveReviewThreshold: 4 | 5
  allowedTags: readonly string[]
  maxCommentLength: 1000
}

const COMMON_SUPPRESSIONS = [
  'active_dispute',
  'unresolved_support_case',
  'active_incident',
] as const

const DEFINITIONS: Record<SurveyKind, SurveyDefinition> = {
  CUSTOMER_POST_COMPLETION_CSAT: {
    kind: 'CUSTOMER_POST_COMPLETION_CSAT',
    version: 1,
    subjectType: 'ORDER',
    maxResponsesPerSubject: 1,
    allowedRoles: ['CUSTOMER'],
    trigger: 'The order reaches a terminal completed state and the allowed delay has elapsed.',
    suppressedWhen: COMMON_SUPPRESSIONS,
    negativeScoreThreshold: 2,
    positiveReviewThreshold: 4,
    allowedTags: ['fit', 'craft', 'communication', 'timeline', 'delivery', 'value', 'other'],
    maxCommentLength: 1000,
  },
  SUPPORT_RESOLUTION_CSAT: {
    kind: 'SUPPORT_RESOLUTION_CSAT',
    version: 1,
    subjectType: 'SUPPORT_CASE',
    maxResponsesPerSubject: 1,
    allowedRoles: ['CUSTOMER', 'TAILOR'],
    trigger: 'A support case is closed with a recorded resolution.',
    suppressedWhen: ['active_dispute', 'active_incident'],
    negativeScoreThreshold: 2,
    positiveReviewThreshold: 4,
    allowedTags: ['resolved', 'unclear', 'slow', 'communication', 'other'],
    maxCommentLength: 1000,
  },
  TAILOR_FIRST_ORDER_CSAT: {
    kind: 'TAILOR_FIRST_ORDER_CSAT',
    version: 1,
    subjectType: 'ORDER',
    maxResponsesPerSubject: 1,
    allowedRoles: ['TAILOR'],
    trigger: "The tailor's first order reaches completed and payout is provider-confirmed.",
    suppressedWhen: COMMON_SUPPRESSIONS,
    negativeScoreThreshold: 2,
    positiveReviewThreshold: 4,
    allowedTags: ['brief', 'customer', 'timeline', 'payout', 'support', 'other'],
    maxCommentLength: 1000,
  },
  ONBOARDING_PULSE: {
    kind: 'ONBOARDING_PULSE',
    version: 1,
    subjectType: 'ACCOUNT',
    maxResponsesPerSubject: 1,
    allowedRoles: ['CUSTOMER', 'TAILOR'],
    trigger: 'The account completes or deliberately exits the initial setup journey.',
    suppressedWhen: ['active_incident'],
    negativeScoreThreshold: 2,
    positiveReviewThreshold: 4,
    allowedTags: ['clear', 'confusing', 'too_long', 'missing_step', 'other'],
    maxCommentLength: 1000,
  },
}

export function getSurveyDefinition(kind: SurveyKind): SurveyDefinition {
  return DEFINITIONS[kind]
}

export function getSurveyInviteDelayHours(kind: SurveyKind): number {
  return SURVEY_INVITE_DELAY_HOURS[kind]
}

export function surveyIdempotencyKey(userId: string, subjectId: string, kind: SurveyKind): string {
  const normalizedUserId = userId.trim()
  const normalizedSubjectId = subjectId.trim()
  if (!normalizedUserId) throw new Error('userId is required for survey idempotency')
  if (!normalizedSubjectId) throw new Error('subjectId is required for survey idempotency')
  return `survey:${kind.toLowerCase()}:${normalizedUserId}:${normalizedSubjectId}:v1`
}

export type SurveyResponseInput = {
  score: number
  tags?: readonly string[]
  comment?: string | null
}

export type SanitizedSurveyResponse = {
  score: 1 | 2 | 3 | 4 | 5
  tags: string[]
  comment: string | null
}

export type SurveyOpsResponseRecord = {
  kind: SurveyKind
  score: 1 | 2 | 3 | 4 | 5
  status: 'RECORDED' | 'ROUTED' | 'SUPPRESSED'
}

export type SurveyOpsSummary = {
  responseCount: number
  averageScore: number | null
  negativeCount: number
  reviewEligibleCount: number
  routedCount: number
  suppressedCount: number
  byKind: Array<{
    kind: SurveyKind
    responseCount: number
    averageScore: number | null
  }>
}

/**
 * Build the smallest useful Ops summary from private survey rows. Comments,
 * subject identifiers, and respondent details are intentionally not accepted.
 */
export function summarizeSurveyResponses(
  responses: readonly SurveyOpsResponseRecord[]
): SurveyOpsSummary {
  const byKind = SURVEY_KINDS.map((kind) => {
    const rows = responses.filter((response) => response.kind === kind)
    const scoreTotal = rows.reduce((total, response) => total + response.score, 0)
    return {
      kind,
      responseCount: rows.length,
      averageScore: rows.length ? Number((scoreTotal / rows.length).toFixed(2)) : null,
    }
  })
  const scoreTotal = responses.reduce((total, response) => total + response.score, 0)
  return {
    responseCount: responses.length,
    averageScore: responses.length ? Number((scoreTotal / responses.length).toFixed(2)) : null,
    negativeCount: responses.filter((response) => isNegativeSurveyResponse(response.kind, response.score)).length,
    reviewEligibleCount: responses.filter((response) => isPositiveReviewInvitationEligible(response.kind, response.score)).length,
    routedCount: responses.filter((response) => response.status === 'ROUTED').length,
    suppressedCount: responses.filter((response) => response.status === 'SUPPRESSED').length,
    byKind,
  }
}

export function sanitizeSurveyResponse(
  kind: SurveyKind,
  input: SurveyResponseInput
): SanitizedSurveyResponse | null {
  const definition = getSurveyDefinition(kind)
  if (!Number.isInteger(input.score) || input.score < 1 || input.score > 5) return null

  const tags = [...new Set((input.tags ?? []).map((tag) => tag.trim().toLowerCase()))]
    .filter((tag) => definition.allowedTags.includes(tag))
    .slice(0, 5)
  const comment = input.comment?.trim() || null
  return {
    score: input.score as SanitizedSurveyResponse['score'],
    tags,
    comment: comment ? comment.slice(0, definition.maxCommentLength) : null,
  }
}

export function isNegativeSurveyResponse(kind: SurveyKind, score: number): boolean {
  return score <= getSurveyDefinition(kind).negativeScoreThreshold
}

export function isPositiveReviewInvitationEligible(kind: SurveyKind, score: number): boolean {
  return score >= getSurveyDefinition(kind).positiveReviewThreshold
}
