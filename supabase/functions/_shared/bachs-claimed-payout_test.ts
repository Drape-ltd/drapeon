import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  createBachsClaimedPayoutProvider,
  type BachsPayoutProviderDependencies,
} from './bachs-claimed-payout.ts'
import type { BachsBalances, BachsTransfer } from './bachs-operations.ts'

const identity = {
  destinationAccountId: 'acct_tailor1',
  amountMinor: 12500,
  currency: 'NGN',
  transferGroup: 'order:order1',
  description: 'Drapeon tailor earning',
  claimKey: 'tranche:tranche1',
}

const funded: BachsBalances = {
  account_id: 'acct_platform',
  balances: [{ currency: 'NGN', available_balance: '200.00', pending_balance: '50.00' }],
}

const transfer = (
  status: 'pending' | 'paid' = 'pending',
  overrides: Partial<BachsTransfer> = {},
): BachsTransfer => ({
  id: 'tr_transfer1',
  destination: identity.destinationAccountId,
  amount: '125.00',
  currency: 'NGN',
  status,
  transfer_group: identity.transferGroup,
  metadata: { drapeon_claim_key: identity.claimKey },
  ...overrides,
})

function deps(overrides: Partial<BachsPayoutProviderDependencies> = {}) {
  const calls: string[] = []
  const defaults: BachsPayoutProviderDependencies = {
    getBalances: async () => { calls.push('balance'); return funded },
    createTransfer: async (input) => {
      calls.push(`create:${input.idempotencyKey}`)
      return transfer()
    },
    retrieveTransfer: async (id) => { calls.push(`retrieve:${id}`); return transfer('paid') },
    listTransfers: async ({ limit, offset }) => { calls.push(`list:${offset}`); return { items: [], total: 0, limit, offset } },
  }
  return { calls, value: { ...defaults, ...overrides } }
}

Deno.test('Bachs transfer checks available balance then sends with the claim key', async () => {
  const mock = deps()
  const provider = createBachsClaimedPayoutProvider(identity, mock.value)
  const result = await provider.send('payout:order1:earning:v1')
  assertEquals(result.kind, 'PENDING')
  if (result.kind !== 'PENDING') throw new Error('Expected a pending Bachs transfer')
  assertEquals(result.transferId, 'tr_transfer1')
  assertEquals(mock.calls, ['balance', 'create:payout:order1:earning:v1'])
  provider.verify(result)
})

Deno.test('Bachs transfer does not post when available funds are insufficient', async () => {
  const mock = deps({
    getBalances: async () => { mock.calls.push('balance'); return { ...funded, balances: [{ currency: 'NGN', available_balance: '100.00', pending_balance: '1000.00' }] } },
  })
  const provider = createBachsClaimedPayoutProvider(identity, mock.value)
  await assertRejects(() => provider.send('payout:order1:earning:v1'), Error, 'insufficient')
  assertEquals(mock.calls, ['balance'])
})

Deno.test('negative balance in any currency blocks the transfer before POST', async () => {
  const mock = deps({
    getBalances: async () => { mock.calls.push('balance'); return { ...funded, balances: [
      { currency: 'NGN', available_balance: '10000.00', pending_balance: '0.00' },
      { currency: 'USD', available_balance: '-1.00', pending_balance: '0.00' },
    ] } },
  })
  const provider = createBachsClaimedPayoutProvider(identity, mock.value)
  await assertRejects(() => provider.send('payout:order1:earning:v1'), Error, 'negative balance')
  assertEquals(mock.calls, ['balance'])
})

Deno.test('uncertain send without a saved transfer ID performs a read and never creates another transfer', async () => {
  const mock = deps()
  const provider = createBachsClaimedPayoutProvider(identity, mock.value)
  const result = await provider.lookup('payout:order1:earning:v1', null)
  assertEquals(result, { kind: 'UNKNOWN', evidence: { provider: 'BACHS', reason: 'no_transfer_found_for_claim', matches: 0, scanned: 0 } })
  assertEquals(mock.calls, ['list:0'])
})

Deno.test('uncertain send recovers one exact transfer by immutable claim metadata', async () => {
  const mock = deps({
    listTransfers: async ({ limit, offset }) => {
      mock.calls.push(`list:${offset}`)
      return { items: offset === 0 ? [transfer('pending')] : [], total: 1, limit, offset }
    },
  })
  const provider = createBachsClaimedPayoutProvider(identity, mock.value)
  const result = await provider.lookup('payout:order1:earning:v1', null)
  assertEquals(result.kind, 'CONFIRMED')
  if (result.kind !== 'CONFIRMED') throw new Error('Expected exact saved transfer recovery')
  assertEquals(result.transferId, 'tr_transfer1')
  provider.verify(result)
  assertEquals(mock.calls, ['list:0', 'retrieve:tr_transfer1'])
})

Deno.test('replacement transfer uses its reviewed destination and operation-specific key', async () => {
  const replacementDestination = 'acct_tailor2'
  const replacementKey = `${identity.claimKey}:op:2`
  const mock = deps({
    createTransfer: async (input) => {
      mock.calls.push(`create:${input.idempotencyKey}:${input.destinationAccountId}:${input.operationNumber}`)
      return transfer('pending', {
        destination: replacementDestination,
        metadata: { drapeon_claim_key: identity.claimKey, drapeon_operation_number: '2' },
      })
    },
  })
  const provider = createBachsClaimedPayoutProvider(identity, mock.value)
  const operation = {
    id: 'operation-two', number: 2, provider: 'BACHS', destinationId: replacementDestination,
    currency: 'NGN', amount: identity.amountMinor, idempotencyKey: replacementKey,
    transferId: null, reviewedCorrectionId: 'correction-one', moneyDeskRequestId: 'request-one',
  }
  const result = await provider.send(replacementKey, operation)
  provider.verify(result, operation)
  assertEquals(result.kind, 'PENDING')
  assertEquals(mock.calls, ['balance', `create:${replacementKey}:${replacementDestination}:2`])
})

Deno.test('replacement lookup selects only the exact operation number', async () => {
  const replacementDestination = 'acct_tailor2'
  const replacementKey = `${identity.claimKey}:op:2`
  const mock = deps({
    listTransfers: async ({ limit, offset }) => {
      mock.calls.push(`list:${offset}`)
      return {
        items: offset === 0 ? [
          transfer('paid', { id: 'tr_old', metadata: { drapeon_claim_key: identity.claimKey, drapeon_operation_number: '1' } }),
          transfer('pending', { id: 'tr_new', destination: replacementDestination,
            metadata: { drapeon_claim_key: identity.claimKey, drapeon_operation_number: '2' } }),
        ] : [],
        total: 2, limit, offset,
      }
    },
    retrieveTransfer: async (id) => {
      mock.calls.push(`retrieve:${id}`)
      return transfer('paid', { id, destination: replacementDestination,
        metadata: { drapeon_claim_key: identity.claimKey, drapeon_operation_number: '2' } })
    },
  })
  const provider = createBachsClaimedPayoutProvider(identity, mock.value)
  const operation = {
    id: 'operation-two', number: 2, provider: 'BACHS', destinationId: replacementDestination,
    currency: 'NGN', amount: identity.amountMinor, idempotencyKey: replacementKey,
    transferId: null, reviewedCorrectionId: 'correction-one', moneyDeskRequestId: 'request-one',
  }
  const result = await provider.lookup(replacementKey, null, operation)
  assertEquals(result.kind, 'CONFIRMED')
  provider.verify(result, operation)
  assertEquals(result.kind === 'CONFIRMED' ? result.transferId : null, 'tr_new')
  assertEquals(mock.calls, ['list:0', 'retrieve:tr_new'])
})

Deno.test('uncertain send with multiple provider matches stays unknown', async () => {
  const second = { ...transfer('paid'), id: 'tr_transfer2' }
  const mock = deps({
    listTransfers: async ({ limit, offset }) => {
      mock.calls.push(`list:${offset}`)
      return { items: offset === 0 ? [transfer(), second] : [], total: 2, limit, offset }
    },
  })
  const provider = createBachsClaimedPayoutProvider(identity, mock.value)
  const result = await provider.lookup('payout:order1:earning:v1', null)
  assertEquals(result, { kind: 'UNKNOWN', evidence: { provider: 'BACHS', reason: 'multiple_transfers_for_claim', matches: 2, scanned: 2 } })
  assertEquals(mock.calls, ['list:0'])
})

Deno.test('transfer-list mutation during pagination cannot confirm a possibly duplicate transfer', async () => {
  const mock = deps({
    listTransfers: async ({ limit, offset }) => {
      mock.calls.push(`list:${offset}`)
      return offset === 0
        ? { items: [transfer(), ...Array.from({ length: 99 }, () => ({ ...transfer(), metadata: {} }))], total: 101, limit, offset }
        : { items: Array.from({ length: 2 }, () => ({ ...transfer(), metadata: {} })), total: 102, limit, offset }
    },
  })
  const provider = createBachsClaimedPayoutProvider(identity, mock.value)
  const result = await provider.lookup('payout:order1:earning:v1', null)
  assertEquals(result.kind, 'UNKNOWN')
  assertEquals((result as { evidence: Record<string, unknown> }).evidence.reason, 'transfer_search_changed_during_pagination')
  assertEquals(mock.calls, ['list:0', 'list:100'])
})

Deno.test('uncertain send does not infer absence from an incomplete transfer scan', async () => {
  const mock = deps({
    listTransfers: async ({ limit, offset }) => {
      mock.calls.push(`list:${offset}`)
      return { items: Array.from({ length: limit }, () => ({ ...transfer(), metadata: {} })), total: 6000, limit, offset }
    },
  })
  const provider = createBachsClaimedPayoutProvider(identity, mock.value)
  const result = await provider.lookup('payout:order1:earning:v1', null)
  assertEquals(result.kind, 'UNKNOWN')
  assertEquals((result as { evidence: Record<string, unknown> }).evidence.reason, 'transfer_search_limit_exceeded')
  assertEquals(mock.calls.length, 50)
  assertEquals(mock.calls.at(-1), 'list:4900')
})

Deno.test('saved transfer is retrieved and remains pending until Bachs reports paid', async () => {
  const mock = deps({ retrieveTransfer: async (id) => { mock.calls.push(`retrieve:${id}`); return transfer('pending') } })
  const provider = createBachsClaimedPayoutProvider(identity, mock.value)
  const result = await provider.lookup('payout:order1:earning:v1', 'tr_transfer1')
  assertEquals(result.kind, 'PENDING')
  provider.verify(result)
  assertEquals(mock.calls, ['retrieve:tr_transfer1'])
})

Deno.test('a paid transfer is confirmed, and mismatched transfer identity is rejected', async () => {
  const mock = deps()
  const provider = createBachsClaimedPayoutProvider(identity, mock.value)
  const result = await provider.lookup('payout:order1:earning:v1', 'tr_transfer1')
  assertEquals(result.kind, 'CONFIRMED')
  provider.verify(result)
  const wrong = { ...result, evidence: { ...result.evidence, transfer: { ...transfer('paid'), amount: '124.99' } } }
  await assertRejects(async () => provider.verify(wrong), Error, 'does not match')
  const missingClaim = { ...result, evidence: { ...result.evidence, transfer: { ...transfer('paid'), metadata: {} } } }
  await assertRejects(async () => provider.verify(missingClaim), Error, 'does not match')
})
