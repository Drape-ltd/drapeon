import { syncStripePayoutProfileReadiness } from './stripe-payout-profile-readiness.ts'
import type { StripeConnectAccount } from './stripe.ts'

const ready: StripeConnectAccount = {
  id: 'acct_ready', country: 'us', charges_enabled: false, payouts_enabled: true,
  capabilities: { transfers: 'active' },
}

Deno.test('repeated ready Stripe observation is delegated as a no-op', async () => {
  const calls: Array<Record<string, unknown>> = []
  const supabase = {
    rpc(_name: string, value: Record<string, unknown>) {
      calls.push(value)
      return Promise.resolve({ data: [{ transitioned: false }], error: null })
    },
  }
  const result = await syncStripePayoutProfileReadiness(supabase, {
    profileId: 'profile-1', account: ready, observedAt: '2026-10-30T12:00:00Z',
  })
  if (result.transitioned || !result.verified || calls[0]?.p_country_code !== 'US') {
    throw new Error('Identical readiness must return a successful no-op with normalized evidence.')
  }
})

Deno.test('lost Stripe payout capability is persisted through the guarded RPC', async () => {
  const calls: Array<Record<string, unknown>> = []
  const supabase = {
    rpc(_name: string, value: Record<string, unknown>) {
      calls.push(value)
      return Promise.resolve({ data: [{ transitioned: true }], error: null })
    },
  }
  const result = await syncStripePayoutProfileReadiness(supabase, {
    profileId: 'profile-1',
    account: { ...ready, payouts_enabled: false },
    observedAt: '2026-10-30T13:00:00Z',
  })
  if (!result.transitioned || result.verified || calls[0]?.p_verified !== false) {
    throw new Error('Lost payout capability must be recorded as not ready.')
  }
})
