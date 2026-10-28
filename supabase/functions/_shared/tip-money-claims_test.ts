import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  bindTipPayoutClaim,
  recordTipMoneyOperationOutcome,
  reserveTipMoneyOperation,
  startTipMoneyOperationProviderCall,
} from './tip-money-claims.ts'

function fakeClient(result: unknown, error: { message: string } | null = null) {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = []
  const client = {
    rpc: async (name: string, input: Record<string, unknown>) => {
      calls.push({ name, input })
      return { data: result, error }
    },
  } as unknown as SupabaseClient
  return { client, calls }
}

Deno.test('tip payout reservation uses one stable business key', async () => {
  const { client, calls } = fakeClient({ outcome: 'RESERVED', claim_id: 'claim-1', status: 'RESERVED' })
  const result = await reserveTipMoneyOperation(client, { tipId: 'tip-1', kind: 'PAYOUT', key: 'tip:tip-1:payout' })
  assertEquals(result.claim_id, 'claim-1')
  assertEquals(calls, [{
    name: 'reserve_tip_money_operation',
    input: { p_tip_id: 'tip-1', p_operation_kind: 'PAYOUT', p_request_key: 'tip:tip-1:payout', p_money_desk_request_id: null },
  }])
})

Deno.test('tip claim refuses an unknown database outcome', async () => {
  const { client } = fakeClient({ outcome: 'CREATE_ANOTHER_PAYOUT' })
  await assertRejects(
    () => reserveTipMoneyOperation(client, { tipId: 'tip-1', kind: 'PAYOUT', key: 'tip:tip-1:payout' }),
    Error,
    'unknown outcome',
  )
})

Deno.test('tip claim cannot be treated as reserved without a durable ID', async () => {
  const { client } = fakeClient({ outcome: 'RESERVED' })
  await assertRejects(
    () => reserveTipMoneyOperation(client, { tipId: 'tip-1', kind: 'PAYOUT', key: 'tip:tip-1:payout' }),
    Error,
    'durable ID',
  )
})

Deno.test('provider-unknown result keeps the same claim and records evidence', async () => {
  const { client, calls } = fakeClient({ outcome: 'RECORDED', claim_id: 'claim-1', status: 'PROVIDER_UNKNOWN' })
  const result = await recordTipMoneyOperationOutcome(client, {
    claimId: 'claim-1', status: 'PROVIDER_UNKNOWN', provider: 'BACHS',
    evidence: { network_error: 'timeout' },
  })
  assertEquals(result, 'RECORDED')
  assertEquals(calls[0].input.p_claim_id, 'claim-1')
  assertEquals(calls[0].input.p_provider, 'BACHS')
  assertEquals(calls[0].input.p_provider_operation_id, null)
})

Deno.test('recording a mismatched claim outcome fails closed', async () => {
  const { client } = fakeClient({ outcome: 'EXISTING', status: 'FAILED_RECONCILED' })
  await assertRejects(
    () => recordTipMoneyOperationOutcome(client, {
      claimId: 'claim-1', status: 'SUCCEEDED', provider: 'STRIPE',
      providerOperationId: 'tr_1', evidence: { provider_status: 'paid' },
    }),
    Error,
    'not durably recorded',
  )
})

Deno.test('provider-confirmed success after reconciled failure is preserved as an Ops-worthy outcome', async () => {
  const { client, calls } = fakeClient({
    outcome: 'LATE_SUCCESS', status: 'SUCCEEDED', claim_id: 'claim-1',
  })
  const result = await recordTipMoneyOperationOutcome(client, {
    claimId: 'claim-1', status: 'SUCCEEDED', provider: 'STRIPE',
    providerOperationId: 'tr_exact',
    evidence: { late_success_after_failure: true, provider_status: 'paid' },
  })
  assertEquals(result, 'LATE_SUCCESS')
  assertEquals(calls[0]?.input.p_provider_operation_id, 'tr_exact')
})

Deno.test('tip payout row binding validates the claim and exact payout row', async () => {
  const { client, calls } = fakeClient({ outcome: 'BOUND', claim_id: 'claim-1', payout_id: 'payout-1' })
  const result = await bindTipPayoutClaim(client, {
    claimId: 'claim-1', payoutId: 'payout-1', provider: 'STRIPE', destinationId: 'acct_test',
  })
  assertEquals(result, 'BOUND')
  assertEquals(calls[0], {
    name: 'bind_tip_payout_claim',
    input: {
      p_claim_id: 'claim-1', p_payout_id: 'payout-1',
      p_provider: 'STRIPE', p_provider_destination_id: 'acct_test',
    },
  })
})

Deno.test('only the first tip worker receives SEND from the database start gate', async () => {
  const { client } = fakeClient({ outcome: 'SEND', claim_id: 'claim-1', payout_id: 'payout-1', provider: 'STRIPE' })
  const result = await startTipMoneyOperationProviderCall(client, 'claim-1')
  assertEquals(result.action, 'SEND')
  assertEquals(result.payout_id, 'payout-1')
})

Deno.test('an uncertain tip payout re-entry is reconcile-only', async () => {
  const { client } = fakeClient({
    outcome: 'RECONCILE', claim_id: 'claim-1', payout_id: 'payout-1',
    provider: 'STRIPE', provider_operation_id: 'tr_test', status: 'PROVIDER_UNKNOWN',
  })
  const result = await startTipMoneyOperationProviderCall(client, 'claim-1')
  assertEquals(result.action, 'RECONCILE')
  assertEquals(result.provider_operation_id, 'tr_test')
  assertEquals(result.status, 'PROVIDER_UNKNOWN')
})

Deno.test('tip operation start gate rejects a mismatched durable claim identity', async () => {
  const { client } = fakeClient({ outcome: 'SEND', claim_id: 'claim-other', payout_id: 'payout-1' })
  await assertRejects(
    () => startTipMoneyOperationProviderCall(client, 'claim-1'),
    Error,
    'invalid result',
  )
})
