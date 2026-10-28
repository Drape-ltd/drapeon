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
}

const funded: BachsBalances = {
  account_id: 'acct_platform',
  balances: [{ currency: 'NGN', available_balance: '200.00', pending_balance: '50.00' }],
}

const transfer = (status: 'pending' | 'paid' = 'pending'): BachsTransfer => ({
  id: 'tr_transfer1',
  destination: identity.destinationAccountId,
  amount: '125.00',
  currency: 'NGN',
  status,
  transfer_group: identity.transferGroup,
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

Deno.test('uncertain send without a saved transfer ID is unknown and never creates another transfer', async () => {
  const mock = deps()
  const provider = createBachsClaimedPayoutProvider(identity, mock.value)
  const result = await provider.lookup('payout:order1:earning:v1', null)
  assertEquals(result, { kind: 'UNKNOWN', evidence: { provider: 'BACHS', reason: 'transfer_id_not_persisted' } })
  assertEquals(mock.calls, [])
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
})
