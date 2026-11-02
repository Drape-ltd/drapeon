import { assertEquals } from 'jsr:@std/assert'
import type { TaxPolicyControl } from '../../../packages/shared/src/tax.ts'
import { taxPolicyReviewAlert } from './tax-policy-review-alert.ts'

Deno.test('static tax policies produce advance-warning and overdue alert records', () => {
  const providerPolicy: TaxPolicyControl = {
    countryCode: 'XY', mode: 'PROVIDER', reviewedAt: '2029-12-01', reviewDueAt: '2030-01-31',
    sourceUrl: 'https://example.test/provider', note: 'Synthetic provider policy.',
  }
  const staticPolicy: TaxPolicyControl = {
    countryCode: 'XZ', mode: 'STATIC', reviewedAt: '2029-12-01', reviewDueAt: '2030-02-01',
    sourceUrl: 'https://example.test/static', note: 'Synthetic static policy.',
  }

  assertEquals(taxPolicyReviewAlert(providerPolicy, new Date('2030-01-02T00:00:00.000Z')), {
    severity: 'HIGH',
    title: 'XY tax policy review due soon',
    description: 'The XY operational tax-policy review is approaching its deadline.',
    dedupeKey: 'tax-policy-review:XY',
    metadata: {
      country_code: 'XY',
      mode: 'PROVIDER',
      reviewed_at: providerPolicy.reviewedAt,
      review_due_at: '2030-01-31',
      source_url: providerPolicy.sourceUrl,
    },
  })

  assertEquals(taxPolicyReviewAlert(staticPolicy, new Date('2030-02-02T00:00:00.000Z')), {
    severity: 'CRITICAL',
    title: 'XZ tax policy review expired',
    description: 'The XZ operational tax-policy review expired. New pricing for this jurisdiction remains fail-closed; accepted snapshots remain unchanged.',
    dedupeKey: 'tax-policy-review:XZ',
    metadata: {
      country_code: 'XZ',
      mode: 'STATIC',
      reviewed_at: staticPolicy.reviewedAt,
      review_due_at: '2030-02-01',
      source_url: staticPolicy.sourceUrl,
    },
  })

  assertEquals(taxPolicyReviewAlert({ ...staticPolicy, mode: 'BLOCKED' }, new Date('2030-02-02T00:00:00.000Z')), null)
})
