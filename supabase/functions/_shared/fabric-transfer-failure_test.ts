import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { createStripeTransfer, StripeApiError } from './stripe.ts'
import {
  fabricReconciliationGate,
  findFabricTransferMatch,
  findStripeFabricTransferAcrossPages,
  preferredFabricSourcePayment,
  processFabricCandidateRelease,
  reconcileFabricCandidateRelease,
} from './fabric-release.ts'
import {
  type FabricTransferFailureRecord,
  handleFabricStripeTransferFailure,
} from './fabric-transfer-failure.ts'

function recorder() {
  const events: string[] = []
  let persisted: FabricTransferFailureRecord | null = null
  return {
    events,
    get record() { return persisted },
    deps: {
      recordOutcome: async (record: FabricTransferFailureRecord) => { events.push(`candidate:${record.outcome}`); persisted = record },
      updatePayout: async (record: FabricTransferFailureRecord) => { events.push(`payout:${record.outcome}`) },
      advanceAttempt: async (nextAttempt: number) => { events.push(`attempt:${nextAttempt}`) },
      persistOpsIssue: async () => { events.push('ops'); return true },
      notify: async (record: FabricTransferFailureRecord) => { events.push(`notify:${record.outcome}`) },
    },
  }
}

Deno.test('Stripe balance_insufficient becomes a terminal failed release without a queue rethrow', async () => {
  const previousKey = Deno.env.get('STRIPE_SECRET_KEY')
  const originalFetch = globalThis.fetch
  const recorded = recorder()
  try {
    Deno.env.set('STRIPE_SECRET_KEY', 'sk_test_unit_only')
    globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({
      error: { type: 'invalid_request_error', code: 'balance_insufficient', message: 'Insufficient balance' },
    }), { status: 400, headers: { 'Content-Type': 'application/json', 'request-id': 'req_balance' } }))
    let providerError: unknown
    try {
      await createStripeTransfer({ amount: 8000, currency: 'USD', destinationAccountId: 'acct_test' })
    } catch (error) {
      providerError = error
    }
    const result = await handleFabricStripeTransferFailure(providerError, 1, recorded.deps)
    assertEquals(result.outcome, 'FAILED')
    assertEquals(result.code, 'balance_insufficient')
    assertEquals(result.requestId, 'req_balance')
    assertEquals(recorded.events, ['candidate:FAILED', 'payout:FAILED', 'attempt:2', 'ops', 'notify:FAILED'])
  } finally {
    globalThis.fetch = originalFetch
    if (previousKey === undefined) Deno.env.delete('STRIPE_SECRET_KEY')
    else Deno.env.set('STRIPE_SECRET_KEY', previousKey)
  }
})

Deno.test('network timeout is ambiguous, does not advance the attempt, and requires reconciliation', async () => {
  const recorded = recorder()
  const result = await handleFabricStripeTransferFailure(new TypeError('network timeout'), 1, recorded.deps)
  assertEquals(result.outcome, 'AMBIGUOUS')
  assertEquals(recorded.events, ['candidate:AMBIGUOUS', 'payout:AMBIGUOUS', 'ops', 'notify:AMBIGUOUS'])
})

Deno.test('money-path Ops case failure remains retryable by throwing loudly', async () => {
  const recorded = recorder()
  recorded.deps.persistOpsIssue = async () => false
  await assertRejects(
    () => handleFabricStripeTransferFailure(new TypeError('network timeout'), 1, recorded.deps),
    Error,
    'FABRIC_OPS_CASE_PERSISTENCE_FAILED',
  )
})

Deno.test('fabric reconciliation accepts only the exact order and candidate metadata', () => {
  const exact = { id: 'tr_exact', metadata: { order_id: 'order_1', fabric_candidate_id: 'candidate_1' } }
  const rows = [
    { id: 'tr_wrong_candidate', metadata: { order_id: 'order_1', fabric_candidate_id: 'candidate_2' } },
    { id: 'tr_wrong_order', metadata: { order_id: 'order_2', fabric_candidate_id: 'candidate_1' } },
    exact,
  ]
  assertEquals(findFabricTransferMatch(rows, 'candidate_1', 'order_1'), exact)
  assertEquals(findFabricTransferMatch(rows, 'candidate_3', 'order_1'), null)
})

Deno.test('young ambiguous and non-Stripe releases cannot become transfer-not-found', () => {
  const now = Date.parse('2026-11-02T20:30:00.000Z')
  assertEquals(
    fabricReconciliationGate('STRIPE', '2026-11-02T20:20:00.000Z', now),
    'VISIBILITY_WINDOW',
  )
  assertEquals(
    fabricReconciliationGate('PAYSTACK', '2026-11-02T19:00:00.000Z', now),
    'PROVIDER_SPECIFIC_RECONCILIATION_REQUIRED',
  )
})

Deno.test('fabric reconciliation pages until the exact transfer is found', async () => {
  const cursors: Array<string | null | undefined> = []
  const match = await findStripeFabricTransferAcrossPages({
    destinationAccountId: 'acct_tailor',
    transferGroup: 'order:order_1',
    candidateId: 'candidate_1',
    orderId: 'order_1',
  }, async (input) => {
    cursors.push(input.startingAfter)
    return input.startingAfter
      ? { data: [{ id: 'tr_match', amount: 1000, currency: 'usd', metadata: { order_id: 'order_1', fabric_candidate_id: 'candidate_1' } }], has_more: false }
      : { data: [{ id: 'tr_page_1', amount: 1000, currency: 'usd', metadata: { order_id: 'order_1', fabric_candidate_id: 'other' } }], has_more: true }
  })
  assertEquals(match?.id, 'tr_match')
  assertEquals(cursors, [null, 'tr_page_1'])
})

Deno.test('fabric release prefers the candidate top-up charge over the initial order charge', () => {
  const candidatePayment = { id: 'payment_candidate', provider_response: { latest_charge: 'ch_candidate' } }
  const initialPayment = { id: 'payment_initial', provider_response: { latest_charge: 'ch_initial' } }
  assertEquals(preferredFabricSourcePayment(candidatePayment, initialPayment), candidatePayment)
  assertEquals(preferredFabricSourcePayment(null, initialPayment), initialPayment)
})

function fabricProcessHarness(candidateOverrides: Record<string, unknown> = {}) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []
  const updates: Array<{ table: string; values: Record<string, unknown> }> = []
  const candidate: Record<string, unknown> = {
    id: 'candidate_1', order_id: 'order_1', tailor_id: 'tailor_user', customer_id: 'customer_user',
    component_code: 'FABRIC', supplier_cost_amount: 8000, currency: 'USD', status: 'RELEASE_QUEUED',
    provider_status: 'QUEUED', correlation_id: 'correlation_1', payout_id: null,
    customer_media: [], provider_attempt_number: 1,
    ...candidateOverrides,
  }
  const rows: Record<string, unknown> = {
    order_fabric_candidates: candidate,
    orders: {
      id: 'order_1', reference: 'DRPTEST', stage: 'IN_PROGRESS', customer_id: 'customer_user',
      tailor_id: 'tailor_user', accepted_route_snapshot_at: null, tailor_profile_id: 'profile_1',
      tailor_payout_currency_locked: 'USD', tailor_payout_provider_locked: 'STRIPE',
    },
    tailor_profiles: {
      id: 'profile_1', user_id: 'tailor_user', payout_account_verified: true,
      payout_reverification_required: false, stripe_connect_account_id: 'acct_tailor',
    },
    order_payments: { id: 'payment_candidate', provider_response: { latest_charge: 'ch_candidate' } },
    payouts: null,
  }
  class Query {
    private inserted = false
    constructor(private table: string) {}
    select() { return this }
    eq() { return this }
    in() { return this }
    order() { return this }
    limit() { return this }
    update(values: Record<string, unknown>) { updates.push({ table: this.table, values }); return this }
    insert() { this.inserted = true; return this }
    async maybeSingle() { return { data: rows[this.table] ?? null, error: null } }
    async single() {
      if (this.inserted && this.table === 'payouts') {
        return { data: { id: 'payout_1', status: 'PROCESSING', provider_payout_id: null }, error: null }
      }
      return { data: rows[this.table] ?? null, error: null }
    }
    then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: null, error: null }).then(resolve) }
  }
  const db = {
    from(table: string) { return new Query(table) },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args })
      return { data: { id: 'candidate_1' }, error: null }
    },
  }
  return { db, rpcCalls, updates, candidate }
}

Deno.test('processFabricCandidateRelease completes a definite Stripe rejection without queue retry', async () => {
  const h = fabricProcessHarness()
  const result = await processFabricCandidateRelease(h.db as never, 'candidate_1', {
    createStripeTransfer: async () => {
      throw new StripeApiError('Insufficient balance', 400, 'invalid_request_error', 'balance_insufficient', 'req_balance')
    },
    createOpsIssue: async () => ({ id: 'issue_1', issue_number: 1 }),
    notifyOutcome: async () => undefined,
  })
  assertEquals((result as Record<string, unknown>).failed, true)
  assertEquals(h.rpcCalls.some((call) => call.args.p_outcome === 'FAILED'), true)
  assertEquals(h.updates.some((entry) => entry.table === 'payouts' && entry.values.status === 'FAILED'), true)
})

Deno.test('processFabricCandidateRelease routes an unclear Stripe outcome to reconciliation', async () => {
  const h = fabricProcessHarness()
  await assertRejects(() => processFabricCandidateRelease(h.db as never, 'candidate_1', {
    createStripeTransfer: async () => { throw new TypeError('network timeout') },
    createOpsIssue: async () => ({ id: 'issue_1', issue_number: 1 }),
    notifyOutcome: async () => undefined,
  }), TypeError, 'network timeout')
  assertEquals(h.rpcCalls.some((call) => call.args.p_outcome === 'AMBIGUOUS'), true)
  assertEquals(h.updates.some((entry) => entry.table === 'payouts'
    && entry.values.blocked_reason === 'RECONCILIATION_REQUIRED'), true)
})

Deno.test('the same bounded fabric queue job starts attempt two with a fresh Stripe key', async () => {
  const h = fabricProcessHarness({
    status: 'RELEASE_BLOCKED',
    provider_status: 'AMBIGUOUS',
    provider_attempt_number: 1,
  })
  await assertRejects(() => processFabricCandidateRelease(h.db as never, 'candidate_1', {
    reconcile: async () => ({ outcome: 'FAILED', transfer: null, payoutId: 'payout_1' }),
  }), Error, 'FABRIC_RETRY_READY')

  h.candidate.provider_status = 'FAILED'
  h.candidate.provider_attempt_number = 2
  let retryKey = ''
  await processFabricCandidateRelease(h.db as never, 'candidate_1', {
    createStripeTransfer: async (input) => {
      retryKey = input.idempotencyKey ?? ''
      return {
        id: 'tr_attempt_2', amount: input.amount, currency: input.currency.toLowerCase(),
        destination: input.destinationAccountId, source_transaction: input.sourceTransaction,
        transfer_group: input.transferGroup, metadata: input.metadata,
      }
    },
    notifyOutcome: async () => undefined,
  })
  assertEquals(retryKey, 'DRAPE-FABRIC-V2-candidate_1-a2')
})

Deno.test('Paystack fabric reconciliation never calls Stripe', async () => {
  let stripeCalled = false
  const query = {
    select() { return this },
    eq() { return this },
    async single() {
      return { data: {
        id: 'candidate_paystack', order_id: 'order_1', status: 'RELEASE_BLOCKED',
        provider: 'PAYSTACK', provider_status: 'AMBIGUOUS', payout_id: 'payout_1',
        provider_attempt_number: 1, updated_at: '2026-11-02T19:00:00.000Z',
      }, error: null }
    },
  }
  const db = { from() { return query } }
  await assertRejects(() => reconcileFabricCandidateRelease(db as never, 'candidate_paystack', {
    listTransfers: async () => { stripeCalled = true; return { data: [], has_more: false } },
    createOpsIssue: async () => ({ id: 'issue_1', issue_number: 1 }),
  }), Error, 'FABRIC_PROVIDER_RECONCILIATION_REQUIRED')
  assertEquals(stripeCalled, false)
})
