import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { createStripeTransfer } from './stripe.ts'
import {
  type FabricTransferFailureRecord,
  handleFabricStripeTransferFailure,
} from './fabric-transfer-failure.ts'

function recorder() {
  const events: string[] = []
  let persisted: FabricTransferFailureRecord | null = null
  return {
    events,
    get record() { return persisted },
    deps: {
      recordOutcome: async (record: FabricTransferFailureRecord) => { events.push(`candidate:${record.outcome}`); persisted = record },
      updatePayout: async (record: FabricTransferFailureRecord) => { events.push(`payout:${record.outcome}`) },
      advanceAttempt: async (nextAttempt: number) => { events.push(`attempt:${nextAttempt}`) },
      persistOpsIssue: async () => { events.push('ops'); return true },
      notify: async (record: FabricTransferFailureRecord) => { events.push(`notify:${record.outcome}`) },
    },
  }
}

Deno.test('Stripe balance_insufficient becomes a terminal failed release without a queue rethrow', async () => {
  const previousKey = Deno.env.get('STRIPE_SECRET_KEY')
  const originalFetch = globalThis.fetch
  const recorded = recorder()
  try {
    Deno.env.set('STRIPE_SECRET_KEY', 'sk_test_unit_only')
    globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({
      error: { type: 'invalid_request_error', code: 'balance_insufficient', message: 'Insufficient balance' },
    }), { status: 400, headers: { 'Content-Type': 'application/json', 'request-id': 'req_balance' } }))
    let providerError: unknown
    try {
      await createStripeTransfer({ amount: 8000, currency: 'USD', destinationAccountId: 'acct_test' })
    } catch (error) {
      providerError = error
    }
    const result = await handleFabricStripeTransferFailure(providerError, 1, recorded.deps)
    assertEquals(result.outcome, 'FAILED')
    assertEquals(result.code, 'balance_insufficient')
    assertEquals(result.requestId, 'req_balance')
    assertEquals(recorded.events, ['candidate:FAILED', 'payout:FAILED', 'attempt:2', 'ops', 'notify:FAILED'])
  } finally {
    globalThis.fetch = originalFetch
    if (previousKey === undefined) Deno.env.delete('STRIPE_SECRET_KEY')
    else Deno.env.set('STRIPE_SECRET_KEY', previousKey)
  }
})

Deno.test('network timeout is ambiguous, does not advance the attempt, and requires reconciliation', async () => {
  const recorded = recorder()
  const result = await handleFabricStripeTransferFailure(new TypeError('network timeout'), 1, recorded.deps)
  assertEquals(result.outcome, 'AMBIGUOUS')
  assertEquals(recorded.events, ['candidate:AMBIGUOUS', 'payout:AMBIGUOUS', 'ops', 'notify:AMBIGUOUS'])
})

Deno.test('money-path Ops case failure remains retryable by throwing loudly', async () => {
  const recorded = recorder()
  recorded.deps.persistOpsIssue = async () => false
  await assertRejects(
    () => handleFabricStripeTransferFailure(new TypeError('network timeout'), 1, recorded.deps),
    Error,
    'FABRIC_OPS_CASE_PERSISTENCE_FAILED',
  )
})
