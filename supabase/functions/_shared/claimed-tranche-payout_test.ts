import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { finalizeClaimedBachsTranche, reserveSettlementTranchePayout } from './claimed-tranche-payout.ts'

const input = {
  trancheId: 'tranche-1',
  tailorProfileId: 'profile-1',
  moneyDeskRequestId: 'request-1',
  provider: 'BACHS' as const,
  providerDestinationId: 'acct_test_1',
  routeVersion: '7',
  tailorTermsVersion: 'terms-v2',
}

function rpcDb(data: Record<string, unknown> | null, error: { message: string } | null = null) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  return {
    calls,
    db: {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args })
        return { data, error }
      },
    },
  }
}

Deno.test('tranche reservation uses stable tranche operation key and keeps source-change signal', async () => {
  const h = rpcDb({
    outcome: 'EXISTING', claim_id: 'claim-1', payout_id: 'payout-1', status: 'PROVIDER_PENDING',
    provider_idempotency_key: 'tranche:tranche-1:op:1', provider_transfer_id: 'tr_123',
    source_payment_changed: true,
  })
  const result = await reserveSettlementTranchePayout(h.db as never, input)
  assertEquals(result, {
    outcome: 'EXISTING', claim_id: 'claim-1', payout_id: 'payout-1', status: 'PROVIDER_PENDING',
    provider_idempotency_key: 'tranche:tranche-1:op:1', provider_transfer_id: 'tr_123',
    source_payment_changed: true,
  })
  assertEquals(h.calls[0]?.name, 'reserve_settlement_tranche_payout_row')
  assertEquals(h.calls[0]?.args.p_provider, 'BACHS')
  assertEquals(h.calls[0]?.args.p_route_version, '7')
})

Deno.test('tranche reservation rejects missing claim identity and mismatched provider key', async () => {
  await assertRejects(() => reserveSettlementTranchePayout(rpcDb(null).db as never, input))
  await assertRejects(() => reserveSettlementTranchePayout(rpcDb({
    outcome: 'RESERVED', claim_id: 'claim-1', payout_id: 'payout-1', status: 'RESERVED',
    provider_idempotency_key: 'wrong-key', source_payment_changed: false,
  }).db as never, input))
})

Deno.test('Bachs tranche finalization validates durable receipt identity', async () => {
  const h = rpcDb({ outcome: 'COMPLETED', tranche_id: 'tranche-1', payout_id: 'payout-1',
    ledger_id: 'ledger-1', provider_transfer_id: 'tr_123', review_needed: false })
  const result = await finalizeClaimedBachsTranche(h.db as never, {
    claimId: 'claim-1', payoutId: 'payout-1', transferId: 'tr_123',
  })
  assertEquals(result.outcome, 'COMPLETED')
  assertEquals(h.calls[0]?.name, 'finalize_claimed_bachs_tranche_release')
  await assertRejects(() => finalizeClaimedBachsTranche(rpcDb({
    outcome: 'COMPLETED', tranche_id: 'tranche-1', payout_id: 'another-payout',
    ledger_id: 'ledger-1', provider_transfer_id: 'tr_123',
  }).db as never, { claimId: 'claim-1', payoutId: 'payout-1', transferId: 'tr_123' }))
})
