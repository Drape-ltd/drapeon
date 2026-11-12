import { syncStripePayoutDestination } from './stripe-payout-destination.ts'
import type { StripeConnectAccount } from './stripe.ts'

const account: StripeConnectAccount = {
  id: 'acct_sandbox_123',
  country: 'US',
  charges_enabled: false,
  payouts_enabled: true,
  capabilities: { transfers: 'active' },
  requirements: { currently_due: [], past_due: [], disabled_reason: null },
  external_accounts: { data: [{ id: 'ba_test' }] },
}

function fakeSupabase(
  options: {
    routes?: Array<{ fees_collector: string }>
    existing?: Record<string, unknown> | null
    routeError?: { code?: string; message?: string } | null
    destinationError?: { code?: string; message?: string } | null
  } = {}
) {
  const writes: Array<{ table: string; operation: string; value: unknown }> = []
  const routes = options.routes ?? [{ fees_collector: 'PLATFORM' }]
  const result = (data: unknown) => ({ data, error: null })
  const supabase = {
    from(table: string) {
      let operation = 'select'
      let value: unknown = null
      const builder: any = {
        select() {
          return builder
        },
        eq() {
          return builder
        },
        maybeSingle() {
          return Promise.resolve({
            data: table === 'payment_routes' ? routes : (options.existing ?? null),
            error: table === 'payout_destinations' ? (options.destinationError ?? null) : null,
          })
        },
        insert(row: unknown) {
          operation = 'insert'
          value = row
          return builder
        },
        update(row: unknown) {
          operation = 'update'
          value = row
          return builder
        },
        single() {
          writes.push({ table, operation, value })
          return Promise.resolve(result({ id: 'destination-new' }))
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          const data = table === 'payment_routes' ? routes : (options.existing ?? null)
          if (operation === 'update') writes.push({ table, operation, value })
          const error = table === 'payment_routes' ? (options.routeError ?? null) : null
          return Promise.resolve({ data, error }).then(resolve, reject)
        },
      }
      return builder
    },
  }
  return { supabase, writes }
}

Deno.test(
  'Stripe destination persists only after a route supplies one immutable fee policy',
  async () => {
    const { supabase, writes } = fakeSupabase()
    const result = await syncStripePayoutDestination(supabase, {
      tailorProfileId: 'tailor-test-1',
      payoutCurrency: 'USD',
      account,
      checkedAt: '2026-10-26T12:00:00.000Z',
    })
    if (!result.persisted || result.active || result.destinationId !== 'destination-new') {
      throw new Error('A new destination should persist inactive pending first-withdrawal review.')
    }
    const write = writes[0]?.value as Record<string, unknown>
    if (
      write.fees_collector !== 'PLATFORM' ||
      write.first_withdrawal_review_status !== 'PENDING' ||
      write.transfers_enabled !== true ||
      write.payouts_enabled !== true ||
      write.active !== false ||
      write.provider_requirements_currently_due_count !== 0 ||
      write.provider_requirements_past_due_count !== 0 ||
      write.provider_external_account_present !== true
    ) {
      throw new Error(
        'The destination did not preserve the route fee policy and fail-closed review defaults.'
      )
    }
  }
)

Deno.test(
  'Stripe destination refresh preserves first-withdrawal review and immutable identity',
  async () => {
    const { supabase, writes } = fakeSupabase({
      existing: {
        id: 'destination-existing',
        tailor_profile_id: 'tailor-test-1',
        legal_entity: 'O4_GROUP_LLC',
        country_code: 'US',
        currency: 'USD',
        fees_collector: 'PLATFORM',
        first_withdrawal_review_status: 'PENDING',
      },
    })
    const result = await syncStripePayoutDestination(supabase, {
      tailorProfileId: 'tailor-test-1',
      payoutCurrency: 'USD',
      account,
      checkedAt: '2026-10-26T12:00:00.000Z',
    })
    if (!result.persisted || result.active || writes[0]?.operation !== 'update') {
      throw new Error('A refreshed but unreviewed destination must stay inactive.')
    }
    const patch = writes[0].value as Record<string, unknown>
    if (
      'first_withdrawal_review_status' in patch &&
      patch.first_withdrawal_review_status !== 'PENDING'
    ) {
      throw new Error('Capability refresh must not clear a pending first-withdrawal review.')
    }
    if ('provider_account_ref' in patch || 'currency' in patch || 'country_code' in patch) {
      throw new Error('Capability refresh must not update immutable destination identity.')
    }
  }
)

Deno.test('Stripe destination stores fail-closed provider requirement evidence', async () => {
  const { supabase, writes } = fakeSupabase()
  await syncStripePayoutDestination(supabase, {
    tailorProfileId: 'tailor-test-1',
    payoutCurrency: 'USD',
    account: {
      ...account,
      requirements: {
        currently_due: ['individual.verification.document'],
        past_due: ['external_account'],
        disabled_reason: 'requirements.past_due',
      },
      external_accounts: { data: [] },
    },
    checkedAt: '2026-10-26T12:00:00.000Z',
  })
  const write = writes[0]?.value as Record<string, unknown>
  if (
    write.provider_requirements_currently_due_count !== 1 ||
    write.provider_requirements_past_due_count !== 1 ||
    write.provider_disabled_reason !== 'requirements.past_due' ||
    write.provider_external_account_present !== false
  ) {
    throw new Error('Stripe requirement and external-account evidence was not stored fail closed.')
  }
})

Deno.test(
  'Stripe destination activates only after review is cleared and capabilities are current',
  async () => {
    const { supabase, writes } = fakeSupabase({
      existing: {
        id: 'destination-existing',
        tailor_profile_id: 'tailor-test-1',
        legal_entity: 'O4_GROUP_LLC',
        country_code: 'US',
        currency: 'USD',
        fees_collector: 'PLATFORM',
        first_withdrawal_review_status: 'CLEARED',
      },
    })
    const result = await syncStripePayoutDestination(supabase, {
      tailorProfileId: 'tailor-test-1',
      payoutCurrency: 'USD',
      account,
      checkedAt: '2026-10-26T12:00:00.000Z',
    })
    const patch = writes[0]?.value as Record<string, unknown>
    if (!result.persisted || !result.active || patch.active !== true) {
      throw new Error(
        'A reviewed destination with current transfer and payout capabilities should be active.'
      )
    }
  }
)

Deno.test(
  'Stripe destination deactivates immediately when transfer capability is lost',
  async () => {
    const { supabase, writes } = fakeSupabase({
      existing: {
        id: 'destination-existing',
        tailor_profile_id: 'tailor-test-1',
        legal_entity: 'O4_GROUP_LLC',
        country_code: 'US',
        currency: 'USD',
        fees_collector: 'PLATFORM',
        first_withdrawal_review_status: 'CLEARED',
      },
    })
    const result = await syncStripePayoutDestination(supabase, {
      tailorProfileId: 'tailor-test-1',
      payoutCurrency: 'USD',
      account: { ...account, capabilities: { transfers: 'pending' } },
      checkedAt: '2026-10-26T12:00:00.000Z',
    })
    const patch = writes[0]?.value as Record<string, unknown>
    if (!result.persisted) throw new Error('A configured destination should be refreshed.')
    if (result.active || patch.active !== false || patch.transfers_enabled !== false) {
      throw new Error('A lost transfer capability must deactivate the destination on refresh.')
    }
  }
)

Deno.test('Stripe destination does not invent a fee policy when route rows conflict', async () => {
  const { supabase, writes } = fakeSupabase({
    routes: [{ fees_collector: 'PLATFORM' }, { fees_collector: 'CONNECTED_ACCOUNT' }],
  })
  const result = await syncStripePayoutDestination(supabase, {
    tailorProfileId: 'tailor-test-1',
    payoutCurrency: 'USD',
    account,
    checkedAt: '2026-10-26T12:00:00.000Z',
  })
  if (result.persisted || result.reason !== 'AMBIGUOUS_ROUTE_FEE_POLICY' || writes.length !== 0) {
    throw new Error('Conflicting fee policy must fail closed without writing a destination.')
  }
})

Deno.test('Stripe destination identity conflicts are rejected rather than rewritten', async () => {
  const { supabase, writes } = fakeSupabase({
    existing: {
      id: 'destination-existing',
      tailor_profile_id: 'another-tailor',
      legal_entity: 'O4_GROUP_LLC',
      country_code: 'US',
      currency: 'USD',
      fees_collector: 'PLATFORM',
      first_withdrawal_review_status: 'PENDING',
    },
  })
  let rejected = false
  try {
    await syncStripePayoutDestination(supabase, {
      tailorProfileId: 'tailor-test-1',
      payoutCurrency: 'USD',
      account,
      checkedAt: '2026-10-26T12:00:00.000Z',
    })
  } catch (error) {
    rejected = error instanceof Error && error.message === 'STRIPE_DESTINATION_IDENTITY_CONFLICT'
  }
  if (!rejected || writes.length !== 0) {
    throw new Error('An account reference cannot move between tailor identities.')
  }
})

Deno.test(
  'Stripe payout refresh remains compatible before Phase 2 schema is installed',
  async () => {
    const { supabase, writes } = fakeSupabase({
      routeError: {
        code: '42P01',
        message: 'relation "public.payment_routes" does not exist',
      },
    })
    const result = await syncStripePayoutDestination(supabase, {
      tailorProfileId: 'tailor-test-1',
      payoutCurrency: 'USD',
      account,
      checkedAt: '2026-10-26T12:00:00.000Z',
    })
    if (
      result.persisted ||
      result.reason !== 'PHASE_TWO_SCHEMA_UNAVAILABLE' ||
      writes.length !== 0
    ) {
      throw new Error('A code-first rollout must skip neutral writes until its tables exist.')
    }
  }
)
