import assert from 'node:assert/strict'
import test from 'node:test'
import { isStripeReturnUrl, STRIPE_RETURN_URL, STRIPE_URL_SCHEME, subscribeStripeReturnUrls } from './stripe-return-url.ts'

test('Stripe return URL uses the app scheme and accepts callback parameters', () => {
  assert.equal(STRIPE_URL_SCHEME, 'drape')
  assert.equal(STRIPE_RETURN_URL, 'drape://stripe-redirect')
  assert.equal(isStripeReturnUrl('drape://stripe-redirect?payment_intent=pi_test'), true)
  assert.equal(isStripeReturnUrl('drape://stripe-redirect/path'), true)
})

test('other deep links cannot be sent to the Stripe callback', () => {
  assert.equal(isStripeReturnUrl('drape://payment-redirect?reference=order'), false)
  assert.equal(isStripeReturnUrl('drape://stripe-redirect-extra'), false)
  assert.equal(isStripeReturnUrl('https://example.com/stripe-redirect'), false)
  assert.equal(isStripeReturnUrl(null), false)
})

test('the root listener forwards only the Stripe return and stops after cleanup', async () => {
  const handled: string[] = []
  const errors: unknown[] = []
  const subscription = { listener: null as ((event: { url: string }) => void) | null }
  const stop = subscribeStripeReturnUrls({
    getInitialURL: async () => 'drape://payment-redirect?reference=order',
    addEventListener: (_event, callback) => {
      subscription.listener = callback
      return { remove: () => { subscription.listener = null } }
    },
  }, async (url) => {
    handled.push(url)
    return true
  }, (error) => { errors.push(error) })

  await Promise.resolve()
  subscription.listener?.({ url: 'drape://payment-redirect?reference=order' })
  subscription.listener?.({ url: 'drape://stripe-redirect?payment_intent=pi_test' })
  await Promise.resolve()
  assert.deepEqual(handled, ['drape://stripe-redirect?payment_intent=pi_test'])
  assert.deepEqual(errors, [])
  stop()
  assert.equal(subscription.listener, null)
})

test('a Stripe callback failure is reported without forwarding credentials', async () => {
  const errors: unknown[] = []
  const expected = new Error('native callback failed')
  subscribeStripeReturnUrls({
    getInitialURL: async () => 'drape://stripe-redirect?payment_intent=pi_test',
    addEventListener: () => ({ remove: () => {} }),
  }, async () => { throw expected }, (error) => { errors.push(error) })
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(errors, [expected])
})
