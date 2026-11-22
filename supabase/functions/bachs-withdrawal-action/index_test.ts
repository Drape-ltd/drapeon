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
  let providerPayoutStatus: 'pending' | 'completed' = 'completed'
  let providerFee = '50.00'
  let feeDebitedFromConnectedBalance = true
  const posts = { topup: 0, payout: 0, sweep: 0, ledger: 0 }
  const balanceReads = { platform: 0, connected: 0 }
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
    fee: status === 'completed' ? providerFee : null,
    total_debited: status === 'completed' ? `${300 + Number(providerFee)}.00` : null,
  })
  const platform = {
    async request<T>(input: { method: string; path: string; body?: Record<string, unknown>; accountId?: string }) {
      if (input.path === '/v1/balances') {
        if (input.accountId && input.accountId !== claim.provider_account_id) throw new Error('Unexpected connected account')
        const connected = input.accountId === claim.provider_account_id
        balanceReads[connected ? 'connected' : 'platform']++
        return {
          account_id: connected ? claim.provider_account_id : 'platform',
          balances: [{ currency: 'NGN', available_balance: `${(connected ? connectedMinor : platformMinor) / 100}.00`, pending_balance: '0.00' }],
        } as T
      }
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
      if (input.path === '/v1/balances') throw new Error('Payout-only credential cannot read balances')
      if (input.path === '/v1/payouts/destinations/pd_test_bank') return {
        id: claim.provider_bank_destination_id, type: 'bank_account', currency: 'NGN', is_usable: true,
      } as T
      if (input.method === 'POST' && input.path === '/v1/payouts') {
        posts.payout++
        connectedMinor -= feeDebitedFromConnectedBalance ? 35_000 : 30_000
        return payout('pending') as T
      }
      if (input.path === '/v1/payouts/pay_test_withdrawal') return payout(providerPayoutStatus) as T
      if (input.path.startsWith('/v1/payouts?')) return {
        items: posts.payout ? [payout(providerPayoutStatus)] : [], total: posts.payout ? 1 : 0,
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
    db, clients: { platform, payoutProvider }, posts, balanceReads,
    read: () => ({ ...stored }),
    failNextReceipt: () => { failReceiptOnce = true },
    setProviderPayout: (status: 'pending' | 'completed', fee = '50.00') => {
      providerPayoutStatus = status
      providerFee = fee
    },
    setFeeDebitedFromConnectedBalance: (value: boolean) => {
      feeDebitedFromConnectedBalance = value
    },
  }
}

Deno.test('simulated fee-debited balance transitions RESERVED through COMPLETE and replay is idempotent', async () => {
  const f = fixture()
  const states = [f.read().status]
  for (let step = 0; step < 7; step++) {
    await advance(f.db, f.read(), f.clients)
    states.push(f.read().status)
  }
  assertEquals(states, [
    'RESERVED',
    'TOPUP_SUBMITTED',
    'TOPUP_PAID',
    'PAYOUT_SUBMITTED',
    'FEE_PENDING',
    'FEE_RECORDED',
    'SWEEP_SUBMITTED',
    'COMPLETE',
  ])
  assertEquals(f.read().status, 'COMPLETE')
  assertEquals(f.read().actual_fee_minor, 5_000)
  assertEquals(f.posts, { topup: 1, payout: 1, sweep: 1, ledger: 1 })
  assertEquals(f.balanceReads.platform > 0, true)
  assertEquals(f.balanceReads.connected > 0, true)
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

Deno.test('a first payout can remain pending without a duplicate or premature sweep', async () => {
  const f = fixture()
  f.setProviderPayout('pending')
  for (let step = 0; step < 4; step++) await advance(f.db, f.read(), f.clients)
  assertEquals(f.read().status, 'FEE_PENDING')
  await advance(f.db, f.read(), f.clients)
  assertEquals(f.read().status, 'FEE_PENDING')
  assertEquals(f.posts, { topup: 1, payout: 1, sweep: 0, ledger: 0 })
  f.setProviderPayout('completed')
  for (let step = 0; step < 3; step++) await advance(f.db, f.read(), f.clients)
  assertEquals(f.read().status, 'COMPLETE')
  assertEquals(f.posts.sweep, 1)
})

Deno.test('a fee above the reserve enters review without sweeping', async () => {
  const f = fixture()
  f.setProviderPayout('completed', '150.00')
  for (let step = 0; step < 5; step++) await advance(f.db, f.read(), f.clients)
  assertEquals(f.read().status, 'REVIEW')
  assertEquals(f.posts, { topup: 1, payout: 1, sweep: 0, ledger: 0 })
})

Deno.test('simulated fee-missing balance ends in REVIEW before ledger or sweep', async () => {
  const f = fixture()
  f.setFeeDebitedFromConnectedBalance(false)
  const states = [f.read().status]
  for (let step = 0; step < 5; step++) {
    await advance(f.db, f.read(), f.clients)
    states.push(f.read().status)
  }
  assertEquals(states, [
    'RESERVED',
    'TOPUP_SUBMITTED',
    'TOPUP_PAID',
    'PAYOUT_SUBMITTED',
    'FEE_PENDING',
    'REVIEW',
  ])
  assertEquals(f.read().status, 'REVIEW')
  assertEquals(f.read().actual_fee_minor, null)
  assertEquals(f.posts, { topup: 1, payout: 1, sweep: 0, ledger: 0 })
})
