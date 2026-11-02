import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { StripeApiError, createStripeTransfer } from './stripe.ts'
import {
  classifyStripeTransferFailure,
  fabricTransferIdempotencyKey,
  requireStripeSourceCharge,
  stripeSourceCharge,
} from './stripe-transfer-safety.ts'

Deno.test('stripeSourceCharge reads the signed webhook payment-intent envelope', () => {
  assertEquals(stripeSourceCharge({
    provider_response: { data: { object: { latest_charge: 'ch_source_123' } } },
  }), 'ch_source_123')
})

Deno.test('missing source charge fails before a Stripe transfer can start', () => {
  let code = ''
  try {
    requireStripeSourceCharge({ provider_response: {} }, 'FABRIC_SOURCE_CHARGE_MISSING')
  } catch (error) {
    code = error instanceof Error ? error.message : String(error)
  }
  assertEquals(code, 'FABRIC_SOURCE_CHARGE_MISSING')
})

Deno.test('fabric attempt one preserves the deployed idempotency key and later attempts are unique', () => {
  assertEquals(fabricTransferIdempotencyKey('candidate', 1), 'DRAPE-FABRIC-V2-candidate')
  assertEquals(fabricTransferIdempotencyKey('candidate', 2), 'DRAPE-FABRIC-V2-candidate-a2')
})

Deno.test('typed Stripe 402 with a code is a definite rejection', () => {
  assertEquals(
    classifyStripeTransferFailure(new StripeApiError('insufficient', 402, 'card_error', 'balance_insufficient')),
    { outcome: 'DEFINITE', code: 'balance_insufficient', status: 402, requestId: null },
  )
})

Deno.test('timeouts and retryable Stripe responses have unclear outcomes', () => {
  assertEquals(classifyStripeTransferFailure(new Error('timeout')), {
    outcome: 'AMBIGUOUS', code: 'STRIPE_OUTCOME_UNCLEAR', status: null, requestId: null,
  })
  assertEquals(
    classifyStripeTransferFailure(new StripeApiError('busy', 429, 'rate_limit_error', 'rate_limit')),
    { outcome: 'AMBIGUOUS', code: 'rate_limit', status: 429, requestId: null },
  )
})

Deno.test('createStripeTransfer sends source_transaction', async () => {
  const originalFetch = globalThis.fetch
  const previousKey = Deno.env.get('STRIPE_SECRET_KEY')
  let body = ''
  try {
    Deno.env.set('STRIPE_SECRET_KEY', 'sk_test_unit_only')
    globalThis.fetch = (_input, init) => {
      body = String((init as globalThis.RequestInit | undefined)?.body ?? '')
      return Promise.resolve(new Response(JSON.stringify({ id: 'tr_test', metadata: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
    }
    await createStripeTransfer({
      amount: 8000,
      currency: 'USD',
      destinationAccountId: 'acct_test',
      sourceTransaction: 'ch_source_123',
      idempotencyKey: 'attempt-1',
      transferGroup: 'order:order-1',
      metadata: { fabric_candidate_id: 'candidate-1' },
    })
    const params = new URLSearchParams(body)
    assertEquals(params.get('source_transaction'), 'ch_source_123')
    assertEquals(params.get('metadata[fabric_candidate_id]'), 'candidate-1')
  } finally {
    globalThis.fetch = originalFetch
    if (previousKey === undefined) Deno.env.delete('STRIPE_SECRET_KEY')
    else Deno.env.set('STRIPE_SECRET_KEY', previousKey)
  }
})
