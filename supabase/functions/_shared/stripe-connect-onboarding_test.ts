import {
  buildStripeConnectCallbackUrl,
  pendingStripeConnectAccountId,
  prepareStripeConnectAccount,
  resolveStripeConnectCallbackUrls,
  stripeConnectAccountIdempotencyKey,
  stripeConnectCountryChangeConflictResponse,
  stripeConnectIdempotencyMismatchResponse,
  stripeConnectReturnResponse,
} from './stripe-connect-onboarding.ts'
import { StripeApiError } from './stripe.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { stagePayoutChangeRequest } from './verification-review.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function createPayoutChangeRequestStore() {
  const rows: Record<string, unknown>[] = []
  let insertCount = 0
  let updateCount = 0

  const client = {
    from(table: string) {
      if (table !== 'payout_change_requests') {
        throw new Error(`Unexpected table in payout-change test: ${table}`)
      }

      let operation: 'select' | 'insert' | 'update' = 'select'
      let values: Record<string, unknown> = {}
      const filters: Record<string, unknown> = {}
      const query = {
        select() {
          return query
        },
        eq(column: string, value: unknown) {
          filters[column] = value
          return query
        },
        order() {
          return query
        },
        limit() {
          return query
        },
        maybeSingle: async () => {
          const row = rows.find((candidate) =>
            Object.entries(filters).every(([column, value]) => candidate[column] === value)
          )
          return { data: row ? structuredClone(row) : null, error: null }
        },
        insert(input: Record<string, unknown>) {
          operation = 'insert'
          values = input
          return query
        },
        update(input: Record<string, unknown>) {
          operation = 'update'
          values = input
          return query
        },
        single: async () => {
          if (operation === 'insert') {
            insertCount += 1
            const row = {
              ...structuredClone(values),
              id: `payout-change-${insertCount}`,
              status: 'PENDING',
            }
            rows.push(row)
            return { data: { id: row.id }, error: null }
          }

          if (operation === 'update') {
            updateCount += 1
            const row = rows.find((candidate) => candidate.id === filters.id)
            if (!row) return { data: null, error: new Error('Pending request disappeared') }
            Object.assign(row, structuredClone(values))
            return { data: { id: row.id }, error: null }
          }

          throw new Error('Unexpected single() call in payout-change test')
        },
      }
      return query
    },
  }

  return {
    client: client as unknown as SupabaseClient,
    get rows() {
      return rows
    },
    get insertCount() {
      return insertCount
    },
    get updateCount() {
      return updateCount
    },
  }
}

Deno.test('Stripe Connect creation idempotency key is stable per tailor profile', () => {
  assert(
    stripeConnectAccountIdempotencyKey('profile-qa') === 'DRAPE-CONNECT-ACCT-profile-qa',
    'account idempotency key did not match the reviewed profile format',
  )
})

Deno.test('pending Stripe change request account id is reused only for the same country and currency', () => {
  const requestedDestination = {
    payout_provider: 'STRIPE',
    payout_currency: 'USD',
    payout_country_code: 'US',
    stripe_connect_account_id: 'acct_pending_stripe',
  }
  assert(
    pendingStripeConnectAccountId({
      requestedDestination,
      payoutCurrency: 'USD',
      countryCode: 'US',
    }) === 'acct_pending_stripe',
    'matching pending destination id was not reused',
  )
  assert(
    pendingStripeConnectAccountId({
      requestedDestination: {
        ...requestedDestination,
        stripe_connect_account_id: '',
        stripe_account_id: 'acct_legacy_pending',
      },
      payoutCurrency: 'USD',
      countryCode: 'US',
    }) === 'acct_legacy_pending',
    'legacy pending account id was ignored when the preferred column was empty',
  )
  assert(
    pendingStripeConnectAccountId({
      requestedDestination,
      payoutCurrency: 'USD',
      countryCode: 'CA',
    }) === null,
    'pending account id was reused for a different country',
  )
  assert(
    pendingStripeConnectAccountId({
      requestedDestination,
      payoutCurrency: 'GBP',
      countryCode: 'US',
    }) === null,
    'pending account id was reused for a different currency',
  )
})

Deno.test('Stripe idempotency parameter mismatch becomes a clear 409 support response', () => {
  const countryConflict = stripeConnectCountryChangeConflictResponse()
  assert(countryConflict.status === 409, 'a country change was not mapped to HTTP 409')
  assert(
    countryConflict.body.error.includes('Contact support to change payout country'),
    'country change did not give clear support guidance',
  )
  const conflict = stripeConnectIdempotencyMismatchResponse(
    new StripeApiError('Parameters differ', 400, 'idempotency_error', null),
  )
  assert(conflict?.status === 409, 'parameter mismatch was not mapped to HTTP 409')
  assert(
    conflict.body.code === 'STRIPE_CONNECT_REQUEST_PARAMETERS_CHANGED',
    'parameter mismatch did not return its stable error code',
  )
  assert(
    conflict.body.error.includes('Contact support to change payout country'),
    'parameter mismatch did not give the requested country-change guidance',
  )

  assert(
    stripeConnectIdempotencyMismatchResponse(
      new StripeApiError('Request still executing', 409, 'idempotency_error', 'idempotency_key_in_use'),
    ) === null,
    'an in-progress idempotent request must remain retryable',
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

Deno.test(
  'pending Stripe change retry reuses its saved account id after a link failure and idempotency window',
  async () => {
    const store = createPayoutChangeRequestStore()
    let accountCreates = 0
    const createdAccountIds = new Set<string>()
    const prepareAttempt = async (failLink: boolean) => {
      const pendingRequest = store.rows.find((request) => request.status === 'PENDING')
      const existingAccountId = pendingStripeConnectAccountId({
        requestedDestination:
          (pendingRequest?.requested_destination as Record<string, unknown> | undefined) ?? null,
        payoutCurrency: 'USD',
        countryCode: 'US',
      })
      const prepared = await prepareStripeConnectAccount(
        {
          supabaseUrl: 'https://pqptfuqogvrajozfsqzi.supabase.co',
          environment: 'SANDBOX',
          appReturnUrl: 'drape-dev:///',
          accountId: existingAccountId,
          idempotencyKey: 'DRAPE-CONNECT-ACCT-profile-existing-destination',
        },
        async () => {
          accountCreates += 1
          createdAccountIds.add('acct_pending_change')
          return { id: 'acct_pending_change' }
        },
        async (accountId) => {
          await stagePayoutChangeRequest(store.client, {
            tailorUserId: 'tailor-user-1',
            tailorProfileId: 'tailor-profile-1',
            currentDestination: {
              payout_provider: 'PAYSTACK',
              payout_currency: 'NGN',
            },
            requestedDestination: {
              payout_provider: 'STRIPE',
              payout_currency: 'USD',
              payout_country_code: 'US',
              stripe_connect_account_id: accountId,
            },
            metadata: { setup_state: 'ACCOUNT_CREATED_LINK_PENDING' },
          })
        },
      )
      assert(prepared.ok, 'pending payout change callback did not validate')
      assert(
        pendingStripeConnectAccountId({
          requestedDestination: store.rows[0]?.requested_destination as Record<string, unknown>,
          payoutCurrency: 'USD',
          countryCode: 'US',
        }) === prepared.accountId,
        'the pending request did not retain the account id before link creation',
      )
      if (failLink) throw new Error('simulated account-link timeout')
      return prepared.accountId
    }

    let firstAttemptFailed = false
    try {
      await prepareAttempt(true)
    } catch (error) {
      firstAttemptFailed = error instanceof Error && error.message === 'simulated account-link timeout'
    }
    assert(firstAttemptFailed, 'the first Account Link attempt did not fail as expected')
    // Model a retry beyond Stripe's 24-hour idempotency retention window.
    store.rows[0]!.updated_at = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()

    const retryAccountId = await prepareAttempt(false)
    assert(retryAccountId === 'acct_pending_change', 'retry did not reuse the pending account id')
    assert(accountCreates === 1, 'retry created a second Stripe connected account')
    assert(createdAccountIds.size === 1, 'more than one Stripe account was created')
    assert(store.insertCount === 1, 'retry created a second pending payout change request')
    assert(store.updateCount === 1, 'retry did not update the existing pending payout change request')
    assert(store.rows.length === 1, 'retry left multiple pending payout change requests')
    assert(store.rows[0]?.id === 'payout-change-1', 'retry replaced the original pending request')
  },
)

Deno.test(
  'Stripe onboarding aborts when persisting the account id fails',
  async () => {
    let accountLinkCreated = false
    let persistenceFailed = false

    try {
      const prepared = await prepareStripeConnectAccount(
        {
          supabaseUrl: 'https://pqptfuqogvrajozfsqzi.supabase.co',
          environment: 'SANDBOX',
          appReturnUrl: 'drape-dev:///',
          accountId: null,
          idempotencyKey: 'DRAPE-CONNECT-ACCT-profile-write-failure',
        },
        async () => ({ id: 'acct_persist_failure' }),
        async () => {
          throw new Error('STRIPE_CONNECT_ACCOUNT_PROFILE_LINK_FAILED')
        },
      )

      if (prepared.ok) accountLinkCreated = true
    } catch (error) {
      persistenceFailed =
        error instanceof Error && error.message === 'STRIPE_CONNECT_ACCOUNT_PROFILE_LINK_FAILED'
    }

    assert(persistenceFailed, 'failed account-id persistence was not surfaced')
    assert(!accountLinkCreated, 'onboarding continued to Account Link creation after persistence failed')
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
