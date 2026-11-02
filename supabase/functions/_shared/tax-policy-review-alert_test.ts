import { assertEquals } from 'jsr:@std/assert'
import { getTaxPolicyControl } from '../../../packages/shared/src/tax.ts'
import { taxPolicyReviewAlert } from './tax-policy-review-alert.ts'

Deno.test('static tax policies produce advance-warning and overdue alert records', () => {
  const ca = getTaxPolicyControl('CA')!
  const gb = getTaxPolicyControl('GB')!

  assertEquals(taxPolicyReviewAlert(ca, new Date('2026-11-02T00:00:00.000Z')), {
    severity: 'HIGH',
    title: 'CA tax policy review due soon',
    description: 'The CA operational tax-policy review is approaching its deadline.',
    dedupeKey: 'tax-policy-review:CA',
    metadata: {
      country_code: 'CA',
      mode: 'PROVIDER',
      reviewed_at: ca.reviewedAt,
      review_due_at: '2026-11-30',
      source_url: ca.sourceUrl,
    },
  })

  assertEquals(taxPolicyReviewAlert(gb, new Date('2026-12-02T00:00:00.000Z')), {
    severity: 'CRITICAL',
    title: 'GB tax policy review expired',
    description: 'The GB operational tax-policy review expired. New pricing for this jurisdiction remains fail-closed; accepted snapshots remain unchanged.',
    dedupeKey: 'tax-policy-review:GB',
    metadata: {
      country_code: 'GB',
      mode: 'STATIC',
      reviewed_at: gb.reviewedAt,
      review_due_at: '2026-12-01',
      source_url: gb.sourceUrl,
    },
  })
})
