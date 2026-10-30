import {
  buildStripeConnectCallbackUrl,
  prepareStripeConnectAccount,
  resolveStripeConnectCallbackUrls,
  stripeConnectReturnResponse,
} from './stripe-connect-onboarding.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

Deno.test('mobile Stripe return uses a Dev HTTPS function URL and the Dev app scheme', () => {
  const callback = buildStripeConnectCallbackUrl({
    supabaseUrl: 'https://pqptfuqogvrajozfsqzi.supabase.co',
    environment: 'SANDBOX',
    appReturnUrl: 'drape-dev://',
  })
  assert(callback, 'expected a callback URL')

  const parsed = new URL(callback)
  assert(parsed.protocol === 'https:', 'Stripe must receive HTTPS')
  assert(
    parsed.hostname === 'pqptfuqogvrajozfsqzi.supabase.co',
    'the callback must remain on the Dev project'
  )
  assert(
    parsed.pathname === '/functions/v1/payout-account-action',
    'the callback must target the payout action function'
  )
  assert(parsed.searchParams.get('stripe_connect_return') === '1', 'callback marker is missing')
  assert(parsed.searchParams.get('redirect_uri') === 'drape-dev://', 'Dev redirect is missing')
})

Deno.test(
  'an invalid mobile return URL is rejected before any Stripe account is created',
  async () => {
    let accountCreates = 0
    const result = await prepareStripeConnectAccount(
      {
        supabaseUrl: 'https://pqptfuqogvrajozfsqzi.supabase.co',
        environment: 'SANDBOX',
        appReturnUrl: 'drape-dev://attacker.example',
        accountId: null,
      },
      async () => {
        accountCreates += 1
        return { id: 'acct_should_not_be_created' }
      }
    )

    assert(!result.ok && result.reason === 'INVALID_CALLBACK_URL', 'invalid callback was accepted')
    assert(accountCreates === 0, 'Stripe account creation ran for an invalid callback')
  }
)

Deno.test(
  'valid mobile callbacks create one account and prepare Dev HTTPS return URLs',
  async () => {
    let accountCreates = 0
    const result = await prepareStripeConnectAccount(
      {
        supabaseUrl: 'https://pqptfuqogvrajozfsqzi.supabase.co',
        environment: 'SANDBOX',
        appReturnUrl: 'drape-dev:///',
        accountId: null,
      },
      async () => {
        accountCreates += 1
        return { id: 'acct_dev_test' }
      }
    )

    assert(result.ok, 'valid callback did not create an onboarding session')
    assert(accountCreates === 1, 'a new account should be created exactly once')
    assert(result.accountId === 'acct_dev_test', 'account id was not retained')
    assert(result.callbackUrls.returnUrl === result.callbackUrls.refreshUrl, 'callback URLs differ')
    assert(
      result.callbackUrls.returnUrl.startsWith('https://pqptfuqogvrajozfsqzi.supabase.co/'),
      'Stripe did not receive a Dev HTTPS URL'
    )
  }
)

Deno.test('legacy web callbacks stay HTTP(S)-only and permit loopback HTTP in Dev', () => {
  const loopback = resolveStripeConnectCallbackUrls({
    supabaseUrl: 'https://pqptfuqogvrajozfsqzi.supabase.co',
    environment: 'SANDBOX',
    returnUrl: 'http://127.0.0.1:3000/account/payout?setup=complete',
    refreshUrl: 'http://localhost:3000/account/payout?setup=refresh',
  })
  assert(loopback, 'Dev loopback URLs should remain available for local web tests')

  const customScheme = resolveStripeConnectCallbackUrls({
    supabaseUrl: 'https://pqptfuqogvrajozfsqzi.supabase.co',
    environment: 'SANDBOX',
    returnUrl: 'drape-dev://',
    refreshUrl: 'drape-dev://',
  })
  assert(customScheme === null, 'a custom scheme was allowed as a Stripe URL')

  const productionLoopback = resolveStripeConnectCallbackUrls({
    supabaseUrl: 'https://wkfsrunetmgjdtcurmoj.supabase.co',
    environment: 'PRODUCTION',
    returnUrl: 'http://localhost:3000/account/payout',
    refreshUrl: 'https://drapeon.co/account/payout',
  })
  assert(productionLoopback === null, 'Production accepted an HTTP return URL')
})

Deno.test('Stripe Connect return route redirects only to the environment app scheme', () => {
  const valid = stripeConnectReturnResponse(
    new Request(
      'https://pqptfuqogvrajozfsqzi.supabase.co/functions/v1/payout-account-action?stripe_connect_return=1&redirect_uri=drape-dev%3A%2F%2F'
    ),
    'SANDBOX'
  )
  assert(valid.status === 302, 'valid Dev return should redirect')
  assert(valid.headers.get('Location') === 'drape-dev://', 'return URI changed unexpectedly')

  const wrongEnvironment = stripeConnectReturnResponse(
    new Request(
      'https://pqptfuqogvrajozfsqzi.supabase.co/functions/v1/payout-account-action?stripe_connect_return=1&redirect_uri=drape%3A%2F%2F'
    ),
    'SANDBOX'
  )
  assert(wrongEnvironment.status === 400, 'Dev must reject the production app scheme')
})
