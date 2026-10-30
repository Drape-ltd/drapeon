import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  executeClaimedPayout,
  executeReservedPayout,
  isNormalConcurrentPayoutLoser,
  queueLatePayoutConflict,
} from './claimed-payout-execution.ts'

const identity = {
  businessKey: 'order:one:earning', sourceKind: 'ORDER_EARNING' as const,
  sourceId: 'one', orderId: 'one', tailorProfileId: 'tailor-one',
  provider: 'STRIPE', destinationId: 'acct_one', currency: 'USD', amount: 1000,
  routeVersion: 'stripe-usd-v1', earningPolicyVersion: 'commercial-v1',
  providerIdempotencyKey: 'order:one:earning:op:1',
}
const db = {} as SupabaseClient

Deno.test('late payout conflict keeps safe provider IDs but redacts sensitive Ops metadata', async () => {
  let row: Record<string, unknown> | null = null
  await queueLatePayoutConflict(db, {
    claimId: 'claim-one', identity,
    evidence: {
      transfer_id: 'tr_one', amount: 1000,
      bank_account: '1234567890',
      nested: { email: 'qa@example.com', phone: '+1 312 555 0101', api_key: 'sk_test_EXAMPLE' },
      provider_url: 'https://example.com/private-receipt',
    },
  }, async (client, input) => {
    assertEquals(client, db)
    row = input
    return { id: 'issue-one', issue_number: 1 }
  })
  const issue = row as Record<string, unknown> | null
  assertEquals(issue?.queueKey, 'money-desk')
  assertEquals(issue?.persistWhenRoutineDisabled, true)
  assertEquals(issue?.dedupeKey, 'payout-late-provider-conflict:claim-one')
  assertEquals(issue?.metadata, {
    claim_id: 'claim-one',
    provider_evidence: {
      transfer_id: 'tr_one', amount: 1000,
      bank_account: '[REDACTED]',
      nested: { email: '[REDACTED]', phone: '[REDACTED]', api_key: '[REDACTED]' },
      provider_url: '[REDACTED_URL]',
    },
  })
})

Deno.test('late payout conflict fails closed when the Ops case cannot be persisted', async () => {
  await assertRejects(() => queueLatePayoutConflict(db, {
    claimId: 'claim-one', identity, evidence: { transfer_id: 'tr_other' },
  }, async () => null), Error, 'Late payout conflict could not be queued for Ops')
})

function harness(options: {
  claimStatus?: string
  action?: string
  sendThrows?: boolean
  lookupKind?: 'CONFIRMED' | 'UNKNOWN'
  verifyThrows?: boolean
  blockThrows?: boolean
  lookupThrows?: boolean
  lookupTransferId?: string
  blockLateThrows?: boolean
  lateConflictThrows?: boolean
  operationNumber?: number
  operationDestinationId?: string
  operationProviderKey?: string
} = {}) {
  const calls: string[] = []
  const recorded: string[] = []
  const completed: string[] = []
  const conflicts: string[] = []
  const blockedLate: string[] = []
  const lateConflicts: string[] = []
  const providerOperations: unknown[] = []
  const deps = {
    async reserve() {
      calls.push('reserve')
      return { outcome: 'RESERVED', claim_id: 'claim-one',
        status: options.claimStatus ?? 'RESERVED',
        provider_idempotency_key: identity.providerIdempotencyKey,
        provider_transfer_id: null, payout_id: null }
    },
    async start() {
      calls.push('start')
      const operationNumber = options.operationNumber ?? 1
      return { action: options.action ?? 'PROVIDER_CALL', claim_id: 'claim-one',
        attempt_id: 'attempt-one',
        claim_operation_id: 'operation-one', operation_number: operationNumber,
        provider_idempotency_key: options.operationProviderKey ??
          (operationNumber === 1 ? identity.providerIdempotencyKey : `${identity.businessKey}:op:${operationNumber}`),
        provider_transfer_id: options.action === 'DONE' ? 'tr_one' : null,
        provider: identity.provider,
        provider_destination_id: options.operationDestinationId ?? identity.destinationId,
        currency: identity.currency, amount: identity.amount,
        reviewed_correction_id: operationNumber === 1 ? null : 'correction-one',
        money_desk_request_id: operationNumber === 1 ? null : 'money-desk-one' }
    },
    async record(_db: unknown, input: { status: string }) {
      recorded.push(input.status)
      return 'RECORDED'
    },
    async blockConflict(_db: unknown, input: { attemptId: string }) {
      conflicts.push(input.attemptId)
      if (options.blockThrows) throw new Error('Atomic conflict block unavailable')
    },
    async blockLateConflict(_db: unknown, input: { claimId: string; evidence: Record<string, unknown> }) {
      blockedLate.push(input.claimId)
      assertEquals(input.evidence.identity_conflict, true)
      assertEquals(input.evidence.confirmed_transfer_id, 'tr_one')
      if (options.blockLateThrows) throw new Error('Durable claim block unavailable')
    },
    async lateConflict(_db: unknown, input: { claimId: string }) {
      lateConflicts.push(input.claimId)
      if (options.lateConflictThrows) throw new Error('Late conflict case unavailable')
    },
  } as unknown as Parameters<typeof executeClaimedPayout>[4]
  const provider = {
    async send(key: string, operation?: Record<string, unknown>) {
      if (operation) providerOperations.push(operation)
      calls.push(`send:${key}`)
      if (options.sendThrows) throw new Error('network timeout')
      return { kind: 'CONFIRMED', transferId: 'tr_one', evidence: { provider: 'fixture' } }
    },
    async lookup(key: string, _knownTransferId?: string | null, operation?: Record<string, unknown>) {
      if (operation) providerOperations.push(operation)
      calls.push(`lookup:${key}`)
      if (options.lookupThrows) throw new Error('provider unavailable')
      return options.lookupKind === 'CONFIRMED'
        ? { kind: 'CONFIRMED', transferId: options.lookupTransferId ?? 'tr_one', evidence: { provider: 'fixture' } }
        : { kind: 'UNKNOWN', evidence: { provider: 'fixture', lookup: 'not_found' } }
    },
    verify() {
      if (options.verifyThrows) throw new Error('transfer destination differs from claim')
    },
  } as unknown as Parameters<typeof executeClaimedPayout>[2]
  const complete = async (transferId: string) => { completed.push(transferId) }
  return { deps, provider, complete, calls, recorded, completed, conflicts, blockedLate, lateConflicts, providerOperations }
}

Deno.test('new order earning sends once with the immutable key and then completes', async () => {
  const h = harness()
  const result = await executeClaimedPayout(db, identity, h.provider, h.complete, h.deps)
  assertEquals(result, { kind: 'CONFIRMED', claimId: 'claim-one', transferId: 'tr_one' })
  assertEquals(h.calls, ['reserve', 'start', `send:${identity.providerIdempotencyKey}`])
  assertEquals(h.recorded, ['SUCCEEDED'])
  assertEquals(h.completed, ['tr_one'])
})

Deno.test('reviewed replacement uses a new operation key and the reviewed destination under one claim', async () => {
  const h = harness({ operationNumber: 2, operationDestinationId: 'acct_corrected' })
  const result = await executeClaimedPayout(db, identity, h.provider, h.complete, h.deps)
  assertEquals(result, { kind: 'CONFIRMED', claimId: 'claim-one', transferId: 'tr_one' })
  assertEquals(h.calls, ['reserve', 'start', `send:${identity.businessKey}:op:2`])
  assertEquals(h.providerOperations[0], {
    id: 'operation-one', number: 2, provider: 'STRIPE', destinationId: 'acct_corrected',
    currency: 'USD', amount: 1000, idempotencyKey: `${identity.businessKey}:op:2`,
    transferId: null, reviewedCorrectionId: 'correction-one', moneyDeskRequestId: 'money-desk-one',
  })
})

Deno.test('initial provider operation cannot replace its frozen payout destination', async () => {
  const h = harness({ operationDestinationId: 'acct_unreviewed' })
  await assertRejects(() => executeClaimedPayout(db, identity, h.provider, h.complete, h.deps),
    Error, 'changes the frozen payout destination')
  assertEquals(h.calls, ['reserve', 'start'])
  assertEquals(h.completed, [])
})

Deno.test('concurrent worker told to reconcile first never contacts the provider', async () => {
  const h = harness({ action: 'RECONCILE_FIRST' })
  const result = await executeClaimedPayout(db, identity, h.provider, h.complete, h.deps)
  assertEquals(result.kind, 'PENDING')
  assertEquals(h.calls, ['reserve', 'start'])
  assertEquals(h.recorded, [])
})

Deno.test('tranche concurrent loser is a normal 200-class outcome with no Ops alert', () => {
  assertEquals(isNormalConcurrentPayoutLoser({
    kind: 'PENDING', claimId: 'tranche-claim', reason: 'RECONCILE_FIRST',
  }), true)
})

Deno.test('adjustment concurrent loser is a normal 200-class outcome with no Ops alert', () => {
  assertEquals(isNormalConcurrentPayoutLoser({
    kind: 'PENDING', claimId: 'adjustment-claim', reason: 'RECONCILE_FIRST',
  }), true)
  assertEquals(isNormalConcurrentPayoutLoser({
    kind: 'PENDING', claimId: 'adjustment-claim', reason: 'PROVIDER_UNKNOWN',
  }), false)
})

Deno.test('reconcile-only replay refuses a new provider call even if the action races', async () => {
  const h = harness({ claimStatus: 'PROVIDER_UNKNOWN', action: 'PROVIDER_CALL' })
  const reserved = { outcome: 'EXISTING' as const, claim_id: 'claim-one',
    status: 'PROVIDER_UNKNOWN' as const, provider_idempotency_key: identity.providerIdempotencyKey,
    provider_transfer_id: null, payout_id: 'payout-one' }
  await assertRejects(() => executeReservedPayout(db, identity, reserved,
    h.provider, h.complete, h.deps, { reconcileOnly: true }),
  Error, 'cannot initiate another provider transfer')
  assertEquals(h.calls, ['start'])
  assertEquals(h.recorded, [])
  assertEquals(h.completed, [])
})

Deno.test('reconcile-only RESERVED claim is rejected before the start RPC can mutate it', async () => {
  const h = harness({ claimStatus: 'RESERVED' })
  const reserved = { outcome: 'EXISTING' as const, claim_id: 'claim-one',
    status: 'RESERVED' as const, provider_idempotency_key: identity.providerIdempotencyKey,
    provider_transfer_id: null, payout_id: 'payout-one' }
  await assertRejects(() => executeReservedPayout(db, identity, reserved,
    h.provider, h.complete, h.deps, { reconcileOnly: true }),
  Error, 'cannot initiate another provider transfer')
  assertEquals(h.calls, [])
  assertEquals(h.recorded, [])
  assertEquals(h.completed, [])
})

Deno.test('generic reconcile-only helper cannot create a new business claim', async () => {
  const h = harness()
  await assertRejects(() => executeClaimedPayout(db, identity, h.provider, h.complete,
    h.deps, { reconcileOnly: true }), Error, 'requires an existing reserved payout claim')
  assertEquals(h.calls, [])
})

Deno.test('network timeout stays unknown and cannot complete earnings', async () => {
  const h = harness({ sendThrows: true })
  const result = await executeClaimedPayout(db, identity, h.provider, h.complete, h.deps)
  assertEquals(result, { kind: 'PENDING', claimId: 'claim-one', reason: 'PROVIDER_UNKNOWN' })
  assertEquals(h.recorded, ['PROVIDER_UNKNOWN'])
  assertEquals(h.completed, [])
})

Deno.test('crash after provider call is recovered by lookup without a second send', async () => {
  const h = harness({ claimStatus: 'PROVIDER_UNKNOWN', action: 'RECONCILE', lookupKind: 'CONFIRMED' })
  const result = await executeClaimedPayout(db, identity, h.provider, h.complete, h.deps)
  assertEquals(result.kind, 'CONFIRMED')
  assertEquals(h.calls, ['reserve', 'start', `lookup:${identity.providerIdempotencyKey}`])
  assertEquals(h.recorded, ['SUCCEEDED'])
})

Deno.test('source-specific reserved claim reconciles without re-running its creation guard', async () => {
  const h = harness({ claimStatus: 'PROVIDER_UNKNOWN', action: 'RECONCILE', lookupKind: 'CONFIRMED' })
  const reserved = { outcome: 'EXISTING' as const, claim_id: 'claim-one',
    status: 'PROVIDER_UNKNOWN' as const, provider_idempotency_key: identity.providerIdempotencyKey,
    provider_transfer_id: null, payout_id: 'payout-one' }
  const result = await executeReservedPayout(db, identity, reserved,
    h.provider, h.complete, h.deps, { reconcileOnly: true })
  assertEquals(result.kind, 'CONFIRMED')
  assertEquals(h.calls, ['start', `lookup:${identity.providerIdempotencyKey}`])
  assertEquals(h.recorded, ['SUCCEEDED'])
  assertEquals(h.completed, ['tr_one'])
})

Deno.test('provider lookup with no match is unknown, not permission to retry a transfer', async () => {
  const h = harness({ claimStatus: 'PROVIDER_UNKNOWN', action: 'RECONCILE' })
  const result = await executeClaimedPayout(db, identity, h.provider, h.complete, h.deps)
  assertEquals(result.kind, 'PENDING')
  assertEquals(h.calls, ['reserve', 'start', `lookup:${identity.providerIdempotencyKey}`])
  assertEquals(h.recorded, ['PROVIDER_UNKNOWN'])
})

Deno.test('confirmed claim replays idempotent ledger completion after a crash', async () => {
  const h = harness({ claimStatus: 'TRANSFERRED', action: 'DONE', lookupKind: 'CONFIRMED' })
  const result = await executeClaimedPayout(db, identity, h.provider, h.complete, h.deps)
  assertEquals(result.kind, 'CONFIRMED')
  assertEquals(h.calls, ['reserve', 'start', `lookup:${identity.providerIdempotencyKey}`])
  assertEquals(h.completed, ['tr_one'])
})

Deno.test('confirmed claim waits when provider recheck is unavailable', async () => {
  const h = harness({ claimStatus: 'TRANSFERRED', action: 'DONE', lookupThrows: true })
  const result = await executeClaimedPayout(db, identity, h.provider, h.complete, h.deps)
  assertEquals(result, { kind: 'PENDING', claimId: 'claim-one', reason: 'PROVIDER_UNKNOWN' })
  assertEquals(h.completed, [])
  assertEquals(h.lateConflicts, [])
})

Deno.test('confirmed claim holds local completion and queues Ops if provider evidence changes', async () => {
  for (const options of [
    { verifyThrows: true },
    { lookupTransferId: 'tr_other' },
  ]) {
    const h = harness({ claimStatus: 'TRANSFERRED', action: 'DONE', lookupKind: 'CONFIRMED', ...options })
    const result = await executeClaimedPayout(db, identity, h.provider, h.complete, h.deps)
    assertEquals(result, { kind: 'BLOCKED', claimId: 'claim-one', reason: 'PROVIDER_IDENTITY_CONFLICT' })
    assertEquals(h.completed, [])
    assertEquals(h.blockedLate, ['claim-one'])
    assertEquals(h.lateConflicts, ['claim-one'])
  }
})

Deno.test('confirmed conflict cannot complete or queue a non-durable case if the claim block fails', async () => {
  const h = harness({ claimStatus: 'TRANSFERRED', action: 'DONE', lookupKind: 'CONFIRMED',
    verifyThrows: true, blockLateThrows: true })
  await assertRejects(() => executeClaimedPayout(db, identity, h.provider, h.complete, h.deps),
    Error, 'Durable claim block unavailable')
  assertEquals(h.completed, [])
  assertEquals(h.blockedLate, ['claim-one'])
  assertEquals(h.lateConflicts, [])
})

Deno.test('confirmed claim cannot complete if the late Ops case cannot be persisted', async () => {
  const h = harness({ claimStatus: 'TRANSFERRED', action: 'DONE', lookupKind: 'CONFIRMED',
    verifyThrows: true, lateConflictThrows: true })
  let message = ''
  try {
    await executeClaimedPayout(db, identity, h.provider, h.complete, h.deps)
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  assertEquals(message, 'Late conflict case unavailable')
  assertEquals(h.completed, [])
})

Deno.test('terminal failure cannot mint a second operation without reviewed recovery', async () => {
  const h = harness({ claimStatus: 'FAILED_RECONCILED' })
  const result = await executeClaimedPayout(db, identity, h.provider, h.complete, h.deps)
  assertEquals(result.kind, 'BLOCKED')
  assertEquals(h.calls, ['reserve'])
})

Deno.test('provider identity conflict records unknown evidence, queues Ops, and never completes', async () => {
  const h = harness({ verifyThrows: true })
  const result = await executeClaimedPayout(db, identity, h.provider, h.complete, h.deps)
  assertEquals(result, { kind: 'BLOCKED', claimId: 'claim-one', reason: 'PROVIDER_IDENTITY_CONFLICT' })
  assertEquals(h.recorded, [])
  assertEquals(h.conflicts, ['attempt-one'])
  assertEquals(h.completed, [])
})

Deno.test('atomic conflict block failure fails closed after provider identity conflict', async () => {
  const h = harness({ verifyThrows: true, blockThrows: true })
  let message = ''
  try {
    await executeClaimedPayout(db, identity, h.provider, h.complete, h.deps)
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  assertEquals(message, 'Atomic conflict block unavailable')
  assertEquals(h.recorded, [])
  assertEquals(h.completed, [])
})
