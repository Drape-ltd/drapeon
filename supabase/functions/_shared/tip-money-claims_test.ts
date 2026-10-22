import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { recordTipMoneyOperationOutcome, reserveTipMoneyOperation } from './tip-money-claims.ts'

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
