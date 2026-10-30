import { retrieveCurrentStripeConnectAccountForEvent } from './stripe-connect-account-update.ts'
import { stripeTransfersAndPayoutsReady } from './stripe.ts'

Deno.test('late verified account.updated uses the current disabled Stripe account', async () => {
  const lateVerifiedEvent = {
    id: 'evt_old_ready',
    type: 'account.updated',
    account: null,
    data: {
      object: {
        id: 'acct_123',
        payouts_enabled: true,
        charges_enabled: true,
        capabilities: { transfers: 'active' },
      },
    },
  }

  let retrievedId: string | null = null
  const current = await retrieveCurrentStripeConnectAccountForEvent(
    lateVerifiedEvent,
    (accountId) => {
      retrievedId = accountId
      return Promise.resolve({
        id: accountId,
        country: 'US',
        charges_enabled: false,
        payouts_enabled: false,
        capabilities: { transfers: 'inactive' },
      })
    },
  )

  if (retrievedId !== 'acct_123' || !current) {
    throw new Error('The webhook must retrieve the event account from Stripe.')
  }
  if (stripeTransfersAndPayoutsReady(current)) {
    throw new Error('A stale ready snapshot must not overwrite the current disabled state.')
  }
})

Deno.test('account.updated without an account identity is invalid without an API call', async () => {
  let calls = 0
  const current = await retrieveCurrentStripeConnectAccountForEvent(
    { data: { object: {} } },
    () => {
      calls += 1
      throw new Error('unexpected retrieval')
    },
  )
  if (current !== null || calls !== 0) {
    throw new Error('Missing account identity must not trigger an unscoped Stripe read.')
  }
})
