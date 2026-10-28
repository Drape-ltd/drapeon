import { assertEquals, assertRejects, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  createStripeClaimedPayoutProvider,
  type StripePayoutIdentity,
  type StripePayoutProviderDependencies,
} from './stripe-claimed-payout.ts'
import type { PayoutProviderOperation } from './claimed-payout-execution.ts'
import type { StripeTransfer } from './stripe.ts'

const identity: StripePayoutIdentity = {
  destinationAccountId: 'acct_original',
  amountMinor: 4050,
  currency: 'GBP',
  transferGroup: 'order:qa-order',
  description: 'Drapeon QA tranche',
  claimKey: 'tranche:qa-tranche',
  orderId: 'qa-order',
  payoutId: 'qa-payout',
}

function transfer(overrides: Partial<StripeTransfer> = {}): StripeTransfer {
  return {
    id: 'tr_qa_1',
    amount: identity.amountMinor,
    currency: identity.currency.toLowerCase(),
    destination: identity.destinationAccountId,
    transfer_group: identity.transferGroup,
    metadata: {
      drapeon_claim_key: identity.claimKey,
      drapeon_operation_number: '1',
      drapeon_order_id: identity.orderId,
      drapeon_payout_id: identity.payoutId,
    },
    ...overrides,
  }
}

function operation(overrides: Partial<PayoutProviderOperation> = {}): PayoutProviderOperation {
  return {
    id: 'operation-2',
    number: 2,
    provider: 'STRIPE',
    destinationId: 'acct_replacement',
    currency: identity.currency,
    amount: identity.amountMinor,
    idempotencyKey: `${identity.claimKey}:op:2`,
    transferId: null,
    reviewedCorrectionId: 'correction-2',
    moneyDeskRequestId: 'money-desk-2',
    ...overrides,
  }
}

function harness(listPages: StripeTransfer[][] = []) {
  const calls: Array<{ name: string; input?: unknown }> = []
  const transfers = new Map<string, StripeTransfer>()
  const dependencies: StripePayoutProviderDependencies = {
    createTransfer: async (input) => {
      calls.push({ name: 'create', input })
      const value = transfer({
        destination: input.destinationAccountId,
        transfer_group: input.transferGroup,
        metadata: input.metadata,
      })
      transfers.set(value.id, value)
      return value
    },
    retrieveTransfer: async (id) => {
      calls.push({ name: 'retrieve', input: id })
      const value = transfers.get(id)
      if (!value) throw new Error('missing transfer')
      return value
    },
    listTransfers: async (input) => {
      calls.push({ name: 'list', input })
      const pageIndex = input.startingAfter ? 1 : 0
      return { data: listPages[pageIndex] ?? [], has_more: pageIndex < listPages.length - 1 }
    },
  }
  return { calls, transfers, provider: createStripeClaimedPayoutProvider(identity, dependencies) }
}

Deno.test('Stripe claimed transfer sends the numbered operation with the fixed key and claim metadata', async () => {
  const h = harness()
  const result = await h.provider.send(`${identity.claimKey}:op:2`, operation())
  assertEquals(result.kind, 'CONFIRMED')
  assertEquals(h.calls[0]?.name, 'create')
  const sent = h.calls[0]?.input as Record<string, unknown>
  assertEquals(sent.amount, identity.amountMinor)
  assertEquals(sent.currency, 'GBP')
  assertEquals(sent.destinationAccountId, 'acct_replacement')
  assertEquals(sent.idempotencyKey, `${identity.claimKey}:op:2`)
  assertEquals(sent.metadata, {
    drapeon_claim_key: identity.claimKey,
    drapeon_operation_number: '2',
    drapeon_order_id: identity.orderId,
    drapeon_payout_id: identity.payoutId,
  })
  h.provider.verify(result, operation())
})

Deno.test('Stripe claimed transfer rejects a mismatched idempotency key before calling Stripe', async () => {
  const h = harness()
  await assertRejects(
    () => h.provider.send('wrong-key', operation()),
    Error,
    'key does not match',
  )
  assertEquals(h.calls.length, 0)
})

Deno.test('Stripe reconciliation retrieves a known transfer and never lists or creates', async () => {
  const known = transfer({
    id: 'tr_known',
    destination: 'acct_replacement',
    metadata: {
      drapeon_claim_key: identity.claimKey,
      drapeon_operation_number: '2',
      drapeon_order_id: identity.orderId,
      drapeon_payout_id: identity.payoutId,
    },
  })
  const h = harness()
  h.transfers.set(known.id, known)
  const result = await h.provider.lookup(`${identity.claimKey}:op:2`, known.id, operation())
  assertEquals(result.kind, 'CONFIRMED')
  assertEquals(h.calls.map((call) => call.name), ['retrieve'])
  h.provider.verify(result, operation())
})

Deno.test('Stripe recovery searches by destination and transfer group then matches claim and operation metadata', async () => {
  const wrong = transfer({ id: 'tr_other', metadata: { drapeon_claim_key: 'other-claim', drapeon_operation_number: '2' } })
  const matching = transfer({
    id: 'tr_replacement',
    destination: 'acct_replacement',
    metadata: {
      drapeon_claim_key: identity.claimKey,
      drapeon_operation_number: '2',
      drapeon_order_id: identity.orderId,
      drapeon_payout_id: identity.payoutId,
    },
  })
  const h = harness([[wrong], [matching]])
  h.transfers.set(matching.id, matching)
  const result = await h.provider.lookup(`${identity.claimKey}:op:2`, null, operation())
  assertEquals(result.kind, 'CONFIRMED')
  assertEquals(h.calls.map((call) => call.name), ['list', 'list', 'retrieve'])
  assertEquals((h.calls[0]?.input as Record<string, unknown>).destinationAccountId, 'acct_replacement')
  assertEquals((h.calls[0]?.input as Record<string, unknown>).transferGroup, identity.transferGroup)
  h.provider.verify(result, operation())
})

Deno.test('Stripe recovery rejects ambiguous claim and operation matches without choosing one', async () => {
  const first = transfer({ id: 'tr_first' })
  const second = transfer({ id: 'tr_second' })
  const h = harness([[first, second]])
  const result = await h.provider.lookup(identity.claimKey, null)
  assertEquals(result.kind, 'UNKNOWN')
  assertEquals((result.evidence as Record<string, unknown>).reason, 'multiple_transfers_for_operation')
  assertEquals(h.calls.map((call) => call.name), ['list'])
})

Deno.test('Stripe claimed payout refuses reversed transfers as ordinary success', async () => {
  const h = harness()
  const result = await h.provider.send(identity.claimKey)
  const reversed = {
    ...result,
    evidence: { provider: 'STRIPE', transfer: transfer({ reversed: true, amount_reversed: identity.amountMinor }) },
  }
  assertThrows(() => h.provider.verify(reversed, undefined), Error, 'does not match')
})
