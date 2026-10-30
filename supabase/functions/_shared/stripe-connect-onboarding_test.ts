import {
  buildStripeConnectCallbackUrl,
  prepareStripeConnectAccount,
  resolveStripeConnectCallbackUrls,
  stripeConnectAccountIdempotencyKey,
  stripeConnectReturnResponse,
} from './stripe-connect-onboarding.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

Deno.test('Stripe Connect creation idempotency key is stable per tailor profile', () => {
  assert(
    stripeConnectAccountIdempotencyKey('profile-qa') === 'DRAPE-CONNECT-ACCT-profile-qa',
    'account idempotency key did not match the reviewed profile format',
  )
})

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
        idempotencyKey: 'DRAPE-CONNECT-ACCT-profile-1',
      },
      async () => {
        accountCreates += 1
        return { id: 'acct_should_not_be_created' }
      },
      async () => {},
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
        idempotencyKey: 'DRAPE-CONNECT-ACCT-profile-1',
      },
      async (idempotencyKey) => {
        assert(idempotencyKey === 'DRAPE-CONNECT-ACCT-profile-1', 'wrong account idempotency key')
        accountCreates += 1
        return { id: 'acct_dev_test' }
      },
      async () => {},
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

Deno.test(
  'Stripe account id is persisted before link creation and retry reuses the same account',
  async () => {
    const idempotencyKey = 'DRAPE-CONNECT-ACCT-profile-qa'
    let storedAccountId: string | null = null
    let accountCreates = 0
    let linkAttempts = 0

    const startOnboarding = async (failLink: boolean) => {
      const prepared = await prepareStripeConnectAccount(
        {
          supabaseUrl: 'https://pqptfuqogvrajozfsqzi.supabase.co',
          environment: 'SANDBOX',
          appReturnUrl: 'drape-dev:///',
          accountId: storedAccountId,
          idempotencyKey,
        },
        async (receivedKey) => {
          assert(receivedKey === idempotencyKey, 'retry changed the idempotency key')
          accountCreates += 1
          return { id: 'acct_single_create' }
        },
        async (accountId) => {
          storedAccountId = accountId
        },
      )
      assert(prepared.ok, 'callback validation failed')
      assert(storedAccountId === prepared.accountId, 'account id was not stored before link creation')

      linkAttempts += 1
      if (failLink) throw new Error('simulated account-link timeout')
      return prepared.accountId
    }

    let firstAttemptFailed = false
    try {
      await startOnboarding(true)
    } catch (error) {
      firstAttemptFailed = error instanceof Error && error.message === 'simulated account-link timeout'
    }
    assert(firstAttemptFailed, 'the simulated link failure did not occur')
    assert(storedAccountId === 'acct_single_create', 'failed link left the account id unsaved')

    const retryAccountId = await startOnboarding(false)
    assert(retryAccountId === 'acct_single_create', 'retry did not reuse the saved account')
    assert(accountCreates === 1, 'retry created a duplicate Stripe account')
    assert(linkAttempts === 2, 'retry did not attempt a fresh onboarding link')
  },
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
