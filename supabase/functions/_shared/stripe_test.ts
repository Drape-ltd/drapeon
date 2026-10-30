import { assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  createStripeConnectAccount,
  stripeTransfersAndPayoutsReady,
  verifyStripeWebhookSignature,
} from './stripe.ts'

const encoder = new TextEncoder()

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

async function signStripePayload(timestamp: number, payload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${payload}`))
  return hex(digest)
}

Deno.test('verifyStripeWebhookSignature accepts any configured webhook secret', async () => {
  const payload = JSON.stringify({ id: 'evt_test_1', type: 'payment_intent.succeeded' })
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = await signStripePayload(timestamp, payload, 'new-secret')

  await verifyStripeWebhookSignature({
    payload,
    signatureHeader: `t=${timestamp},v1=${signature}`,
    webhookSecret: ['old-secret', 'new-secret'],
  })
})

Deno.test('verifyStripeWebhookSignature rejects when no configured secret matches', async () => {
  const payload = JSON.stringify({ id: 'evt_test_2', type: 'payment_intent.succeeded' })
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = await signStripePayload(timestamp, payload, 'actual-secret')

  await assertRejects(
    () =>
      verifyStripeWebhookSignature({
        payload,
        signatureHeader: `t=${timestamp},v1=${signature}`,
        webhookSecret: ['wrong-secret'],
      }),
    Error,
    'No Stripe webhook signatures matched',
  )
})

Deno.test('Stripe payout readiness requires active transfers and payouts, not charge capability', () => {
  const payoutOnlyAccount = {
    id: 'acct_test',
    charges_enabled: false,
    payouts_enabled: true,
    capabilities: { transfers: 'active' as const },
  }
  if (!stripeTransfersAndPayoutsReady(payoutOnlyAccount)) {
    throw new Error('A payout-only account with active transfers and payouts should be ready.')
  }
  if (stripeTransfersAndPayoutsReady({ ...payoutOnlyAccount, capabilities: { transfers: 'pending' } })) {
    throw new Error('A pending transfer capability must not be treated as payout-ready.')
  }
  if (stripeTransfersAndPayoutsReady({ ...payoutOnlyAccount, payouts_enabled: false })) {
    throw new Error('A disabled payout capability must not be treated as payout-ready.')
  }
  if (stripeTransfersAndPayoutsReady({ ...payoutOnlyAccount, capabilities: null })) {
    throw new Error('A missing transfer capability must fail closed.')
  }
})

Deno.test('createStripeConnectAccount sends the deterministic idempotency key', async () => {
  const previousKey = Deno.env.get('STRIPE_SECRET_KEY')
  const originalFetch = globalThis.fetch
  let receivedIdempotencyKey: string | null = null
  Deno.env.set('STRIPE_SECRET_KEY', 'sk_test_unit_only')
  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    receivedIdempotencyKey = new Headers(init?.headers).get('Idempotency-Key')
    return new Response(JSON.stringify({
      id: 'acct_unit_test',
      charges_enabled: false,
      payouts_enabled: false,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  try {
    await createStripeConnectAccount({
      email: 'qa@example.invalid',
      countryCode: 'US',
      idempotencyKey: 'DRAPE-CONNECT-ACCT-profile-qa',
    })
  } finally {
    globalThis.fetch = originalFetch
    if (previousKey === undefined) Deno.env.delete('STRIPE_SECRET_KEY')
    else Deno.env.set('STRIPE_SECRET_KEY', previousKey)
  }

  if (receivedIdempotencyKey !== 'DRAPE-CONNECT-ACCT-profile-qa') {
    throw new Error('Stripe Connect account creation omitted its idempotency key.')
  }
})
