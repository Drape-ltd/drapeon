import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  cancelThenRetrieveStripePaymentIntent,
  initialStripePaymentSuccessReviewReason,
} from './payment-expiry-safety.ts'

Deno.test('Stripe expiry always retrieves after requesting cancellation', async () => {
  const calls: string[] = []
  const result = await cancelThenRetrieveStripePaymentIntent(
    'pi-expire',
    async (id) => {
      calls.push(`cancel:${id}`)
    },
    async (id) => {
      calls.push(`retrieve:${id}`)
      return { id, status: 'canceled' }
    }
  )

  assertEquals(calls, ['cancel:pi-expire', 'retrieve:pi-expire'])
  assertEquals(result, {
    kind: 'canceled',
    paymentIntent: { id: 'pi-expire', status: 'canceled' },
  })
})

Deno.test('a payment that succeeds during cancellation is returned for manual review', async () => {
  const result = await cancelThenRetrieveStripePaymentIntent(
    'pi-race',
    async () => {
      throw new Error('Stripe reports the payment already succeeded')
    },
    async (id) => ({ id, status: 'succeeded' })
  )

  assertEquals(result, {
    kind: 'succeeded',
    paymentIntent: { id: 'pi-race', status: 'succeeded' },
  })
})

Deno.test('unknown or nonterminal post-cancel state cannot expire locally', async () => {
  const unresolved = await cancelThenRetrieveStripePaymentIntent(
    'pi-processing',
    async () => undefined,
    async (id) => ({ id, status: 'processing' })
  )
  const unknown = await cancelThenRetrieveStripePaymentIntent(
    'pi-unknown',
    async () => undefined,
    async () => {
      throw new Error('temporary network failure')
    }
  )

  assertEquals(unresolved.kind, 'nonterminal')
  assertEquals(unknown, { kind: 'unknown', cancelFailed: false })
})

Deno.test('mismatched provider response cannot be treated as a canceled attempt', async () => {
  const result = await cancelThenRetrieveStripePaymentIntent(
    'pi-expected',
    async () => undefined,
    async () => ({ id: 'pi-other', status: 'canceled' })
  )

  assertEquals(result, { kind: 'unknown', cancelFailed: false })
})

Deno.test(
  'only the current, nonterminal initial-order payment in a payable stage auto-confirms',
  () => {
    const valid = {
      orderId: 'order-1',
      attemptOrderId: 'order-1',
      attemptPhase: 'INITIAL_ORDER',
      attemptStatus: 'PENDING',
      orderStage: 'PAYMENT_PENDING',
      currentPaymentIntentId: 'pi-current',
      succeededPaymentIntentId: 'pi-current',
    }

    assertEquals(initialStripePaymentSuccessReviewReason(valid), null)
    assertEquals(
      initialStripePaymentSuccessReviewReason({
        ...valid,
        orderStage: 'PAYMENT_FAILED',
      }),
      'order_payment_failed'
    )
    assertEquals(
      initialStripePaymentSuccessReviewReason({
        ...valid,
        attemptStatus: 'CANCELED',
      }),
      'payment_attempt_was_terminal'
    )
    assertEquals(
      initialStripePaymentSuccessReviewReason({
        ...valid,
        currentPaymentIntentId: null,
      }),
      'payment_reference_not_current'
    )
    assertEquals(
      initialStripePaymentSuccessReviewReason({
        ...valid,
        attemptPhase: 'ADJUSTMENT',
      }),
      'payment_attempt_phase_mismatch'
    )
    assertEquals(
      initialStripePaymentSuccessReviewReason({
        ...valid,
        attemptOrderId: 'order-other',
      }),
      'payment_attempt_order_mismatch'
    )
    assertEquals(
      initialStripePaymentSuccessReviewReason({
        ...valid,
        orderStage: 'EXPIRED',
      }),
      'order_not_payable'
    )
    assertEquals(
      initialStripePaymentSuccessReviewReason({ ...valid, attemptOrderId: null }),
      'payment_attempt_missing'
    )
  }
)
