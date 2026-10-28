import { bachsAmountMinor, getBachsClient } from './bachs.ts'
import {
  assertBachsTransferBalance,
  getBachsBalances,
  getBachsTransfer,
  createBachsTransfer,
  type BachsBalances,
  type BachsTransfer,
} from './bachs-operations.ts'
import type { ProviderAdapter, ProviderResult } from './claimed-payout-execution.ts'

export type BachsPayoutIdentity = {
  destinationAccountId: string
  amountMinor: number
  currency: string
  transferGroup: string
  description: string
}

export type BachsPayoutProviderDependencies = {
  getBalances: () => Promise<BachsBalances>
  createTransfer: (input: BachsPayoutIdentity & { idempotencyKey: string }) => Promise<BachsTransfer>
  retrieveTransfer: (transferId: string) => Promise<BachsTransfer>
}

const runtimeDependencies: BachsPayoutProviderDependencies = {
  getBalances: () => getBachsBalances(getBachsClient()),
  createTransfer: (input) => createBachsTransfer(getBachsClient(), {
    destinationAccountId: input.destinationAccountId,
    amountMinor: input.amountMinor,
    currency: input.currency,
    transferGroup: input.transferGroup,
    description: input.description,
    idempotencyKey: input.idempotencyKey,
  }),
  retrieveTransfer: (id) => getBachsTransfer(getBachsClient(), id),
}

type BachsTransferLookup = Extract<ProviderResult, { kind: 'CONFIRMED' | 'PENDING' }>

function providerResult(transfer: BachsTransfer): BachsTransferLookup {
  const evidence = { provider: 'BACHS', transfer }
  return transfer.status === 'paid'
    ? { kind: 'CONFIRMED', transferId: transfer.id, evidence }
    : { kind: 'PENDING', transferId: transfer.id, evidence }
}

export function createBachsClaimedPayoutProvider(
  identity: BachsPayoutIdentity,
  dependencies: BachsPayoutProviderDependencies = runtimeDependencies,
): ProviderAdapter {
  if (!Number.isSafeInteger(identity.amountMinor) || identity.amountMinor <= 0) {
    throw new Error('Bachs payout amount must be a positive minor-unit integer.')
  }
  const currency = identity.currency.trim().toUpperCase()
  if (!/^[A-Z]{3}$/u.test(currency) || !identity.destinationAccountId.startsWith('acct_') || !identity.transferGroup.trim()) {
    throw new Error('Bachs payout identity is incomplete.')
  }

  const verify = (result: ProviderResult) => {
    if (result.kind === 'UNKNOWN') return
    const transfer = result.evidence.transfer as BachsTransfer | undefined
    if (!transfer || transfer.id !== result.transferId || !/^tr_[A-Za-z0-9_-]+$/u.test(transfer.id) ||
      transfer.destination !== identity.destinationAccountId ||
      transfer.currency.toUpperCase() !== currency ||
      bachsAmountMinor(transfer.amount, transfer.currency) !== identity.amountMinor ||
      transfer.transfer_group !== identity.transferGroup ||
      (transfer.status !== 'pending' && transfer.status !== 'paid')) {
      throw new Error('Bachs transfer evidence does not match the immutable payout claim.')
    }
    if ((result.kind === 'CONFIRMED') !== (transfer.status === 'paid')) {
      throw new Error('Bachs transfer status changed before payout finalization.')
    }
  }

  return {
    send: async (idempotencyKey) => {
      const balances = await dependencies.getBalances()
      assertBachsTransferBalance(balances, { amountMinor: identity.amountMinor, currency })
      return providerResult(await dependencies.createTransfer({
        ...identity,
        currency,
        idempotencyKey,
      }))
    },
    lookup: async (_idempotencyKey, knownTransferId) => {
      // Bachs has no documented lookup-by-idempotency-key endpoint. Never
      // re-POST an uncertain transfer when its provider ID was not persisted.
      if (!knownTransferId) {
        return { kind: 'UNKNOWN', evidence: { provider: 'BACHS', reason: 'transfer_id_not_persisted' } }
      }
      return providerResult(await dependencies.retrieveTransfer(knownTransferId))
    },
    verify,
  }
}
