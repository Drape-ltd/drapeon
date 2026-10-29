import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { ProviderAdapter } from './claimed-payout-execution.ts'
import { executeClaimedTipTransfer } from './tip-payout-execution.ts'

const db = {} as SupabaseClient

function provider(input: {
  send?: ProviderAdapter['send']
  lookup?: ProviderAdapter['lookup']
  verify?: ProviderAdapter['verify']
} = {}): ProviderAdapter {
  return {
    send: input.send ?? (async () => ({ kind: 'CONFIRMED', transferId: 'tr_1', evidence: { status: 'paid' } })),
    lookup: input.lookup ?? (async () => ({ kind: 'CONFIRMED', transferId: 'tr_1', evidence: { status: 'paid' } })),
    verify: input.verify ?? (() => {}),
  }
}

function deps(status?: string, action: 'SEND' | 'RECONCILE' = 'SEND') {
  const calls: Array<{ type: string; value?: unknown }> = []
  return {
    calls,
    start: async () => ({
      action,
      claim_id: 'claim-1',
      payout_id: 'payout-1',
      provider: 'BACHS',
      provider_operation_id: status === 'PROVIDER_PENDING' ? 'tr_1' : null,
      ...(status ? { status } : {}),
    }),
    record: async (_db: SupabaseClient, input: unknown) => {
      calls.push({ type: 'record', value: input })
      return 'RECORDED' as const
    },
    blockIdentityConflict: async (_db: SupabaseClient, input: unknown) => {
      calls.push({ type: 'block', value: input })
    },
  }
}

Deno.test('a new TIP claim sends once, durably records success, then finalizes', async () => {
  const h = deps()
  let sends = 0
  const sequence: string[] = []
  const result = await executeClaimedTipTransfer({
    supabase: db,
    claimId: 'claim-1',
    requestKey: 'tip:tip-1:payout',
    providerName: 'BACHS',
    provider: provider({ send: async () => { sends++; return { kind: 'CONFIRMED', transferId: 'tr_1', evidence: { status: 'paid' } } } }),
    finalize: async () => { sequence.push('finalize') },
  }, h as never)
  assertEquals(result, { kind: 'CONFIRMED', transferId: 'tr_1', lateSuccess: false })
  assertEquals(sends, 1)
  assertEquals((h.calls[0]?.value as Record<string, unknown>)?.status, 'SUCCEEDED')
  assertEquals(sequence, ['finalize'])
})

Deno.test('re-entry reconciles by provider lookup and never sends a second transfer', async () => {
  const h = deps('PROVIDER_UNKNOWN', 'RECONCILE')
  let sends = 0
  let lookups = 0
  const result = await executeClaimedTipTransfer({
    supabase: db, claimId: 'claim-1', requestKey: 'tip:tip-1:payout', providerName: 'BACHS',
    provider: provider({
      send: async () => { sends++; return { kind: 'UNKNOWN', evidence: {} } },
      lookup: async () => { lookups++; return { kind: 'CONFIRMED', transferId: 'tr_1', evidence: { status: 'paid' } } },
    }),
    finalize: async () => {},
  }, h as never)
  assertEquals(result.kind, 'CONFIRMED')
  assertEquals({ sends, lookups }, { sends: 0, lookups: 1 })
})

Deno.test('pending transfer is recorded and later reconciled to paid', async () => {
  const h = deps()
  const first = await executeClaimedTipTransfer({
    supabase: db, claimId: 'claim-1', requestKey: 'tip:tip-1:payout', providerName: 'BACHS',
    provider: provider({ send: async () => ({ kind: 'PENDING', transferId: 'tr_1', evidence: { status: 'pending' } }) }),
    finalize: async () => { throw new Error('pending must not finalize') },
  }, h as never)
  assertEquals(first, { kind: 'PENDING', reason: 'PROVIDER_PENDING', transferId: 'tr_1' })
  assertEquals((h.calls[0]?.value as Record<string, unknown>)?.status, 'PROVIDER_PENDING')

  const retryDeps = deps('PROVIDER_PENDING', 'RECONCILE')
  const second = await executeClaimedTipTransfer({
    supabase: db, claimId: 'claim-1', requestKey: 'tip:tip-1:payout', providerName: 'BACHS',
    provider: provider({ lookup: async (_key, knownId) => ({
      kind: 'CONFIRMED', transferId: knownId ?? 'missing', evidence: { status: 'paid' },
    }) }),
    finalize: async () => {},
  }, retryDeps as never)
  assertEquals(second.kind, 'CONFIRMED')
})

Deno.test('a provider-confirmed late success after terminal failure is recorded and finalized', async () => {
  const h = deps('FAILED_RECONCILED', 'RECONCILE')
  const result = await executeClaimedTipTransfer({
    supabase: db, claimId: 'claim-1', requestKey: 'tip:tip-1:payout', providerName: 'BACHS',
    provider: provider({ lookup: async () => ({ kind: 'CONFIRMED', transferId: 'tr_1', evidence: { status: 'paid' } }) }),
    finalize: async () => {},
  }, h as never)
  assertEquals(result, { kind: 'CONFIRMED', transferId: 'tr_1', lateSuccess: true })
  assertEquals((h.calls[0]?.value as Record<string, unknown>)?.evidence &&
    ((h.calls[0]?.value as Record<string, unknown>).evidence as Record<string, unknown>).late_success_after_failure, true)
})

Deno.test('unknown lookup cannot downgrade a pending TIP claim', async () => {
  const h = deps('PROVIDER_PENDING', 'RECONCILE')
  const result = await executeClaimedTipTransfer({
    supabase: db, claimId: 'claim-1', requestKey: 'tip:tip-1:payout', providerName: 'BACHS',
    provider: provider({ lookup: async () => ({ kind: 'UNKNOWN', evidence: { timeout: true } }) }),
    finalize: async () => {},
  }, h as never)
  assertEquals(result, { kind: 'PENDING', reason: 'PROVIDER_UNKNOWN', transferId: 'tr_1' })
  assertEquals(h.calls, [])
})
