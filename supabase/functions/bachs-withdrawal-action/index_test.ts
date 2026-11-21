import { assertEquals, assertRejects } from 'jsr:@std/assert@1'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { createBachsClient, getBachsSandboxPayoutsClient } from '../_shared/bachs.ts'

// Import the real state machine without opening an HTTP listener.
const originalServe = Deno.serve
Deno.serve = (() => ({ shutdown() {}, finished: Promise.resolve() })) as unknown as typeof Deno.serve
const { advance } = await import('./index.ts')
Deno.serve = originalServe
type Claim = Parameters<typeof advance>[1]

function fixture() {
  const claim: Claim = {
    id: '9f6e2e08-b957-4719-94f4-9df0a377a821',
    request_key: 'withdrawal-test-request',
    payout_destination_id: 'd516104c-69a4-4ca1-9d9a-94988a945bf2',
    provider_account_id: 'acct_test_withdrawal',
    provider_bank_destination_id: 'pd_test_bank',
    currency: 'NGN', withdrawal_amount_minor: 30_000,
    reserve_amount_minor: 10_000, status: 'RESERVED',
    topup_transfer_id: null, payout_id: null, sweep_transfer_id: null,
    actual_fee_minor: null, fee_ledger_transaction_id: null,
  }
  let stored = { ...claim }
  let failReceiptOnce = false
  let connectedMinor = 30_000
  let platformMinor = 100_000
  const posts = { topup: 0, payout: 0, sweep: 0, ledger: 0 }
  const transfer = (phase: 'topup' | 'sweep') => ({
    id: phase === 'topup' ? 'tr_test_topup' : 'tr_test_sweep',
    destination: phase === 'topup' ? claim.provider_account_id : 'self',
    amount: phase === 'topup' ? '100.00' : '50.00', currency: 'NGN', status: 'paid',
    transfer_group: `withdrawal:${claim.id}`,
    metadata: { withdrawal_claim_id: claim.id, withdrawal_phase: phase },
  })
  const payout = (status: 'pending' | 'completed') => ({
    id: 'pay_test_withdrawal', status, amount: '300.00', currency: 'NGN',
    destination: claim.provider_bank_destination_id,
    reference: `withdrawal-${claim.id}`,
    source_currency: 'NGN',
    fee: status === 'completed' ? '50.00' : null,
    total_debited: status === 'completed' ? '350.00' : null,
  })
  const platform = {
    async request<T>(input: { method: string; path: string; body?: Record<string, unknown> }) {
      if (input.path === '/v1/balances') return {
        account_id: 'platform', balances: [{ currency: 'NGN', available_balance: `${platformMinor / 100}.00`, pending_balance: '0.00' }],
      } as T
      if (input.path.startsWith('/v1/transfers?')) {
        const items = [transfer('topup'), transfer('sweep')].filter((item) =>
          item.id === 'tr_test_topup' ? posts.topup > 0 : posts.sweep > 0)
        return { items, total: items.length, limit: 100, offset: 0 } as T
      }
      if (input.path === '/v1/transfers/tr_test_topup') return transfer('topup') as T
      if (input.path === '/v1/transfers/tr_test_sweep') return transfer('sweep') as T
      if (input.method === 'POST' && input.path === '/v1/transfers') {
        const phase = input.body?.destination === 'self' ? 'sweep' : 'topup'
        posts[phase]++
        if (phase === 'topup') { platformMinor -= 10_000; connectedMinor += 10_000 }
        else { connectedMinor -= 5_000; platformMinor += 5_000 }
        return transfer(phase) as T
      }
      throw new Error(`Unexpected platform operation: ${input.method} ${input.path}`)
    },
  } as ReturnType<typeof createBachsClient>
  const payoutProvider = {
    async request<T>(input: { method: string; path: string }) {
      if (input.path === '/v1/balances') return {
        account_id: claim.provider_account_id,
        balances: [{ currency: 'NGN', available_balance: `${connectedMinor / 100}.00`, pending_balance: '0.00' }],
      } as T
      if (input.path === '/v1/payouts/destinations/pd_test_bank') return {
        id: claim.provider_bank_destination_id, type: 'bank_account', currency: 'NGN', is_usable: true,
      } as T
      if (input.method === 'POST' && input.path === '/v1/payouts') {
        posts.payout++
        connectedMinor -= 35_000
        return payout('pending') as T
      }
      if (input.path === '/v1/payouts/pay_test_withdrawal') return payout('completed') as T
      if (input.path.startsWith('/v1/payouts?')) return {
        items: posts.payout ? [payout('completed')] : [], total: posts.payout ? 1 : 0,
        limit: 100, offset: 0,
      } as T
      throw new Error(`Unexpected payout operation: ${input.method} ${input.path}`)
    },
  } as ReturnType<typeof getBachsSandboxPayoutsClient>
  const db = {
    from(table: string) {
      if (table !== 'bachs_withdrawal_fee_claims') throw new Error(`Unexpected table: ${table}`)
      const query = {
        patch: null as Record<string, unknown> | null,
        filters: {} as Record<string, unknown>,
        update(patch: Record<string, unknown>) { this.patch = patch; return this },
        select() { return this },
        eq(name: string, value: unknown) { this.filters[name] = value; return this },
        async maybeSingle() {
          if (this.filters.id !== stored.id ||
            (this.filters.status && this.filters.status !== stored.status)) return { data: null, error: null }
          if (this.patch) {
            if (failReceiptOnce && ('topup_transfer_id' in this.patch)) {
              failReceiptOnce = false
              return { data: null, error: { message: 'synthetic receipt commit failure' } }
            }
            stored = { ...stored, ...this.patch } as Claim
          }
          return { data: { ...stored }, error: null }
        },
      }
      return query
    },
    async rpc(name: string) {
      assertEquals(name, 'post_commercial_ledger_transaction')
      posts.ledger++
      return { data: '1a59e679-7ab4-4831-b07a-f74ffb357643', error: null }
    },
  } as unknown as SupabaseClient
  return {
    db, clients: { platform, payoutProvider }, posts,
    read: () => ({ ...stored }),
    failNextReceipt: () => { failReceiptOnce = true },
  }
}

Deno.test('withdrawal reserve, payout, fee ledger and sweep replay without duplicate provider writes', async () => {
  const f = fixture()
  for (let step = 0; step < 8; step++) await advance(f.db, f.read(), f.clients)
  assertEquals(f.read().status, 'COMPLETE')
  assertEquals(f.read().actual_fee_minor, 5_000)
  assertEquals(f.posts, { topup: 1, payout: 1, sweep: 1, ledger: 1 })
  await advance(f.db, f.read(), f.clients)
  assertEquals(f.posts, { topup: 1, payout: 1, sweep: 1, ledger: 1 })
})

Deno.test('receipt commit failure recovers by lookup, without repeating the reserve transfer', async () => {
  const f = fixture()
  f.failNextReceipt()
  await assertRejects(() => advance(f.db, f.read(), f.clients))
  assertEquals(f.read().status, 'TOPUP_SUBMITTED')
  assertEquals(f.posts.topup, 1)
  await advance(f.db, f.read(), f.clients)
  assertEquals(f.read().status, 'TOPUP_PAID')
  assertEquals(f.read().topup_transfer_id, 'tr_test_topup')
  assertEquals(f.posts.topup, 1)
})

Deno.test('concurrent advances reserve one provider write', async () => {
  const f = fixture()
  const stale = f.read()
  await Promise.all([advance(f.db, stale, f.clients), advance(f.db, stale, f.clients)])
  assertEquals(f.posts.topup, 1)
})
