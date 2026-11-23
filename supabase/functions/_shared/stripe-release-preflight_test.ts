import { assertEquals, assertRejects } from 'jsr:@std/assert'
import { withStripeReleasePreflight } from './stripe-release-preflight.ts'

function fixture(input: { checkedAt?: string; active?: boolean; transfers?: boolean; payouts?: boolean } = {}) {
  const calls: string[] = []
  const destination = {
    id: 'destination-1', active: input.active ?? true,
    transfers_enabled: input.transfers ?? true, payouts_enabled: input.payouts ?? true,
    first_withdrawal_review_status: 'CLEARED',
    capability_checked_at: input.checkedAt ?? '2026-11-10T03:00:00Z',
  }
  const rows: Record<string, Record<string, unknown>> = {
    orders: { accepted_route_snapshot_at: '2026-11-01T00:00:00Z', charge_provider_snapshot: 'STRIPE', payout_destination_id: 'destination-1' },
    payout_destinations: destination,
  }
  const client = { from(table: string) { calls.push(table); return {
    select() { return this }, eq() { return this },
    async maybeSingle() { return { data: rows[table], error: null } },
  } } }
  const base = {
    client, provider: 'STRIPE' as const, orderId: 'order-1', destinationId: 'destination-1',
    supabaseUrl: 'https://dev.supabase.co', serviceRoleKey: 'test-service-key',
    now: () => new Date('2026-11-10T03:01:00Z'),
    claim: async () => { calls.push('claim'); return 'CLAIMED' },
  }
  return { base, calls, destination }
}

Deno.test('stale Stripe destination refreshes before the release claim', async () => {
  const { base, calls, destination } = fixture({ checkedAt: '2026-11-01T00:00:00Z' })
  const result = await withStripeReleasePreflight({ ...base, fetchImpl: async () => {
    calls.push('refresh'); destination.capability_checked_at = '2026-11-10T03:00:00Z'
    return new Response(JSON.stringify({ ok: true, destinationId: 'destination-1' }))
  } })
  assertEquals(result, 'CLAIMED')
  assertEquals(calls, ['orders', 'refresh', 'payout_destinations', 'claim'])
})

Deno.test('refresh network failure leaves the claim untouched', async () => {
  const { base, calls } = fixture()
  await assertRejects(() => withStripeReleasePreflight({ ...base, fetchImpl: async () => { throw new Error('offline') } }), Error, 'PAYOUT_RELEASE_STRIPE_REFRESH_NETWORK_ERROR')
  assertEquals(calls, ['orders'])
})

Deno.test('disabled Stripe capability leaves the claim untouched', async () => {
  const { base, calls } = fixture({ transfers: false })
  await assertRejects(() => withStripeReleasePreflight({ ...base, fetchImpl: async () => new Response(JSON.stringify({ ok: true, destinationId: 'destination-1' })) }), Error, 'PAYOUT_RELEASE_STRIPE_CAPABILITY_DISABLED')
  assertEquals(calls, ['orders', 'payout_destinations'])
})

Deno.test('a mismatched pinned destination leaves the claim untouched', async () => {
  const { base, calls } = fixture()
  await assertRejects(() => withStripeReleasePreflight({ ...base, destinationId: 'different', fetchImpl: async () => { throw new Error('must not call') } }), Error, 'PAYOUT_RELEASE_PINNED_DESTINATION_MISMATCH')
  assertEquals(calls, ['orders'])
})

Deno.test('Bachs uses its own release gate', async () => {
  const { base, calls } = fixture()
  assertEquals(await withStripeReleasePreflight({ ...base, provider: 'BACHS', fetchImpl: async () => { throw new Error('must not call') } }), 'CLAIMED')
  assertEquals(calls, ['claim'])
})
