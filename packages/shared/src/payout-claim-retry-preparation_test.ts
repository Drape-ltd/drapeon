import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  buildPayoutClaimRetryCandidate,
  isPayoutClaimRetryGraceElapsed,
  payoutClaimRetryIdempotencyKey,
  payoutClaimRetryAvailableAt,
  preparePayoutClaimRetry,
} from './payout-claim-retry-preparation.ts'

Deno.test('claimed payout retry remains unavailable for ten minutes after confirmed not-sent', () => {
  const confirmedAt = '2026-11-10T12:00:00.000Z'
  assertEquals(payoutClaimRetryAvailableAt(confirmedAt), '2026-11-10T12:10:00.000Z')
  assertEquals(isPayoutClaimRetryGraceElapsed(confirmedAt, Date.parse('2026-11-10T12:09:59.999Z')), false)
  assertEquals(isPayoutClaimRetryGraceElapsed(confirmedAt, Date.parse('2026-11-10T12:10:00.000Z')), true)
})

Deno.test('missing or invalid not-sent confirmation never passes retry grace', () => {
  assertEquals(payoutClaimRetryAvailableAt(null), null)
  assertEquals(payoutClaimRetryAvailableAt('not-a-time'), null)
  assertEquals(isPayoutClaimRetryGraceElapsed(null), false)
})

function retryFixture() {
  const claim = {
    id: 'claim-1', source_kind: 'SETTLEMENT_TRANCHE', source_id: 'tranche-1', order_id: 'order-1',
    provider: 'STRIPE', provider_destination_id: 'acct_test', currency: 'USD', amount: 8400,
    status: 'FAILED_RECONCILED', transfer_status: 'FAILED_RECONCILED', payout_id: 'payout-1', provider_transfer_id: null,
  }
  const operation = {
    id: 'operation-1', claim_id: 'claim-1', operation_number: 1, provider: 'STRIPE', provider_destination_id: 'acct_test',
    currency: 'USD', amount: 8400, status: 'FAILED_RETURNED', provider_source_transaction_id: 'ch_test',
    final_failure_reference: 'req_test', funds_return_reference: 'NOT_SENT:account_capability',
    funds_return_confirmed_at: '2026-11-10T12:00:00.000Z', provider_transfer_id: null,
  }
  const payout = { id: 'payout-1', order_id: 'order-1', status: 'FAILED', payout_purpose: 'SETTLEMENT_TRANCHE', provider: 'STRIPE', amount: 8400, currency: 'USD', provider_destination_id: 'acct_test' }
  const tranche = { id: 'tranche-1', order_id: 'order-1', status: 'BLOCKED', payout_id: 'payout-1', amount: 8400, currency: 'USD' }
  const tables: Record<string, Record<string, unknown>[]> = {
    payout_claims: [claim], payout_provider_operations: [operation], payouts: [payout],
    order_settlement_tranches: [tranche], payout_claim_retry_authorizations: [], money_desk_requests: [],
  }
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []
  const client: any = {
    from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = []
      const builder: Record<string, unknown> = {
        select() { return builder },
        eq(key: string, value: unknown) { filters.push((row) => row[key] === value); return builder },
        in(key: string, values: unknown[]) { filters.push((row) => values.includes(row[key])); return builder },
        order() { return builder },
        limit() { return builder },
        maybeSingle() { return Promise.resolve({ data: (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)))[0] ?? null, error: null }) },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve({ data: (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row))), error: null }).then(resolve, reject)
        },
      }
      return builder
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args })
      return { data: { requestId: 'request-1', reference: 'MD-TEST', status: 'PENDING_APPROVAL', requiredApprovalCount: 2, riskLevel: 'HIGH', duplicate: rpcCalls.length > 1 }, error: null }
    },
  }
  return { tables, rpcCalls, client }
}

Deno.test('prepares one two-person retry review with an idempotency key tied to the failed operation', async () => {
  const fixture = retryFixture()
  const input = { claimId: 'claim-1', reason: 'Reviewed definite rejection and confirmed no transfer was sent.', actor: { email: 'ops@example.test', subject: 'subject-1', role: 'finance' }, grantId: 'grant-1', correlationId: 'corr-1', nowMs: Date.parse('2026-11-10T12:11:00.000Z') }
  const first = await preparePayoutClaimRetry(fixture.client, input)
  const replay = await preparePayoutClaimRetry(fixture.client, input)
  assertEquals(first.ok, true)
  assertEquals(replay.ok, true)
  if (!first.ok || !replay.ok) return
  assertEquals(fixture.rpcCalls.length, 2)
  assertEquals(fixture.rpcCalls[0].name, 'submit_money_desk_request')
  assertEquals(fixture.rpcCalls[0].args.p_idempotency_key, 'payout-claim-retry:claim-1:after:operation-1:request:none')
  assertEquals(fixture.rpcCalls[1].args.p_idempotency_key, fixture.rpcCalls[0].args.p_idempotency_key)
  assertEquals(first.request.requestId, 'request-1')
  assertEquals(replay.request.duplicate, true)
  assertEquals(first.request.requiredApprovalCount, 2)
  assertEquals(fixture.rpcCalls[0].args.p_action_type, 'POST_RELEASE_RECOVERY')
  assertEquals(fixture.rpcCalls[0].args.p_target_type, 'PAYOUT_CLAIM_RETRY')
  assertEquals(fixture.rpcCalls[0].args.p_target_id, 'claim-1')
  assertEquals(fixture.rpcCalls[0].args.p_amount, 8400)
  assertEquals((fixture.rpcCalls[0].args.p_action_payload as Record<string, unknown>).priorOperationId, 'operation-1')
})

Deno.test('preparation refuses an active grace window or a retry authorization already consumed', async () => {
  const fixture = retryFixture()
  const input = { claimId: 'claim-1', reason: 'Reviewed definite rejection and confirmed no transfer was sent.', actor: { email: 'ops@example.test', subject: 'subject-1', role: 'finance' }, grantId: 'grant-1', correlationId: 'corr-1' }
  const early = await preparePayoutClaimRetry(fixture.client, { ...input, nowMs: Date.parse('2026-11-10T12:09:59.999Z') })
  assertEquals(early, { ok: false, code: 'RETRY_GRACE_ACTIVE' })
  assertEquals(fixture.rpcCalls.length, 0)
  fixture.tables.payout_claim_retry_authorizations = [{ id: 'authorization-1', prior_operation_id: 'operation-1' }]
  const consumed = await preparePayoutClaimRetry(fixture.client, { ...input, nowMs: Date.parse('2026-11-10T12:11:00.000Z') })
  assertEquals(consumed, { ok: false, code: 'RETRY_ALREADY_AUTHORIZED' })
  assertEquals(fixture.rpcCalls.length, 0)
})

Deno.test('preparation rejects a payout row whose provider differs from the Stripe claim', async () => {
  const fixture = retryFixture()
  fixture.tables.payouts[0].provider = 'PAYSTACK'
  const result = await preparePayoutClaimRetry(fixture.client, {
    claimId: 'claim-1', reason: 'Reviewed definite rejection and confirmed no transfer was sent.',
    actor: { email: 'ops@example.test', subject: 'subject-1', role: 'finance' }, grantId: 'grant-1',
    correlationId: 'corr-provider', nowMs: Date.parse('2026-11-10T12:11:00.000Z'),
  })
  assertEquals(result, { ok: false, code: 'RETRY_EVIDENCE_MISMATCH' })
  assertEquals(fixture.rpcCalls.length, 0)
})

Deno.test('a rejected review gets a fresh key for a new review of the same failed operation', async () => {
  const fixture = retryFixture()
  fixture.tables.money_desk_requests = [{ id: 'request-old', action_type: 'POST_RELEASE_RECOVERY', target_type: 'PAYOUT_CLAIM_RETRY', target_id: 'claim-1', status: 'REJECTED', created_at: '2026-11-10T12:02:00.000Z' }]
  const result = await preparePayoutClaimRetry(fixture.client, { claimId: 'claim-1', reason: 'Reviewed again after a new evidence check.', actor: { email: 'ops@example.test', subject: 'subject-1', role: 'finance' }, grantId: 'grant-1', correlationId: 'corr-2', nowMs: Date.parse('2026-11-10T12:11:00.000Z') })
  assertEquals(result.ok, true)
  assertEquals(fixture.rpcCalls[0].args.p_idempotency_key, 'payout-claim-retry:claim-1:after:operation-1:request:request-old')
})

Deno.test('preparation refuses a different active request for the same claim', async () => {
  const fixture = retryFixture()
  fixture.tables.money_desk_requests = [{
    id: 'request-active', action_type: 'POST_RELEASE_RECOVERY', target_type: 'PAYOUT_CLAIM_RETRY',
    target_id: 'claim-1', status: 'PENDING_APPROVAL', idempotency_key: 'payout-claim-retry:claim-1:other-key',
    created_at: '2026-11-10T12:02:00.000Z',
  }]
  const result = await preparePayoutClaimRetry(fixture.client, {
    claimId: 'claim-1', reason: 'Reviewed definite rejection and confirmed no transfer was sent.',
    actor: { email: 'ops@example.test', subject: 'subject-1', role: 'finance' }, grantId: 'grant-1',
    correlationId: 'corr-active', nowMs: Date.parse('2026-11-10T12:11:00.000Z'),
  })
  assertEquals(result, { ok: false, code: 'ACTIVE_REQUEST_EXISTS' })
  assertEquals(fixture.rpcCalls.length, 0)
})

Deno.test('preparation fails closed on idempotency mismatch and non-dual-approval results', async () => {
  const input = {
    claimId: 'claim-1', reason: 'Reviewed definite rejection and confirmed no transfer was sent.',
    actor: { email: 'ops@example.test', subject: 'subject-1', role: 'finance' }, grantId: 'grant-1',
    correlationId: 'corr-mismatch', nowMs: Date.parse('2026-11-10T12:11:00.000Z'),
  }
  const mismatch = retryFixture()
  mismatch.client.rpc = async (name: string, args: Record<string, unknown>) => {
    mismatch.rpcCalls.push({ name, args })
    return { data: null, error: { message: 'Money Desk idempotency key was reused with different values.' } }
  }
  assertEquals(await preparePayoutClaimRetry(mismatch.client, input), { ok: false, code: 'REQUEST_SUBMISSION_FAILED' })

  const wrongApprovalCount = retryFixture()
  wrongApprovalCount.client.rpc = async (name: string, args: Record<string, unknown>) => {
    wrongApprovalCount.rpcCalls.push({ name, args })
    return { data: { requestId: 'request-weak', reference: 'MD-WEAK', status: 'PENDING_APPROVAL', requiredApprovalCount: 1, riskLevel: 'STANDARD', duplicate: false }, error: null }
  }
  assertEquals(await preparePayoutClaimRetry(wrongApprovalCount.client, input), { ok: false, code: 'REQUEST_SUBMISSION_FAILED' })
})

Deno.test('Money Desk candidate projection only offers proven retries and links an active matching review', () => {
  const fixture = retryFixture()
  const claim = fixture.tables.payout_claims[0]
  const operation = fixture.tables.payout_provider_operations[0]
  const payout = fixture.tables.payouts[0]
  const tranche = fixture.tables.order_settlement_tranches[0]
  const request = { id: 'request-1', reference: 'MD-TEST', status: 'PENDING_APPROVAL', idempotency_key: 'payout-claim-retry:claim-1:after:operation-1:request:none' }
  const candidate = buildPayoutClaimRetryCandidate({ claim, operation, payout, tranche, requests: [request], orderReference: 'ORDER-TEST', nowMs: Date.parse('2026-11-10T12:11:00.000Z') })
  assertEquals(candidate?.graceElapsed, true)
  assertEquals(candidate?.request, { id: 'request-1', reference: 'MD-TEST', status: 'PENDING_APPROVAL' })
  assertEquals(buildPayoutClaimRetryCandidate({ claim, operation, payout, tranche, requests: [], authorizedPriorOperationId: 'operation-1', nowMs: Date.parse('2026-11-10T12:11:00.000Z') }), null)
  assertEquals(payoutClaimRetryIdempotencyKey({ claimId: 'claim-1', priorOperationId: 'operation-1', latestTerminalRequestId: 'request-old' }), 'payout-claim-retry:claim-1:after:operation-1:request:request-old')
})
