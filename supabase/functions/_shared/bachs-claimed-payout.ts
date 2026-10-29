import { bachsAmountMinor, getBachsClient } from './bachs.ts'
import {
  assertBachsTransferBalance,
  getBachsBalances,
  getBachsTransfer,
  listBachsTransfers,
  createBachsTransfer,
  type BachsBalances,
  type BachsTransfer,
} from './bachs-operations.ts'
import type { PayoutProviderOperation, ProviderAdapter, ProviderResult } from './claimed-payout-execution.ts'

export type BachsPayoutIdentity = {
  destinationAccountId: string
  amountMinor: number
  currency: string
  transferGroup: string
  description: string
  claimKey: string
}

export type BachsPayoutProviderDependencies = {
  getBalances: () => Promise<BachsBalances>
  createTransfer: (input: BachsPayoutIdentity & { idempotencyKey: string; operationNumber: number }) => Promise<BachsTransfer>
  retrieveTransfer: (transferId: string) => Promise<BachsTransfer>
  listTransfers: (input: { limit: number; offset: number; connectedAccountId: string }) => ReturnType<typeof listBachsTransfers>
}

const runtimeDependencies: BachsPayoutProviderDependencies = {
  getBalances: () => getBachsBalances(getBachsClient()),
  createTransfer: (input) => createBachsTransfer(getBachsClient(), {
    destinationAccountId: input.destinationAccountId,
    amountMinor: input.amountMinor,
    currency: input.currency,
    transferGroup: input.transferGroup,
    description: input.description,
    metadata: {
      drapeon_claim_key: input.claimKey,
      drapeon_operation_number: String(input.operationNumber),
    },
    idempotencyKey: input.idempotencyKey,
  }),
  retrieveTransfer: (id) => getBachsTransfer(getBachsClient(), id),
  listTransfers: (input) => listBachsTransfers(getBachsClient(), input),
}

const TRANSFER_LOOKUP_PAGE_SIZE = 100
const TRANSFER_LOOKUP_MAX_ROWS = 5_000

async function findTransferForClaim(
  identity: BachsPayoutIdentity,
  operationNumber: number,
  listTransfers: BachsPayoutProviderDependencies['listTransfers'],
  retrieveTransfer: BachsPayoutProviderDependencies['retrieveTransfer'],
): Promise<ProviderResult> {
  const candidates: BachsTransfer[] = []
  let total: number | null = null
  let offset = 0
  do {
    if (offset >= TRANSFER_LOOKUP_MAX_ROWS) {
      return { kind: 'UNKNOWN', evidence: { provider: 'BACHS', reason: 'transfer_search_limit_exceeded', scanned: offset } }
    }
    const limit = Math.min(TRANSFER_LOOKUP_PAGE_SIZE, TRANSFER_LOOKUP_MAX_ROWS - offset)
    const page = await listTransfers({
      limit,
      offset,
      connectedAccountId: identity.destinationAccountId,
    })
    if (total !== null && page.total !== total) {
      return { kind: 'UNKNOWN', evidence: { provider: 'BACHS', reason: 'transfer_search_changed_during_pagination', offset } }
    }
    if (page.offset !== offset || page.limit !== limit || page.total < offset + page.items.length) {
      return { kind: 'UNKNOWN', evidence: { provider: 'BACHS', reason: 'invalid_transfer_search_page', offset } }
    }
    total = page.total
    for (const transfer of page.items) {
      const matchesOperation = transfer.metadata?.drapeon_operation_number == null
        ? operationNumber === 1
        : Number(transfer.metadata.drapeon_operation_number) === operationNumber
      if (transfer.metadata?.drapeon_claim_key === identity.claimKey && matchesOperation) candidates.push(transfer)
    }
    if (candidates.length > 1) {
      return {
        kind: 'UNKNOWN',
        evidence: {
          provider: 'BACHS',
          reason: 'multiple_transfers_for_claim',
          matches: candidates.length,
          scanned: offset + page.items.length,
        },
      }
    }
    offset += page.items.length
    if (page.items.length === 0 && offset < total) {
      return { kind: 'UNKNOWN', evidence: { provider: 'BACHS', reason: 'incomplete_transfer_search', offset, total } }
    }
  } while (offset < (total ?? 0))

  if (candidates.length !== 1) {
    return {
      kind: 'UNKNOWN',
      evidence: {
        provider: 'BACHS',
        reason: candidates.length === 0 ? 'no_transfer_found_for_claim' : 'multiple_transfers_for_claim',
        matches: candidates.length,
        scanned: offset,
      },
    }
  }
  const transfer = await retrieveTransfer(candidates[0].id)
  if (transfer.id !== candidates[0].id) {
    return { kind: 'UNKNOWN', evidence: { provider: 'BACHS', reason: 'retrieved_transfer_id_mismatch' } }
  }
  return providerResult(transfer)
}

function providerResult(transfer: BachsTransfer): Extract<ProviderResult, { kind: 'CONFIRMED' | 'PENDING' }> {
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
  if (!/^[A-Z]{3}$/u.test(currency) || !identity.destinationAccountId.startsWith('acct_') ||
    !identity.transferGroup.trim() || !identity.claimKey.trim()) {
    throw new Error('Bachs payout identity is incomplete.')
  }

  const operationIdentity = (operation?: PayoutProviderOperation) => {
    if (!operation) {
      return { ...identity, operationNumber: 1 }
    }
    if (operation.provider !== 'BACHS' || !operation.destinationId.startsWith('acct_')
      || operation.currency.trim().toUpperCase() !== currency
      || operation.amount !== identity.amountMinor || operation.number < 1
      || !Number.isInteger(operation.number)) {
      throw new Error('Bachs provider operation does not match the frozen payout claim.')
    }
    return {
      ...identity,
      destinationAccountId: operation.destinationId,
      amountMinor: operation.amount,
      currency,
      operationNumber: operation.number,
    }
  }

  const verify = (result: ProviderResult, operation?: PayoutProviderOperation) => {
    if (result.kind === 'UNKNOWN') return
    const expected = operationIdentity(operation)
    const transfer = result.evidence.transfer as BachsTransfer | undefined
    if (!transfer || transfer.id !== result.transferId || !/^tr_[A-Za-z0-9_-]+$/u.test(transfer.id) ||
      transfer.destination !== expected.destinationAccountId ||
      transfer.currency.toUpperCase() !== currency ||
      bachsAmountMinor(transfer.amount, transfer.currency) !== identity.amountMinor ||
      transfer.transfer_group !== identity.transferGroup ||
      transfer.metadata?.drapeon_claim_key !== identity.claimKey ||
      (expected.operationNumber > 1
        && transfer.metadata?.drapeon_operation_number !== String(expected.operationNumber)) ||
      (expected.operationNumber === 1 && transfer.metadata?.drapeon_operation_number != null
        && transfer.metadata.drapeon_operation_number !== '1') ||
      (operation?.transferId != null && transfer.id !== operation.transferId) ||
      (transfer.status !== 'pending' && transfer.status !== 'paid')) {
      throw new Error('Bachs transfer evidence does not match the immutable payout claim.')
    }
    if ((result.kind === 'CONFIRMED') !== (transfer.status === 'paid')) {
      throw new Error('Bachs transfer status changed before payout finalization.')
    }
  }

  return {
    send: async (idempotencyKey, operation) => {
      const expected = operationIdentity(operation)
      if (operation && operation.idempotencyKey !== idempotencyKey) {
        throw new Error('Bachs provider operation key does not match the transfer request.')
      }
      const balances = await dependencies.getBalances()
      assertBachsTransferBalance(balances, { amountMinor: expected.amountMinor, currency })
      return providerResult(await dependencies.createTransfer({
        ...expected,
        currency,
        idempotencyKey,
        operationNumber: expected.operationNumber,
      }))
    },
    lookup: async (idempotencyKey, knownTransferId, operation) => {
      const expected = operationIdentity(operation)
      if (operation && operation.idempotencyKey !== idempotencyKey) {
        throw new Error('Bachs provider operation key does not match the lookup.')
      }
      // Idempotency responses expire after 24h. Recover a lost response only
      // through exact, provider-stored claim metadata; never repeat a POST.
      if (!knownTransferId) return await findTransferForClaim(expected, expected.operationNumber, dependencies.listTransfers, dependencies.retrieveTransfer)
      return providerResult(await dependencies.retrieveTransfer(knownTransferId))
    },
    verify,
  }
}
