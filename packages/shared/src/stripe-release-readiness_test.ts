import { assertEquals, assertRejects } from 'jsr:@std/assert'
import { refreshPinnedStripeDestinationForRelease } from './stripe-release-readiness.ts'

const checkedAt = '2026-11-10T02:45:00.000Z'

function fakeClient(input: { provider?: string; active?: boolean; checkedAt?: string } = {}) {
  const calls: string[] = []
  const rows: Record<string, Record<string, unknown>> = {
    orders: {
      id_text: 'order-1', accepted_route_snapshot_at: checkedAt,
      charge_provider_snapshot: input.provider ?? 'STRIPE', payout_destination_id: 'destination-1',
    },
    payout_destinations: {
      id: 'destination-1', active: input.active ?? true, transfers_enabled: true,
      payouts_enabled: true, first_withdrawal_review_status: 'CLEARED',
      capability_checked_at: input.checkedAt ?? checkedAt,
    },
    money_desk_execution_attempts: { id: 'attempt-1' },
  }
  const client = {
    from(table: string) {
      calls.push(`table:${table}`)
      return {
        select() { return this },
        update(value: Record<string, unknown>) {
          calls.push(`record:${value.provider_readiness_checked_at}`)
          return this
        },
        eq() { return this },
        async maybeSingle() { return { data: rows[table], error: null } },
      }
    },
  }
  return { client, calls, rows }
}

function input(client: unknown, fetchImpl: typeof fetch) {
  return {
    client, orderId: 'order-1', attemptId: 'attempt-1',
    supabaseUrl: 'https://dev.supabase.co', serviceRoleKey: 'test-only-service-key',
    now: () => new Date('2026-11-10T02:46:00.000Z'), fetchImpl,
  }
}

Deno.test('stale pinned Stripe destination is refreshed and recorded before the claim', async () => {
  const { client, calls, rows } = fakeClient({ checkedAt: '2026-11-02T07:35:39.258Z' })
  const result = await refreshPinnedStripeDestinationForRelease(input(client, async (url, init) => {
    const requestInit = init as globalThis.RequestInit
    calls.push('provider-refresh')
    assertEquals(String(url), 'https://dev.supabase.co/functions/v1/payout-account-action')
    assertEquals(JSON.parse(String(requestInit.body)), {
      action: 'ops-refresh-stripe-destination', destinationId: 'destination-1',
    })
    assertEquals((requestInit.headers as Record<string, string>)['X-Drape-Service-Key'], 'test-only-service-key')
    rows.payout_destinations.capability_checked_at = checkedAt
    return new Response(JSON.stringify({ ok: true, destinationId: 'destination-1', checkedAt }))
  }))
  assertEquals(result, { checkedAt })
  assertEquals(calls, [
    'table:orders', 'provider-refresh', 'table:payout_destinations',
    'table:money_desk_execution_attempts', `record:${checkedAt}`,
  ])
})

Deno.test('provider refresh network failure fails closed before recording or release', async () => {
  const { client, calls } = fakeClient()
  await assertRejects(
    () => refreshPinnedStripeDestinationForRelease(input(client, async () => { throw new Error('DNS error') })),
    Error, 'PAYOUT_RELEASE_STRIPE_REFRESH_NETWORK_ERROR',
  )
  assertEquals(calls, ['table:orders'])
})

Deno.test('disabled Stripe capability fails closed after refresh', async () => {
  const { client, calls } = fakeClient({ active: false })
  await assertRejects(
    () => refreshPinnedStripeDestinationForRelease(input(client, async () =>
      new Response(JSON.stringify({ ok: true, destinationId: 'destination-1', checkedAt })))),
    Error, 'PAYOUT_RELEASE_STRIPE_CAPABILITY_DISABLED',
  )
  assertEquals(calls, ['table:orders', 'table:payout_destinations'])
})

Deno.test('Bachs route is left to its existing readiness gate', async () => {
  const { client, calls } = fakeClient({ provider: 'BACHS' })
  const result = await refreshPinnedStripeDestinationForRelease(input(client, async () => {
    throw new Error('Bachs must not call Stripe')
  }))
  assertEquals(result, { checkedAt: null })
  assertEquals(calls, ['table:orders'])
})
