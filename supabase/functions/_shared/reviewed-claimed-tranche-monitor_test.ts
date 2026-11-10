import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resumeReviewedClaimedTrancheAttempts } from './reviewed-claimed-tranche-monitor.ts'

const request = {
  id: 'request-one', target_id: 'claim-one', order_id: 'order-one',
  action_payload: { claimId: 'claim-one', trancheId: 'tranche-one' },
}

function harness(options: {
  claimStatus?: string
  actionPayload?: unknown
  invokeError?: boolean
  recordFailure?: boolean
  closeOutcome?: 'CLOSED_NO_OPERATION' | 'CLOSED_DEFINITE_REJECTION' |
    'ALREADY_TERMINAL' | 'PROVIDER_OPERATION_POSSIBLE'
} = {}) {
  const queried: string[] = []
  const invocations: Array<{ name: string; body: unknown; headers: unknown }> = []
  const issues: string[] = []
  const closeCalls: string[] = []
  const fake = {
    from(table: string) {
      queried.push(table)
      const query = {
        select() { return this },
        eq() { return this },
        order() { return this },
        limit() { return this },
        maybeSingle() {
          return Promise.resolve({ data: table === 'money_desk_execution_attempts'
            ? { id: 'attempt-one' }
            : { status: options.claimStatus ?? 'RESERVED',
              source_kind: 'SETTLEMENT_TRANCHE', source_id: 'tranche-one' }, error: null })
        },
        then(resolve: (value: unknown) => void) {
          resolve({ data: [{ ...request,
            action_payload: options.actionPayload ?? request.action_payload }], error: null })
        },
      }
      return query
    },
    functions: {
      async invoke(name: string, input: { body: unknown; headers: unknown }) {
        invocations.push({ name, body: input.body, headers: input.headers })
        return options.invokeError
          ? { data: null, error: new Error('network timeout') }
          : { data: { ok: true, pending: true }, error: null }
      },
    },
  } as unknown as SupabaseClient
  const deps = {
    serviceRoleKey: 'fixture-key',
    async recordFailure(value: { id: string }) {
      issues.push(value.id)
      return options.recordFailure !== false
    },
    async closeUnstarted(value: { id: string }) {
      closeCalls.push(value.id)
      return options.closeOutcome ?? 'PROVIDER_OPERATION_POSSIBLE'
    },
  }
  return { fake, deps, queried, invocations, issues, closeCalls }
}

Deno.test('monitor resumes a reserved reviewed claim through the same Edge request', async () => {
  const h = harness()
  assertEquals(await resumeReviewedClaimedTrancheAttempts(h.fake, h.deps),
    { checked: 1, pending: 1, errors: 0 })
  assertEquals(h.invocations, [{
    name: 'release-settlement-tranche',
    body: { trancheId: 'tranche-one', moneyDeskRequestId: 'request-one' },
    headers: { Authorization: 'Bearer fixture-key', apikey: 'fixture-key' },
  }])
  assertEquals(h.queried, [
    'money_desk_requests', 'money_desk_execution_attempts', 'payout_claims',
  ])
})

Deno.test('monitor reuses the same approved request after a lost Edge response', async () => {
  const first = harness({ claimStatus: 'PROVIDER_UNKNOWN', invokeError: true })
  assertEquals(await resumeReviewedClaimedTrancheAttempts(first.fake, first.deps),
    { checked: 1, pending: 0, errors: 1 })
  assertEquals(first.issues, ['request-one'])
  assertEquals(first.closeCalls, ['request-one'])
  const replay = harness({ claimStatus: 'PROVIDER_UNKNOWN' })
  assertEquals(await resumeReviewedClaimedTrancheAttempts(replay.fake, replay.deps),
    { checked: 1, pending: 1, errors: 0 })
  assertEquals(replay.invocations[0].body, first.invocations[0].body)
  assertEquals(replay.queried.includes('payout_provider_operations'), false)
})

Deno.test('definite pre-provider failure closes the original attempt without an Ops retry case', async () => {
  const h = harness({ invokeError: true, closeOutcome: 'CLOSED_NO_OPERATION' })
  assertEquals(await resumeReviewedClaimedTrancheAttempts(h.fake, h.deps),
    { checked: 1, pending: 0, errors: 1 })
  assertEquals(h.closeCalls, ['request-one'])
  assertEquals(h.issues, [])
})

Deno.test('definite provider rejection closes the reviewed attempt without another transfer', async () => {
  const h = harness({ claimStatus: 'FAILED_RECONCILED',
    closeOutcome: 'CLOSED_DEFINITE_REJECTION' })
  assertEquals(await resumeReviewedClaimedTrancheAttempts(h.fake, h.deps),
    { checked: 1, pending: 0, errors: 1 })
  assertEquals(h.closeCalls, ['request-one'])
  assertEquals(h.invocations, [])
  assertEquals(h.issues, [])
})

Deno.test('unproven terminal failure stays open for Ops review', async () => {
  const h = harness({ claimStatus: 'FAILED_RECONCILED',
    closeOutcome: 'PROVIDER_OPERATION_POSSIBLE' })
  assertEquals(await resumeReviewedClaimedTrancheAttempts(h.fake, h.deps),
    { checked: 1, pending: 0, errors: 1 })
  assertEquals(h.invocations, [])
  assertEquals(h.issues, ['request-one'])
})

Deno.test('transferred claim is left to the terminal reconciliation loop', async () => {
  const h = harness({ claimStatus: 'TRANSFERRED' })
  assertEquals(await resumeReviewedClaimedTrancheAttempts(h.fake, h.deps),
    { checked: 1, pending: 0, errors: 0 })
  assertEquals(h.invocations, [])
})

Deno.test('invalid reviewed payload fails closed with a durable Ops case', async () => {
  const h = harness({ actionPayload: { claimId: 'other', trancheId: 'tranche-one' } })
  assertEquals(await resumeReviewedClaimedTrancheAttempts(h.fake, h.deps),
    { checked: 1, pending: 0, errors: 1 })
  assertEquals(h.issues, ['request-one'])
  assertEquals(h.invocations, [])
  const noCase = harness({ actionPayload: { claimId: 'other' }, recordFailure: false })
  await assertRejects(() => resumeReviewedClaimedTrancheAttempts(noCase.fake, noCase.deps),
    Error, 'REVIEWED_RETRY_OPS_CASE_FAILED')
})
