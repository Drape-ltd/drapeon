import {
  getTaxPolicyReviewDeadlineHealth,
  type TaxPolicyControl,
} from '../../../packages/shared/src/tax.ts'

export type TaxPolicyReviewAlert = {
  severity: 'CRITICAL' | 'HIGH'
  title: string
  description: string
  dedupeKey: string
  metadata: {
    country_code: string
    mode: TaxPolicyControl['mode']
    reviewed_at: string
    review_due_at: string
    source_url: string
  }
}

export function taxPolicyReviewAlert(
  policy: TaxPolicyControl,
  now = new Date(),
): TaxPolicyReviewAlert | null {
  const health = getTaxPolicyReviewDeadlineHealth(policy, now)
  if (health === 'HEALTHY') return null
  const overdue = health === 'OVERDUE'
  return {
    severity: overdue ? 'CRITICAL' : 'HIGH',
    title: overdue
      ? `${policy.countryCode} tax policy review expired`
      : `${policy.countryCode} tax policy review due soon`,
    description: overdue
      ? `The ${policy.countryCode} operational tax-policy review expired. New pricing for this jurisdiction remains fail-closed; accepted snapshots remain unchanged.`
      : `The ${policy.countryCode} operational tax-policy review is approaching its deadline.`,
    dedupeKey: `tax-policy-review:${policy.countryCode}`,
    metadata: {
      country_code: policy.countryCode,
      mode: policy.mode,
      reviewed_at: policy.reviewedAt,
      review_due_at: policy.reviewDueAt,
      source_url: policy.sourceUrl,
    },
  }
}
