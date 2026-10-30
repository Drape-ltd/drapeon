import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  cancelStripeAttemptBeforeReplacement,
  stripeReplacementCancelKey,
  stripeReplacementPrepareKey,
} from './stripe-payment-replacement.ts'
import type { StripePaymentIntent } from './stripe.ts'

function intent(id: string, status: string): StripePaymentIntent {
  return { id, status, amount: 1000, currency: 'usd', client_secret: `${id}_secret` }
}

Deno.test('failed retry cancels the old PI before allowing a replacement', async () => {
  const calls: string[] = []
  const result = await cancelStripeAttemptBeforeReplacement({
    attemptId: 'attempt-1', paymentIntentId: 'pi_old',
    retrieve: async () => intent('pi_old', 'requires_payment_method'),
    cancel: async (_id, key) => { calls.push(key); return intent('pi_old', 'canceled') },
    markSuperseded: async () => { calls.push('superseded') },
  })
  assertEquals(result.kind, 'replace')
  assertEquals(calls, [stripeReplacementCancelKey('attempt-1'), 'superseded'])
})

Deno.test('old PI already succeeded never creates a replacement', async () => {
  let canceled = false
  const result = await cancelStripeAttemptBeforeReplacement({
    attemptId: 'attempt-1', paymentIntentId: 'pi_old',
    retrieve: async () => intent('pi_old', 'succeeded'),
    cancel: async () => { canceled = true; return intent('pi_old', 'canceled') },
    markSuperseded: async () => { throw new Error('must not supersede') },
  })
  assertEquals(result.kind, 'succeeded')
  assertEquals(canceled, false)
})

Deno.test('expiry-canceled PI can be replaced without another cancel', async () => {
  let cancelCount = 0
  const result = await cancelStripeAttemptBeforeReplacement({
    attemptId: 'attempt-expired', paymentIntentId: 'pi_expired',
    retrieve: async () => intent('pi_expired', 'canceled'),
    cancel: async () => { cancelCount += 1; return intent('pi_expired', 'canceled') },
    markSuperseded: async () => {},
  })
  assertEquals(result.kind, 'replace')
  assertEquals(cancelCount, 0)
})

Deno.test('two concurrent retries share one cancel key and one replacement key', async () => {
  const cancelKeys: string[] = []
  let canceled = false
  const run = () => cancelStripeAttemptBeforeReplacement({
    attemptId: 'attempt-race', paymentIntentId: 'pi_race',
    retrieve: async () => intent('pi_race', canceled ? 'canceled' : 'requires_payment_method'),
    cancel: async (_id, key) => { cancelKeys.push(key); canceled = true; return intent('pi_race', 'canceled') },
    markSuperseded: async () => {},
  })
  const results = await Promise.all([run(), run()])
  assertEquals(results.map((result) => result.kind), ['replace', 'replace'])
  assertEquals(new Set(cancelKeys), new Set([stripeReplacementCancelKey('attempt-race')]))
  assertEquals(stripeReplacementPrepareKey('DRAPE-PAY-order', 'attempt-race'), 'DRAPE-PAY-order-R-attempt-race')
})

Deno.test('three terminal failures produce distinct deterministic replacement keys', () => {
  assertEquals([
    stripeReplacementPrepareKey('DRAPE-PAY-order', 'attempt-1'),
    stripeReplacementPrepareKey('DRAPE-PAY-order', 'attempt-2'),
    stripeReplacementPrepareKey('DRAPE-PAY-order', 'attempt-3'),
  ], [
    'DRAPE-PAY-order-R-attempt-1',
    'DRAPE-PAY-order-R-attempt-2',
    'DRAPE-PAY-order-R-attempt-3',
  ])
})

Deno.test('ambiguous cancellation that remains active blocks replacement', async () => {
  await assertRejects(() => cancelStripeAttemptBeforeReplacement({
    attemptId: 'attempt-1', paymentIntentId: 'pi_old',
    retrieve: async () => intent('pi_old', 'requires_action'),
    cancel: async () => { throw new Error('timeout') },
    markSuperseded: async () => {},
  }), Error, 'remained requires_action')
})
