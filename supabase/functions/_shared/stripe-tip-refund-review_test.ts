import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { reviewStripeTipRefund, tipRefundNeedsBusinessReconciliation } from './stripe-tip-refund-review.ts'

const input = { paymentId: 'tip_payment', paymentStatus: 'SUCCEEDED',
  paymentAmount: 500, refundedAmount: 0, paymentCurrency: 'USD', orderId: 'order_one',
  refundId: 're_one', refundStatus: 'succeeded', refundAmount: 500 }
const tip = { id: 'tip_one', status: 'REFUNDED', amount: 500, currency: 'USD', orderId: 'order_one' }

Deno.test('external TIP refund opens review without touching payment or tip', async () => {
  const calls: string[] = []
  const result = await reviewStripeTipRefund(input, {
    loadTip: async () => { calls.push('tip'); return { ...tip, status: 'HELD' } },
    loadClaim: async () => { calls.push('claim'); return { status: 'RESERVED', providerOperationId: null } },
    hasExactJournal: async () => { calls.push('journal'); return false },
    openReviewIssue: async () => { calls.push('issue'); return true },
    markProcessed: async (outcome, required) => { calls.push(`mark:${outcome}:${required}`) },
  })
  assertEquals(result, { matched: true, reconciliationRequired: true, status: 'succeeded' })
  assertEquals(calls, ['tip', 'claim', 'issue', 'mark:stripe_tip_refund_requires_review:true'])
})

Deno.test('fully finalized exact TIP refund is an idempotent webhook duplicate', async () => {
  const calls: string[] = []
  const result = await reviewStripeTipRefund({ ...input, paymentStatus: 'REFUNDED', refundedAmount: 500 }, {
    loadTip: async () => tip,
    loadClaim: async () => ({ status: 'SUCCEEDED', providerOperationId: 're_one' }),
    hasExactJournal: async (paymentId, refundId, amount, currency, orderId) => {
      calls.push(`${paymentId}:${refundId}:${amount}:${currency}:${orderId}`)
      return true
    },
    openReviewIssue: async () => { calls.push('issue'); return true },
    markProcessed: async (outcome, required) => { calls.push(`mark:${outcome}:${required}`) },
  })
  assertEquals(result, { matched: true, duplicate: true, status: 'succeeded' })
  assertEquals(calls, ['tip_payment:re_one:500:USD:order_one', 'mark:stripe_tip_refund_already_finalized:false'])
})

Deno.test('a different refund ID cannot be treated as an already finalized tip', async () => {
  const calls: string[] = []
  const result = await reviewStripeTipRefund({ ...input, paymentStatus: 'REFUNDED', refundedAmount: 500 }, {
    loadTip: async () => tip,
    loadClaim: async () => ({ status: 'SUCCEEDED', providerOperationId: 're_other' }),
    hasExactJournal: async () => { calls.push('journal'); return true },
    openReviewIssue: async () => { calls.push('issue'); return true },
    markProcessed: async (outcome, required) => { calls.push(`mark:${outcome}:${required}`) },
  })
  assertEquals(result, { matched: true, reconciliationRequired: true, status: 'succeeded' })
  assertEquals(calls, ['issue', 'mark:stripe_tip_refund_requires_review:true'])
})

Deno.test('a mismatched refund amount cannot be treated as an already finalized tip', async () => {
  const calls: string[] = []
  const result = await reviewStripeTipRefund({ ...input, paymentStatus: 'REFUNDED',
    refundedAmount: 500, refundAmount: 400 }, {
    loadTip: async () => tip,
    loadClaim: async () => ({ status: 'SUCCEEDED', providerOperationId: 're_one' }),
    hasExactJournal: async () => { calls.push('journal'); return true },
    openReviewIssue: async () => { calls.push('issue'); return true },
    markProcessed: async (outcome) => { calls.push(outcome) },
  })
  assertEquals(result.reconciliationRequired, true)
  assertEquals(calls, ['issue', 'stripe_tip_refund_requires_review'])
})

Deno.test('TIP case save failure leaves the webhook unprocessed', async () => {
  const calls: string[] = []
  await assertRejects(() => reviewStripeTipRefund(input, {
    loadTip: async () => null,
    loadClaim: async () => null,
    hasExactJournal: async () => false,
    openReviewIssue: async () => false,
    markProcessed: async () => { calls.push('marked') },
  }))
  assertEquals(calls, [])
})

Deno.test('provider event match does not close an unresolved TIP business reconciliation', () => {
  assertEquals(tipRefundNeedsBusinessReconciliation('stripe_tip_refund_requires_review', true), true)
  assertEquals(tipRefundNeedsBusinessReconciliation('stripe_tip_refund_requires_review', false), false)
  assertEquals(tipRefundNeedsBusinessReconciliation('stripe_tip_refund_already_finalized', true), false)
  assertEquals(tipRefundNeedsBusinessReconciliation('stripe_refund_succeeded', true), false)
})

Deno.test('Stripe webhook routes TIP before the general refund finalizer', async () => {
  const source = await Deno.readTextFile(new URL('../stripe-webhook/index.ts', import.meta.url))
  const handler = source.slice(source.indexOf('async function handleStripeRefundLifecycle('),
    source.indexOf('async function handleStripeDisputeLifecycle('))
  const routeAt = handler.indexOf("if (payment.phase === 'TIP')")
  const generalAt = handler.indexOf('await finalizeRefundOnAttempt(')
  assertEquals(routeAt >= 0 && generalAt > routeAt, true)
  assertEquals(handler.slice(routeAt, generalAt).includes('reviewStripeTipRefund('), true)
  const worker = await Deno.readTextFile(new URL('../process-job-queue/index.ts', import.meta.url))
  assertEquals(worker.includes('tipRefundNeedsBusinessReconciliation(processed?.processing_result, result.matched)'), true)
})
