import {
  assertEquals,
  assertRejects,
} from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  closeUnstartedSettlementTranchePayout,
  preProviderAbortResult,
  preProviderFailureCode,
} from './unstarted-tranche-abort.ts'

Deno.test('pre-provider abort closes only the database-proven no-attempt result', async () => {
  let calls = 0
  const result = await closeUnstartedSettlementTranchePayout({
    rpc: async (name, args) => {
      calls += 1
      assertEquals(name, 'close_unstarted_settlement_tranche_payout')
      assertEquals(args, {
        p_claim_id: 'claim-1',
        p_failure_code: 'PRE_PROVIDER_ABORT',
      })
      return {
        data: {
          outcome: 'ABORTED',
          claim_id: 'claim-1',
          payout_id: 'payout-1',
          tranche_id: 'tranche-1',
        },
        error: null,
      }
    },
  }, { claimId: 'claim-1', failureCode: 'PRE_PROVIDER_ABORT' })

  assertEquals(calls, 1)
  assertEquals(preProviderAbortResult(result), {
    status: 409,
    body: {
      ok: false,
      code: 'PAYOUT_PRE_PROVIDER_ABORT',
      error:
        'Payout stopped before a provider transfer started. Ops review is required.',
    },
  })
})

Deno.test('an attempt or unknown DB state keeps the request on reconciliation path', async () => {
  const result = await closeUnstartedSettlementTranchePayout({
    rpc: async () => ({
      data: { outcome: 'NOT_SAFE', claim_id: 'claim-1' },
      error: null,
    }),
  }, { claimId: 'claim-1', failureCode: 'PRE_PROVIDER_ABORT' })
  assertEquals(result.outcome, 'NOT_SAFE')
  assertEquals(preProviderAbortResult(result), null)
})

Deno.test('database errors never produce a false terminal abort', async () => {
  await assertRejects(
    () =>
      closeUnstartedSettlementTranchePayout({
        rpc: async () => ({
          data: null,
          error: { message: 'database unavailable' },
        }),
      }, { claimId: 'claim-1', failureCode: 'PRE_PROVIDER_ABORT' }),
    Error,
    'database unavailable',
  )
})

Deno.test('only allowlisted pre-provider codes reach the terminal record', () => {
  assertEquals(
    preProviderFailureCode(
      new Error('PAYOUT_RELEASE_STRIPE_REFRESH_FAILED:capability_disabled'),
    ),
    'PAYOUT_RELEASE_STRIPE_REFRESH_FAILED',
  )
  assertEquals(
    preProviderFailureCode(new Error('STRIPE_SOURCE_CHARGE_MISSING')),
    'STRIPE_SOURCE_CHARGE_MISSING',
  )
  assertEquals(
    preProviderFailureCode(new Error('raw provider response secret')),
    'PRE_PROVIDER_ABORT',
  )
  assertEquals(
    preProviderFailureCode('PAYOUT_RELEASE_STRIPE_REFRESH_NETWORK_ERROR'),
    'PRE_PROVIDER_ABORT',
  )
})
