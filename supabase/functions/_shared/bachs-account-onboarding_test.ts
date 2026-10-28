import { assertEquals } from 'jsr:@std/assert@1'
import { startBachsAccountOnboarding } from './bachs-account-onboarding.ts'
import type { BachsAccount } from './bachs-operations.ts'

const route = {
  id: 'route-bachs-ngn',
  version: 2,
  status: 'SANDBOX_ONLY',
  provider: 'BACHS',
  legal_entity: 'DRAPE_MARKETPLACE_LIMITED',
  tailor_country_code: 'NG',
  payout_currency: 'NGN',
  fees_collector: 'PLATFORM' as const,
}
const account: BachsAccount = {
  id: 'acct_bachs_qa',
  country: 'NG',
  responsibilities: { fees: { collector: 'platform' } },
  capabilities: {
    transfers: { status: 'active' },
    payouts: { status: 'active' },
  },
}

function fakeSupabase(claim: Record<string, unknown>, bindResult: unknown = true) {
  const calls: string[] = []
  const writes: Array<Record<string, unknown>> = []
  let table = ''
  let operation = 'select'
  const supabase = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push(name)
      if (name === 'bind_bachs_account_setup') {
        calls.push(`bind:${String(args.p_provider_account_ref)}`)
        return Promise.resolve({ data: bindResult, error: null })
      }
      return Promise.resolve({ data: [claim], error: null })
    },
    from(name: string) {
      table = name
      operation = 'select'
      const query: any = {
        select() {
          return query
        },
        eq() {
          return query
        },
        maybeSingle() {
          if (table === 'payment_routes') {
            return Promise.resolve({ data: route, error: null })
          }
          return Promise.resolve({ data: null, error: null })
        },
        insert(value: Record<string, unknown>) {
          operation = 'insert'
          writes.push(value)
          return query
        },
        single() {
          return Promise.resolve({
            data: { id: 'destination-new' },
            error: null,
          })
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          if (operation === 'update') writes.push({})
          return Promise.resolve({ data: [], error: null }).then(resolve, reject)
        },
      }
      return query
    },
  }
  return { supabase, calls, writes }
}

function input(fake: ReturnType<typeof fakeSupabase>, overrides: Record<string, unknown> = {}) {
  const events: string[] = []
  return {
    events,
    value: {
      supabase: fake.supabase,
      tailorProfileId: 'profile-qa',
      route,
      email: 'qa@example.invalid',
      displayName: 'QA Tailor',
      returnUrl: 'https://drapeon.co/payouts/bachs/return',
      refreshUrl: 'https://drapeon.co/payouts/bachs/refresh',
      checkedAt: '2026-10-27T12:00:00Z',
      createAccount: async (request: { idempotencyKey: string }) => {
        events.push(`create:${request.idempotencyKey}`)
        return account
      },
      retrieveAccount: async (accountId: string) => {
        events.push(`retrieve:${accountId}`)
        return account
      },
      createOnboardingLink: async (request: { accountId: string }) => {
        events.push(`link:${request.accountId}`)
        return {
          id: 'alnk_test',
          account: request.accountId,
          url: 'https://onboarding.bachs.io/test',
          expires_at: '2026-10-27T13:00:00Z',
        }
      },
      ...overrides,
    },
  }
}

Deno.test(
  'first Bachs onboarding reserves once and binds account before retrieve/link',
  async () => {
    const fake = fakeSupabase({
      claim_id: 'claim-1',
      provider_request_key: 'fixed-key',
      provider_account_ref: null,
      state: 'RESERVED',
      may_create: true,
    })
    const testInput = input(fake)
    const result = await startBachsAccountOnboarding(testInput.value)
    assertEquals(result, {
      state: 'LINK_READY',
      claimId: 'claim-1',
      accountId: 'acct_bachs_qa',
      destinationId: 'destination-new',
      destinationActive: false,
      firstWithdrawalReviewStatus: 'PENDING',
      onboardingUrl: 'https://onboarding.bachs.io/test',
      expiresAt: '2026-10-27T13:00:00Z',
    })
    assertEquals(testInput.events[0], 'create:fixed-key')
    assertEquals(fake.calls, [
      'reserve_bachs_account_setup',
      'bind_bachs_account_setup',
      'bind:acct_bachs_qa',
    ])
    assertEquals(testInput.events[1], 'retrieve:acct_bachs_qa')
    assertEquals(testInput.events[2], 'link:acct_bachs_qa')
    assertEquals(fake.writes[0].fees_collector, 'PLATFORM')
  }
)

Deno.test('an uncertain existing reservation never creates a second provider account', async () => {
  const fake = fakeSupabase({
    claim_id: 'claim-1',
    provider_request_key: 'fixed-key',
    provider_account_ref: null,
    state: 'RESERVED',
    may_create: false,
  })
  const testInput = input(fake)
  const result = await startBachsAccountOnboarding(testInput.value)
  assertEquals(result, { state: 'UNCERTAIN', claimId: 'claim-1' })
  assertEquals(testInput.events, [])
  assertEquals(fake.calls, ['reserve_bachs_account_setup'])
})

Deno.test(
  'bound account re-entry retrieves and refreshes without creating another account',
  async () => {
    const fake = fakeSupabase({
      claim_id: 'claim-1',
      provider_request_key: 'fixed-key',
      provider_account_ref: 'acct_bachs_qa',
      state: 'BOUND',
      may_create: false,
    })
    const testInput = input(fake)
    const result = await startBachsAccountOnboarding(testInput.value)
    assertEquals(result.state, 'LINK_READY')
    assertEquals(
      testInput.events.map((event) => event.split(':')[0]),
      ['retrieve', 'link']
    )
    assertEquals(fake.calls, ['reserve_bachs_account_setup'])
  }
)

Deno.test('failed account-ID bind stops before follow-up provider reads or links', async () => {
  const fake = fakeSupabase(
    {
      claim_id: 'claim-1',
      provider_request_key: 'fixed-key',
      provider_account_ref: null,
      state: 'RESERVED',
      may_create: true,
    },
    false
  )
  const testInput = input(fake)
  const result = await startBachsAccountOnboarding(testInput.value)
  assertEquals(result, { state: 'UNCERTAIN', claimId: 'claim-1' })
  assertEquals(testInput.events, ['create:fixed-key'])
})

Deno.test(
  'uncertain account creation leaves claim reserved and never binds or retries',
  async () => {
    const fake = fakeSupabase({
      claim_id: 'claim-1',
      provider_request_key: 'fixed-key',
      provider_account_ref: null,
      state: 'RESERVED',
      may_create: true,
    })
    const testInput = input(fake, {
      createAccount: async () => {
        testInput.events.push('create:fixed-key')
        throw Object.assign(new Error('timeout'), { uncertainWrite: true })
      },
    })
    const result = await startBachsAccountOnboarding(testInput.value)
    assertEquals(result, { state: 'UNCERTAIN', claimId: 'claim-1' })
    assertEquals(testInput.events, ['create:fixed-key'])
    assertEquals(fake.calls, ['reserve_bachs_account_setup'])
  }
)
