import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { isStripeReturnUrl, stripeReturnConfigForScheme, subscribeStripeReturnUrls } from './stripe-return-url.ts'

const require = createRequire(import.meta.url)
const appConfig = require('../app.config.js') as (options: { config: Record<string, unknown> }) => { scheme: string }

test('Dev, Preview and store builds each use only their registered scheme', () => {
  const previousVariant = process.env.EXPO_PUBLIC_APP_VARIANT
  try {
    for (const [variant, scheme] of [
      ['development', 'drape-dev'], ['preview', 'drape-preview'],
      ['testflight', 'drape'], ['production', 'drape'],
    ]) {
      process.env.EXPO_PUBLIC_APP_VARIANT = variant
      assert.equal(appConfig({ config: {} }).scheme, scheme)
      const config = stripeReturnConfigForScheme(scheme)
      assert.deepEqual(config, { scheme, returnURL: `${scheme}://stripe-redirect` })
      assert.equal(isStripeReturnUrl(`${scheme}://stripe-redirect?payment_intent=pi_test`, config!), true)
      assert.equal(isStripeReturnUrl(`${scheme}://stripe-redirect#done`, config!), true)
    }
    assert.deepEqual(stripeReturnConfigForScheme(['drape-dev']), {
      scheme: 'drape-dev', returnURL: 'drape-dev://stripe-redirect',
    })
  } finally {
    if (previousVariant === undefined) delete process.env.EXPO_PUBLIC_APP_VARIANT
    else process.env.EXPO_PUBLIC_APP_VARIANT = previousVariant
  }
})

test('the Dev listener rejects the store app and Expo dev-client URLs', () => {
  const config = stripeReturnConfigForScheme('drape-dev')!
  assert.equal(isStripeReturnUrl('drape://stripe-redirect?payment_intent=pi_test', config), false)
  assert.equal(isStripeReturnUrl('drape-preview://stripe-redirect', config), false)
  assert.equal(isStripeReturnUrl('exp+drape://expo-development-client/?url=drape-dev%3A%2F%2Fstripe-redirect', config), false)
  assert.equal(isStripeReturnUrl('drape-dev://payment-redirect?reference=order', config), false)
  assert.equal(isStripeReturnUrl('drape-dev://stripe-redirect-extra', config), false)
  assert.equal(isStripeReturnUrl('drape-dev://stripe-redirect/path', config), false)
  assert.equal(isStripeReturnUrl(null, config), false)
  assert.equal(stripeReturnConfigForScheme('exp+drape'), null)
  assert.equal(stripeReturnConfigForScheme(['drape-dev', 'drape']), null)
})

test('the root listener forwards only the Stripe return and stops after cleanup', async () => {
  const handled: string[] = []
  const errors: unknown[] = []
  const subscription = { listener: null as ((event: { url: string }) => void) | null }
  const config = stripeReturnConfigForScheme('drape-dev')!
  const stop = subscribeStripeReturnUrls({
    getInitialURL: async () => 'exp+drape://expo-development-client/?url=drape-dev%3A%2F%2Fstripe-redirect',
    addEventListener: (_event, callback) => {
      subscription.listener = callback
      return { remove: () => { subscription.listener = null } }
    },
  }, config, async (url) => {
    handled.push(url)
    return true
  }, (error) => { errors.push(error) })

  await Promise.resolve()
  subscription.listener?.({ url: 'drape://stripe-redirect?payment_intent=pi_other_app' })
  subscription.listener?.({ url: 'drape-dev://payment-redirect?reference=order' })
  subscription.listener?.({ url: 'drape-dev://stripe-redirect?payment_intent=pi_test' })
  await Promise.resolve()
  assert.deepEqual(handled, ['drape-dev://stripe-redirect?payment_intent=pi_test'])
  assert.deepEqual(errors, [])
  stop()
  assert.equal(subscription.listener, null)
})

test('a Stripe callback failure is reported without forwarding credentials', async () => {
  const errors: unknown[] = []
  const expected = new Error('native callback failed')
  subscribeStripeReturnUrls({
    getInitialURL: async () => 'drape-dev://stripe-redirect?payment_intent=pi_test',
    addEventListener: () => ({ remove: () => {} }),
  }, stripeReturnConfigForScheme('drape-dev')!, async () => { throw expected }, (error) => { errors.push(error) })
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(errors, [expected])
})
