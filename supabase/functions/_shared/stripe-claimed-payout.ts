import {
  createStripeTransfer,
  listStripeTransfers,
  retrieveStripeTransfer,
  type StripeTransfer,
  type StripeTransferList,
} from './stripe.ts'
import type { PayoutProviderOperation, ProviderAdapter, ProviderResult } from './claimed-payout-execution.ts'

export type StripePayoutIdentity = {
  destinationAccountId: string
  amountMinor: number
  currency: string
  transferGroup: string
  description: string
  claimKey: string
  orderId: string
  payoutId: string
}

export type StripePayoutProviderDependencies = {
  createTransfer: typeof createStripeTransfer
  retrieveTransfer: typeof retrieveStripeTransfer
  listTransfers: typeof listStripeTransfers
}

const runtimeDependencies: StripePayoutProviderDependencies = {
  createTransfer: createStripeTransfer,
  retrieveTransfer: retrieveStripeTransfer,
  listTransfers: listStripeTransfers,
}

const LIST_PAGE_SIZE = 100
const LIST_MAX_ROWS = 5_000

function result(transfer: StripeTransfer): ProviderResult {
  return { kind: 'CONFIRMED', transferId: transfer.id, evidence: { provider: 'STRIPE', transfer } }
}

async function findTransferForOperation(
  identity: StripePayoutIdentity,
  operationNumber: number,
  dependencies: StripePayoutProviderDependencies,
): Promise<ProviderResult> {
  const matches: StripeTransfer[] = []
  let startingAfter: string | null = null
  let scanned = 0

  do {
    if (scanned >= LIST_MAX_ROWS) {
      return { kind: 'UNKNOWN', evidence: { provider: 'STRIPE', reason: 'transfer_search_limit_exceeded', scanned } }
    }
    const limit = Math.min(LIST_PAGE_SIZE, LIST_MAX_ROWS - scanned)
    const page: StripeTransferList = await dependencies.listTransfers({
      destinationAccountId: identity.destinationAccountId,
      transferGroup: identity.transferGroup,
      limit,
      startingAfter,
    })
    if (!Array.isArray(page.data) || typeof page.has_more !== 'boolean' || page.data.length > limit) {
      return { kind: 'UNKNOWN', evidence: { provider: 'STRIPE', reason: 'invalid_transfer_search_page', scanned } }
    }
    for (const transfer of page.data) {
      const metadataOperation = transfer.metadata?.drapeon_operation_number
      const operationMatches = metadataOperation == null
        ? operationNumber === 1
        : metadataOperation === String(operationNumber)
      if (transfer.metadata?.drapeon_claim_key === identity.claimKey && operationMatches) {
        matches.push(transfer)
      }
    }
    if (matches.length > 1) {
      return { kind: 'UNKNOWN', evidence: { provider: 'STRIPE', reason: 'multiple_transfers_for_operation', matches: matches.length, scanned: scanned + page.data.length } }
    }
    scanned += page.data.length
    if (page.has_more && page.data.length === 0) {
      return { kind: 'UNKNOWN', evidence: { provider: 'STRIPE', reason: 'incomplete_transfer_search_page', scanned } }
    }
    startingAfter = page.data.at(-1)?.id ?? null
    if (page.has_more && !startingAfter) {
      return { kind: 'UNKNOWN', evidence: { provider: 'STRIPE', reason: 'missing_transfer_cursor', scanned } }
    }
    if (!page.has_more) break
  } while (true)

  if (matches.length !== 1) {
    return { kind: 'UNKNOWN', evidence: { provider: 'STRIPE', reason: 'no_transfer_found_for_operation', matches: matches.length, scanned } }
  }
  const transfer = await dependencies.retrieveTransfer(matches[0].id)
  if (transfer.id !== matches[0].id) {
    return { kind: 'UNKNOWN', evidence: { provider: 'STRIPE', reason: 'retrieved_transfer_id_mismatch' } }
  }
  return result(transfer)
}

export function createStripeClaimedPayoutProvider(
  identity: StripePayoutIdentity,
  dependencies: StripePayoutProviderDependencies = runtimeDependencies,
): ProviderAdapter {
  if (!Number.isSafeInteger(identity.amountMinor) || identity.amountMinor <= 0
    || !identity.destinationAccountId.trim() || !identity.transferGroup.trim()
    || !identity.claimKey.trim() || !identity.orderId.trim() || !identity.payoutId.trim()) {
    throw new Error('Stripe payout claim identity is incomplete.')
  }
  const currency = identity.currency.trim().toUpperCase()
  if (!/^[A-Z]{3}$/u.test(currency)) throw new Error('Stripe payout currency is invalid.')

  const operationIdentity = (operation?: PayoutProviderOperation) => {
    if (!operation) return { ...identity, operationNumber: 1 }
    if (operation.provider !== 'STRIPE' || operation.destinationId.trim() === ''
      || operation.currency.trim().toUpperCase() !== currency
      || operation.amount !== identity.amountMinor || !Number.isInteger(operation.number)
      || operation.number < 1) {
      throw new Error('Stripe provider operation does not match the frozen payout claim.')
    }
    return {
      ...identity,
      destinationAccountId: operation.destinationId,
      amountMinor: operation.amount,
      currency,
      operationNumber: operation.number,
    }
  }

  const verify = (providerResult: ProviderResult, operation?: PayoutProviderOperation) => {
    if (providerResult.kind === 'UNKNOWN') return
    const expected = operationIdentity(operation)
    const transfer = providerResult.evidence.transfer as StripeTransfer | undefined
    if (!transfer || transfer.id !== providerResult.transferId || !/^tr_[A-Za-z0-9_-]+$/u.test(transfer.id)
      || transfer.destination !== expected.destinationAccountId
      || transfer.amount !== expected.amountMinor
      || transfer.currency?.toUpperCase() !== currency
      || transfer.transfer_group !== expected.transferGroup
      || transfer.metadata?.drapeon_claim_key !== identity.claimKey
      || transfer.metadata?.drapeon_order_id !== identity.orderId
      || transfer.metadata?.drapeon_payout_id !== identity.payoutId
      || (expected.operationNumber > 1
        && transfer.metadata?.drapeon_operation_number !== String(expected.operationNumber))
      || (expected.operationNumber === 1 && transfer.metadata?.drapeon_operation_number != null
        && transfer.metadata.drapeon_operation_number !== '1')
      || transfer.reversed === true || (transfer.amount_reversed ?? 0) > 0
      || (operation?.transferId != null && transfer.id !== operation.transferId)) {
      throw new Error('Stripe transfer evidence does not match the immutable payout operation.')
    }
  }

  return {
    send: async (idempotencyKey, operation) => {
      const expected = operationIdentity(operation)
      if (operation && operation.idempotencyKey !== idempotencyKey) {
        throw new Error('Stripe provider operation key does not match the transfer request.')
      }
      return result(await dependencies.createTransfer({
        amount: expected.amountMinor,
        currency,
        destinationAccountId: expected.destinationAccountId,
        idempotencyKey,
        transferGroup: expected.transferGroup,
        metadata: {
          drapeon_claim_key: identity.claimKey,
          drapeon_operation_number: String(expected.operationNumber),
          drapeon_order_id: identity.orderId,
          drapeon_payout_id: identity.payoutId,
        },
      }))
    },
    lookup: async (idempotencyKey, knownTransferId, operation) => {
      const expected = operationIdentity(operation)
      if (operation && operation.idempotencyKey !== idempotencyKey) {
        throw new Error('Stripe provider operation key does not match the transfer lookup.')
      }
      if (!knownTransferId) return findTransferForOperation(expected, expected.operationNumber, dependencies)
      const transfer = await dependencies.retrieveTransfer(knownTransferId)
      if (transfer.id !== knownTransferId) {
        return { kind: 'UNKNOWN', evidence: { provider: 'STRIPE', reason: 'retrieved_transfer_id_mismatch' } }
      }
      return result(transfer)
    },
    verify,
  }
}
