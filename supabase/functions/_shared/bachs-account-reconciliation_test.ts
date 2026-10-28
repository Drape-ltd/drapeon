import { assertEquals } from 'jsr:@std/assert@1'
import {
  buildBachsExpectedTransfers,
  compareBachsAccountBalance as compareBachsAccountBalanceRaw,
  reconcileBachsConnectedAccountBalance,
} from './bachs-account-reconciliation.ts'
import type {
  BachsExpectedTransfer,
  BachsRecordedWithdrawal,
} from './bachs-account-reconciliation.ts'
import type { BachsBalances, BachsPayout, BachsTransfer } from './bachs-operations.ts'

const accountId = 'acct_tailor1'
const emptyBalances: BachsBalances = { account_id: accountId, balances: [] }
const expectedTransfer: BachsExpectedTransfer = {
  claimId: 'claim_1',
  operationNumber: 1,
  provider: 'BACHS',
  providerDestinationId: accountId,
  currency: 'NGN',
  amountMinor: 5000,
  claimStatus: 'TRANSFERRED',
  operationStatus: 'TRANSFERRED',
  claimProviderTransferId: 'tr_earning1',
  operationProviderTransferId: 'tr_earning1',
  payoutLedgerTransactionId: 'ledger_1',
}
const recordedWithdrawal: BachsRecordedWithdrawal = {
  payoutId: 'pay_withdrawal1',
  amountMinor: 1000,
  currency: 'NGN',
  status: 'PAID',
  occurredAt: '2026-10-28T10:01:00.000Z',
  processedAt: '2026-10-28T10:01:01.000Z',
}

Deno.test(
  'account reconciliation follows an audited replacement destination under the same earning claim',
  () => {
    const result = buildBachsExpectedTransfers({
      accountId: 'acct_replacement',
      claims: [
        {
          id: 'claim_1',
          provider: 'BACHS',
          provider_destination_id: 'acct_original',
          currency: 'NGN',
          amount: 5000,
          status: 'TRANSFERRED',
          provider_transfer_id: 'tr_replacement',
          payout_ledger_transaction_id: 'ledger_1',
        },
      ],
      operations: [
        {
          id: 'operation_2',
          claim_id: 'claim_1',
          operation_number: 2,
          provider: 'BACHS',
          provider_destination_id: 'acct_replacement',
          currency: 'NGN',
          amount: 5000,
          status: 'TRANSFERRED',
          provider_transfer_id: 'tr_replacement',
          reviewed_correction_id: 'correction_1',
          money_desk_request_id: 'request_1',
        },
      ],
      corrections: [
        {
          id: 'correction_1',
          claim_id: 'claim_1',
          operation_number: 2,
          money_desk_request_id: 'request_1',
          previous_destination_id: 'destination_1',
          replacement_destination_id: 'destination_2',
          correction_transaction_id: 123,
        },
      ],
      destinations: [
        { id: 'destination_1', provider: 'BACHS', provider_account_ref: 'acct_original' },
        { id: 'destination_2', provider: 'BACHS', provider_account_ref: 'acct_replacement' },
      ],
    })
    assertEquals(result, {
      expectedTransfers: [
        {
          claimId: 'claim_1',
          operationNumber: 2,
          provider: 'BACHS',
          providerDestinationId: 'acct_replacement',
          currency: 'NGN',
          amountMinor: 5000,
          claimStatus: 'TRANSFERRED',
          operationStatus: 'TRANSFERRED',
          claimProviderTransferId: 'tr_replacement',
          operationProviderTransferId: 'tr_replacement',
          payoutLedgerTransactionId: 'ledger_1',
        },
      ],
    })
  }
)

Deno.test('fully returned original transfer is excluded only with terminal return evidence', () => {
  const result = buildBachsExpectedTransfers({
    accountId: 'acct_original',
    claims: [
      {
        id: 'claim_1',
        provider: 'BACHS',
        provider_destination_id: 'acct_original',
        currency: 'NGN',
        amount: 5000,
        status: 'TRANSFERRED',
        provider_transfer_id: 'tr_replacement',
        payout_ledger_transaction_id: 'ledger_1',
      },
    ],
    operations: [
      {
        id: 'operation_1',
        claim_id: 'claim_1',
        operation_number: 1,
        provider: 'BACHS',
        provider_destination_id: 'acct_original',
        currency: 'NGN',
        amount: 5000,
        status: 'FAILED_RETURNED',
        provider_transfer_id: 'tr_original',
        final_failure_reference: 'failed-final',
        funds_return_reference: 'returned-final',
        funds_return_confirmed_at: '2026-10-28T12:00:00.000Z',
      },
    ],
    corrections: [],
    destinations: [],
  })
  assertEquals(result, { expectedTransfers: [] })
})

Deno.test('returned operation without funds-back evidence remains unreconciled', () => {
  const result = buildBachsExpectedTransfers({
    accountId: 'acct_original',
    claims: [
      {
        id: 'claim_1',
        provider: 'BACHS',
        provider_destination_id: 'acct_original',
        currency: 'NGN',
        amount: 5000,
        status: 'TRANSFERRED',
        provider_transfer_id: 'tr_original',
        payout_ledger_transaction_id: 'ledger_1',
      },
    ],
    operations: [
      {
        claim_id: 'claim_1',
        operation_number: 1,
        provider: 'BACHS',
        provider_destination_id: 'acct_original',
        currency: 'NGN',
        amount: 5000,
        status: 'FAILED_RETURNED',
        final_failure_reference: 'failed-final',
      },
    ],
    corrections: [],
    destinations: [],
  })
  assertEquals(result, { incomplete: 'drapeon_returned_operation_evidence_missing' })
})

Deno.test('replacement transfer requires its correction row to match claim and account', () => {
  const result = buildBachsExpectedTransfers({
    accountId: 'acct_replacement',
    claims: [
      {
        id: 'claim_1',
        provider: 'BACHS',
        provider_destination_id: 'acct_original',
        currency: 'NGN',
        amount: 5000,
        status: 'TRANSFERRED',
        provider_transfer_id: 'tr_original',
        payout_ledger_transaction_id: 'ledger_1',
      },
    ],
    operations: [
      {
        claim_id: 'claim_1',
        operation_number: 2,
        provider: 'BACHS',
        provider_destination_id: 'acct_replacement',
        currency: 'NGN',
        amount: 5000,
        status: 'TRANSFERRED',
        reviewed_correction_id: 'wrong-correction',
        money_desk_request_id: 'request_1',
      },
    ],
    corrections: [],
    destinations: [],
  })
  assertEquals(result, { incomplete: 'drapeon_reviewed_replacement_identity_mismatch' })
})

Deno.test('second reviewed replacement must continue the prior correction chain', () => {
  const result = buildBachsExpectedTransfers({
    accountId: 'acct_replacement_3',
    claims: [
      {
        id: 'claim_1',
        provider: 'BACHS',
        provider_destination_id: 'acct_original',
        currency: 'NGN',
        amount: 5000,
        status: 'TRANSFERRED',
        provider_transfer_id: 'tr_replacement_3',
        payout_ledger_transaction_id: 'ledger_1',
      },
    ],
    operations: [
      {
        id: 'operation_3',
        claim_id: 'claim_1',
        operation_number: 3,
        provider: 'BACHS',
        provider_destination_id: 'acct_replacement_3',
        currency: 'NGN',
        amount: 5000,
        status: 'TRANSFERRED',
        provider_transfer_id: 'tr_replacement_3',
        reviewed_correction_id: 'correction_3',
        money_desk_request_id: 'request_3',
      },
    ],
    corrections: [
      {
        id: 'correction_2',
        claim_id: 'claim_1',
        operation_number: 2,
        money_desk_request_id: 'request_2',
        previous_destination_id: 'destination_1',
        replacement_destination_id: 'destination_2',
        correction_transaction_id: 122,
      },
      {
        id: 'correction_3',
        claim_id: 'claim_1',
        operation_number: 3,
        money_desk_request_id: 'request_3',
        previous_destination_id: 'destination_2',
        replacement_destination_id: 'destination_3',
        correction_transaction_id: 123,
      },
    ],
    destinations: [
      { id: 'destination_1', provider: 'BACHS', provider_account_ref: 'acct_original' },
      { id: 'destination_2', provider: 'BACHS', provider_account_ref: 'acct_replacement_2' },
      { id: 'destination_3', provider: 'BACHS', provider_account_ref: 'acct_replacement_3' },
    ],
  })
  assertEquals('incomplete' in result, false)
})

Deno.test('replacement transfer fails closed if its predecessor destination does not match', () => {
  const result = buildBachsExpectedTransfers({
    accountId: 'acct_replacement_3',
    claims: [
      {
        id: 'claim_1',
        provider: 'BACHS',
        provider_destination_id: 'acct_original',
        currency: 'NGN',
        amount: 5000,
        status: 'TRANSFERRED',
        provider_transfer_id: 'tr_replacement_3',
        payout_ledger_transaction_id: 'ledger_1',
      },
    ],
    operations: [
      {
        id: 'operation_3',
        claim_id: 'claim_1',
        operation_number: 3,
        provider: 'BACHS',
        provider_destination_id: 'acct_replacement_3',
        currency: 'NGN',
        amount: 5000,
        status: 'TRANSFERRED',
        provider_transfer_id: 'tr_replacement_3',
        reviewed_correction_id: 'correction_3',
        money_desk_request_id: 'request_3',
      },
    ],
    corrections: [
      {
        id: 'correction_2',
        claim_id: 'claim_1',
        operation_number: 2,
        money_desk_request_id: 'request_2',
        previous_destination_id: 'destination_1',
        replacement_destination_id: 'destination_2',
        correction_transaction_id: 122,
      },
      {
        id: 'correction_3',
        claim_id: 'claim_1',
        operation_number: 3,
        money_desk_request_id: 'request_3',
        previous_destination_id: 'destination_wrong',
        replacement_destination_id: 'destination_3',
        correction_transaction_id: 123,
      },
    ],
    destinations: [
      { id: 'destination_1', provider: 'BACHS', provider_account_ref: 'acct_original' },
      { id: 'destination_2', provider: 'BACHS', provider_account_ref: 'acct_replacement_2' },
      { id: 'destination_3', provider: 'BACHS', provider_account_ref: 'acct_replacement_3' },
      { id: 'destination_wrong', provider: 'BACHS', provider_account_ref: 'acct_wrong' },
    ],
  })
  assertEquals(result, { incomplete: 'drapeon_reviewed_replacement_identity_mismatch' })
})

function compareBachsAccountBalance(
  input: Partial<Parameters<typeof compareBachsAccountBalanceRaw>[0]> & { accountId?: string } = {}
) {
  return compareBachsAccountBalanceRaw({
    accountId,
    balances: emptyBalances,
    transfers: [],
    payouts: [],
    expectedTransfers: [expectedTransfer],
    recordedWithdrawals: [],
    ...input,
  })
}

Deno.test('Bachs account balance reconciles paid transfers and withdrawal total debit', () => {
  const result = compareBachsAccountBalance({
    accountId,
    balances: {
      account_id: accountId,
      balances: [
        {
          currency: 'NGN',
          available_balance: '39.50',
          pending_balance: '0.00',
        },
      ],
    },
    transfers: [
      {
        id: 'tr_earning1',
        source: 'acct_platform',
        destination: accountId,
        amount: '50.00',
        currency: 'NGN',
        status: 'paid',
        kind: 'manual',
      },
    ],
    payouts: [
      {
        id: 'pay_withdrawal1',
        status: 'completed',
        amount: '10.00',
        currency: 'NGN',
        source_currency: 'NGN',
        fee: '0.50',
        total_debited: '10.50',
      },
    ],
    recordedWithdrawals: [recordedWithdrawal],
  })
  assertEquals(result, { status: 'MATCHED', checkedCurrencies: 1 })
})

Deno.test('pending transfers do not count before Bachs moves both balances', () => {
  const result = compareBachsAccountBalance({
    accountId,
    balances: emptyBalances,
    transfers: [
      {
        id: 'tr_pending1',
        source: 'acct_platform',
        destination: accountId,
        amount: '10.00',
        currency: 'NGN',
        status: 'pending',
        kind: 'manual',
      },
    ],
    payouts: [],
    expectedTransfers: [
      {
        ...expectedTransfer,
        operationStatus: 'PROVIDER_PENDING',
        claimStatus: 'PROVIDER_PENDING',
        claimProviderTransferId: null,
        operationProviderTransferId: null,
        payoutLedgerTransactionId: null,
      },
    ],
  })
  assertEquals(result, { status: 'INCOMPLETE', reason: 'drapeon_payout_operation_unresolved' })
})

Deno.test('failed payout balance return is not assumed without provider confirmation', () => {
  const payout: BachsPayout = {
    id: 'pay_failed1',
    status: 'failed',
    amount: '10.00',
    currency: 'NGN',
    source_currency: 'NGN',
    fee: '0.50',
    total_debited: '10.50',
  }
  const result = compareBachsAccountBalance({
    accountId,
    balances: {
      account_id: accountId,
      balances: [
        {
          currency: 'NGN',
          available_balance: '50.00',
          pending_balance: '0.00',
        },
      ],
    },
    transfers: [
      {
        id: 'tr_earning1',
        source: 'acct_platform',
        destination: accountId,
        amount: '50.00',
        currency: 'NGN',
        status: 'paid',
        kind: 'manual',
      },
    ],
    payouts: [payout],
  })
  assertEquals(result, {
    status: 'INCOMPLETE',
    reason: 'failed_payout_balance_effect_unconfirmed',
  })
})

Deno.test('balance mismatch is returned as an exact per-currency Ops signal', () => {
  const result = compareBachsAccountBalance({
    accountId,
    balances: {
      account_id: accountId,
      balances: [
        {
          currency: 'NGN',
          available_balance: '51.00',
          pending_balance: '0.00',
        },
      ],
    },
    transfers: [
      {
        id: 'tr_earning1',
        source: 'acct_platform',
        destination: accountId,
        amount: '50.00',
        currency: 'NGN',
        status: 'paid',
        kind: 'manual',
      },
    ],
    payouts: [],
  })
  assertEquals(result, {
    status: 'MISMATCH',
    checkedCurrencies: 1,
    differences: [
      {
        currency: 'NGN',
        expectedMinor: 5000,
        providerMinor: 5100,
        differenceMinor: 100,
      },
    ],
    transferDiscrepancies: {
      unmatchedProviderTransfers: 0,
      missingProviderTransfers: 0,
      identityMismatches: 0,
    },
    withdrawalDiscrepancies: {
      missingRecordedEvents: 0,
      orphanRecordedEvents: 0,
      identityMismatches: 0,
    },
  })
})

Deno.test('unknown movement fields fail closed instead of manufacturing a balance', () => {
  const result = compareBachsAccountBalance({
    accountId,
    balances: emptyBalances,
    transfers: [],
    payouts: [
      {
        id: 'pay_pending1',
        status: 'pending',
        amount: '10.00',
        currency: 'NGN',
        source_currency: 'NGN',
        fee: null,
        total_debited: null,
      },
    ],
  })
  assertEquals(result, {
    status: 'INCOMPLETE',
    reason: 'payout_debit_missing',
  })
})

Deno.test('account mismatch and duplicate transfer IDs are rejected', () => {
  assertEquals(
    compareBachsAccountBalance({
      accountId,
      balances: { account_id: 'acct_other', balances: [] },
      transfers: [],
      payouts: [],
    }),
    { status: 'INCOMPLETE', reason: 'account_identity_mismatch' }
  )

  const transfer: BachsTransfer = {
    id: 'tr_duplicate',
    source: 'acct_platform',
    destination: accountId,
    amount: '1.00',
    currency: 'NGN',
    status: 'paid',
    kind: 'manual',
  }
  assertEquals(
    compareBachsAccountBalance({
      accountId,
      balances: emptyBalances,
      transfers: [transfer, transfer],
      payouts: [],
    }),
    { status: 'INCOMPLETE', reason: 'transfer_identity_invalid' }
  )
})

Deno.test(
  'account reconciliation matches Drapeon payout ledger and cross-currency withdrawal debit',
  () => {
    const result = compareBachsAccountBalance({
      accountId,
      balances: {
        account_id: accountId,
        balances: [
          {
            currency: 'USD',
            available_balance: '50.00',
            pending_balance: '0.00',
          },
        ],
      },
      transfers: [
        {
          id: 'tr_incoming',
          source: 'acct_platform',
          destination: accountId,
          amount: '100.00',
          currency: 'USD',
          status: 'paid',
          kind: 'manual',
        },
      ],
      payouts: [
        {
          id: 'pay_cross_currency',
          status: 'completed',
          amount: '50000.00',
          currency: 'NGN',
          source_currency: 'USD',
          fee: '2.00',
          total_debited: '50.00',
        },
      ],
      expectedTransfers: [
        {
          ...expectedTransfer,
          currency: 'USD',
          amountMinor: 10000,
          claimProviderTransferId: 'tr_incoming',
          operationProviderTransferId: 'tr_incoming',
        },
      ],
      recordedWithdrawals: [
        {
          ...recordedWithdrawal,
          payoutId: 'pay_cross_currency',
          amountMinor: 5000000,
          currency: 'NGN',
        },
      ],
    })
    assertEquals(result, { status: 'MATCHED', checkedCurrencies: 1 })
  }
)

Deno.test('unlinked provider transfers are not mistaken for Drapeon earnings', () => {
  const result = compareBachsAccountBalanceRaw({
    accountId,
    balances: {
      account_id: accountId,
      balances: [{ currency: 'NGN', available_balance: '50.00', pending_balance: '0.00' }],
    },
    transfers: [
      {
        id: 'tr_unlinked',
        source: 'acct_platform',
        destination: accountId,
        amount: '50.00',
        currency: 'NGN',
        status: 'paid',
        kind: 'manual',
      },
    ],
    payouts: [],
    expectedTransfers: [],
    recordedWithdrawals: [],
  })
  assertEquals(result, {
    status: 'MISMATCH',
    checkedCurrencies: 1,
    differences: [
      { currency: 'NGN', expectedMinor: 0, providerMinor: 5000, differenceMinor: 5000 },
    ],
    transferDiscrepancies: {
      unmatchedProviderTransfers: 1,
      missingProviderTransfers: 0,
      identityMismatches: 0,
    },
    withdrawalDiscrepancies: {
      missingRecordedEvents: 0,
      orphanRecordedEvents: 0,
      identityMismatches: 0,
    },
  })
})

Deno.test('a Drapeon-confirmed transfer missing from Bachs movement history is visible', () => {
  const result = compareBachsAccountBalanceRaw({
    accountId,
    balances: emptyBalances,
    transfers: [],
    payouts: [],
    expectedTransfers: [expectedTransfer],
    recordedWithdrawals: [],
  })
  assertEquals(result, {
    status: 'MISMATCH',
    checkedCurrencies: 1,
    differences: [
      { currency: 'NGN', expectedMinor: 5000, providerMinor: 0, differenceMinor: -5000 },
    ],
    transferDiscrepancies: {
      unmatchedProviderTransfers: 0,
      missingProviderTransfers: 1,
      identityMismatches: 0,
    },
    withdrawalDiscrepancies: {
      missingRecordedEvents: 0,
      orphanRecordedEvents: 0,
      identityMismatches: 0,
    },
  })
})

Deno.test('account-level withdrawals require a matching recorded webhook event', () => {
  const result = compareBachsAccountBalanceRaw({
    accountId,
    balances: {
      account_id: accountId,
      balances: [{ currency: 'NGN', available_balance: '39.50', pending_balance: '0.00' }],
    },
    transfers: [
      {
        id: 'tr_earning1',
        source: 'acct_platform',
        destination: accountId,
        amount: '50.00',
        currency: 'NGN',
        status: 'paid',
        kind: 'manual',
      },
    ],
    payouts: [
      {
        id: 'pay_withdrawal1',
        status: 'completed',
        amount: '10.00',
        currency: 'NGN',
        source_currency: 'NGN',
        fee: '0.50',
        total_debited: '10.50',
      },
    ],
    expectedTransfers: [expectedTransfer],
    recordedWithdrawals: [],
  })
  assertEquals(result, {
    status: 'MISMATCH',
    checkedCurrencies: 1,
    differences: [],
    transferDiscrepancies: {
      unmatchedProviderTransfers: 0,
      missingProviderTransfers: 0,
      identityMismatches: 0,
    },
    withdrawalDiscrepancies: {
      missingRecordedEvents: 1,
      orphanRecordedEvents: 0,
      identityMismatches: 0,
    },
  })
})

Deno.test('provider pagination is bounded and rejects a changing movement history', async () => {
  const client = {} as never
  let transferReads = 0
  const changed = await reconcileBachsConnectedAccountBalance({
    client,
    accountId,
    expectedTransfers: [],
    recordedWithdrawals: [],
    deps: {
      listTransfers: async (_client, input) => {
        transferReads++
        const total = input.offset === 0 ? 101 : 102
        return {
          items: Array.from(
            {
              length: Math.min(100, total - input.offset),
            },
            (_, index) => ({
              id: `tr_${input.offset + index}`,
              source: 'acct_platform',
              destination: accountId,
              amount: '1.00',
              currency: 'NGN',
              status: 'paid' as const,
            })
          ),
          total,
          limit: input.limit,
          offset: input.offset,
        }
      },
      listPayouts: async () => ({ items: [], total: 0, limit: 100, offset: 0 }),
      getBalances: async () => emptyBalances,
    },
  })
  assertEquals(changed, {
    status: 'INCOMPLETE',
    reason: 'provider_pagination_changed_or_invalid',
  })
  assertEquals(transferReads, 2)

  const tooLarge = await reconcileBachsConnectedAccountBalance({
    client,
    accountId,
    expectedTransfers: [],
    recordedWithdrawals: [],
    maxRecords: 10,
    deps: {
      listTransfers: async (_client, input) => ({
        items: [],
        total: 11,
        limit: input.limit,
        offset: input.offset,
      }),
      listPayouts: async () => ({ items: [], total: 0, limit: 100, offset: 0 }),
      getBalances: async () => emptyBalances,
    },
  })
  assertEquals(tooLarge, {
    status: 'INCOMPLETE',
    reason: 'provider_movement_history_exceeds_safe_limit',
  })

  const shortPage = await reconcileBachsConnectedAccountBalance({
    client,
    accountId,
    expectedTransfers: [],
    recordedWithdrawals: [],
    deps: {
      listTransfers: async (_client, input) => ({
        items: Array.from({ length: 50 }, (_, index) => ({
          id: `tr_${index}`,
          source: 'acct_platform',
          destination: accountId,
          amount: '1.00',
          currency: 'NGN',
          status: 'paid' as const,
        })),
        total: 101,
        limit: input.limit,
        offset: input.offset,
      }),
      listPayouts: async () => ({ items: [], total: 0, limit: 100, offset: 0 }),
      getBalances: async () => emptyBalances,
    },
  })
  assertEquals(shortPage, {
    status: 'INCOMPLETE',
    reason: 'provider_movement_history_truncated',
  })
})
