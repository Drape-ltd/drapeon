import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { reconcileFailedRefundOrAlert, refundFailureLedgerBlockedIssue } from './refund-failure-ledger-alert.ts'

for (const provider of ['STRIPE', 'BACHS'] as const) {
  Deno.test(`${provider} reconciliation failure saves a critical refund case before webhook retry`, async () => {
    const steps: string[] = []
    const rpcError = new Error('REFUND_FAILURE_JOURNAL_MISMATCH')
    const issue = refundFailureLedgerBlockedIssue({
      provider, source: `${provider.toLowerCase()}-webhook`, orderId: 'order_1',
      paymentId: 'payment_1', refundId: 'refund_1',
    })
    assertEquals(issue.severity, 'CRITICAL')
    assertEquals(issue.issueType, 'REFUND_FAILED')
    assertEquals(issue.persistWhenRoutineDisabled, true)
    assertEquals(issue.dedupeKey, `refund-failure-ledger-blocked:${provider.toLowerCase()}:refund_1`)
    await assertRejects(
      () => reconcileFailedRefundOrAlert(async () => {
        steps.push('reconcile')
        return { error: rpcError }
      }, async () => {
        steps.push('save critical case')
        return true
      }),
      Error,
      'REFUND_FAILURE_JOURNAL_MISMATCH',
    )
    assertEquals(steps, ['reconcile', 'save critical case'])
  })
}

Deno.test('successful reconciliation does not open a blocked-ledger case', async () => {
  let cases = 0
  await reconcileFailedRefundOrAlert(async () => ({ error: null }), async () => {
    cases++
    return true
  })
  assertEquals(cases, 0)
})

Deno.test('a thrown reconciliation error also opens the critical case before retry', async () => {
  const steps: string[] = []
  await assertRejects(
    () => reconcileFailedRefundOrAlert(async () => {
      steps.push('reconcile')
      throw new Error('provider unavailable')
    }, async () => {
      steps.push('save critical case')
      return true
    }),
    Error,
    'provider unavailable',
  )
  assertEquals(steps, ['reconcile', 'save critical case'])
})

Deno.test('webhook retry also fails if the critical case cannot be saved', async () => {
  await assertRejects(
    () => reconcileFailedRefundOrAlert(async () => ({ error: new Error('missing journal') }), async () => false),
    Error,
    'REFUND_FAILURE_LEDGER_CASE_NOT_SAVED',
  )
})
