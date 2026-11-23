import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { completeTipPayout, persistPayoutLedgerTransaction, resolveTipPayoutGate } from './tip-payout.ts'

Deno.test('Bachs TIP cannot start a new transfer while the complete phase is blocked', () => {
  assertEquals(resolveTipPayoutGate({ provider: 'BACHS', bachsPathReady: false }), 'BLOCK_UNSUPPORTED_BACHS')
  assertEquals(resolveTipPayoutGate({ provider: 'STRIPE', bachsPathReady: false }), 'ALLOW')
  assertEquals(resolveTipPayoutGate({ provider: 'BACHS', bachsPathReady: true }), 'ALLOW')
})

Deno.test('a durable Bachs TIP payout claim remains lookup/finalization eligible after the path gate closes', () => {
  for (const status of ['PROVIDER_UNKNOWN', 'PROVIDER_PENDING', 'SUCCEEDED', 'FAILED_RECONCILED']) {
    assertEquals(resolveTipPayoutGate({
      provider: 'BACHS',
      bachsPathReady: false,
      existingClaimStatus: status,
    }), 'RECONCILE_EXISTING')
  }
  assertEquals(resolveTipPayoutGate({
    provider: 'BACHS',
    bachsPathReady: false,
    existingClaimStatus: 'RESERVED',
  }), 'BLOCK_UNSUPPORTED_BACHS')
})

function payoutClaimClient(initialLedgerId: string | null = null) {
  const claim = { id: 'claim-1', payout_ledger_transaction_id: initialLedgerId }
  let writes = 0
  const client = {
    from(table: string) {
      if (table !== 'payout_claims') throw new Error(`Unexpected table ${table}`)
      return {
        select() {
          return {
            eq(column: string, value: string) {
              if (column !== 'payout_id' && column !== 'id') throw new Error(`Unexpected filter ${column}`)
              return { maybeSingle: async () => ({ data: claim, error: null }) }
            },
          }
        },
        update(values: { payout_ledger_transaction_id: string }) {
          return {
            eq: () => ({
              is: () => ({
                select: () => ({
                  maybeSingle: async () => {
                    writes += 1
                    claim.payout_ledger_transaction_id = values.payout_ledger_transaction_id
                    return { data: { id: claim.id }, error: null }
                  },
                }),
              }),
            }),
          }
        },
      }
    },
  }
  return { client: client as unknown as SupabaseClient, claim, writes: () => writes }
}

Deno.test('payout ledger reference is stored on its immutable claim and is idempotent', async () => {
  const state = payoutClaimClient()
  await persistPayoutLedgerTransaction(state.client, 'payout-1', 'ledger-1')
  await persistPayoutLedgerTransaction(state.client, 'payout-1', 'ledger-1')
  assertEquals(state.claim.payout_ledger_transaction_id, 'ledger-1')
  assertEquals(state.writes(), 1)
})

Deno.test('payout claim cannot be silently relinked to another ledger transaction', async () => {
  const state = payoutClaimClient('ledger-original')
  await assertRejects(
    () => persistPayoutLedgerTransaction(state.client, 'payout-1', 'ledger-replacement'),
    Error,
    'different ledger transaction',
  )
  assertEquals(state.claim.payout_ledger_transaction_id, 'ledger-original')
  assertEquals(state.writes(), 0)
})

Deno.test('tip payout finalization preserves capture ledger reference and returns payout ledger reference', async () => {
  const claim: { id: string; payout_ledger_transaction_id: string | null } = {
    id: 'claim-1',
    payout_ledger_transaction_id: null,
  }
  const updates: Array<{ table: string; values: Record<string, unknown> }> = []
  const query = (table: string, values?: Record<string, unknown>) => {
    const result = { data: null as { id?: string } | null, error: null }
    const builder: Record<string, unknown> = {}
    for (const method of ['eq', 'is', 'in', 'select']) {
      builder[method] = () => builder
    }
    builder.maybeSingle = async () => ({
      data: table === 'payout_claims'
        ? (values ? { id: claim.id } : claim)
        : null,
      error: null,
    })
    builder.then = (resolve: (value: typeof result) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject)
    return builder
  }
  const client = {
    rpc: async () => ({ data: 'payout-ledger-id', error: null }),
    from(table: string) {
      return {
        select: () => query(table),
        update(values: Record<string, unknown>) {
          updates.push({ table, values })
          if (table === 'payout_claims') claim.payout_ledger_transaction_id = String(values.payout_ledger_transaction_id)
          return query(table, values)
        },
      }
    },
  }
  const result = await completeTipPayout(client as unknown as SupabaseClient, {
    tip: {
      id: 'tip-1', order_id: 'order-1', customer_id: 'customer-1', tailor_id: 'tailor-1',
      amount: 500, currency: 'GBP', status: 'PAID_OUT', payment_id: 'payment-1',
      correlation_id: 'correlation-1', ledger_transaction_id: 'capture-ledger-id',
    },
    payoutId: 'payout-1',
    provider: 'STRIPE',
    providerReference: 'tr_test_1',
    providerResponse: {},
  })
  assertEquals(result.ledgerTransactionId, 'payout-ledger-id')
  assertEquals(claim.payout_ledger_transaction_id, 'payout-ledger-id')
  const tipUpdate = updates.find((update) => update.table === 'order_tips')
  assertEquals('ledger_transaction_id' in (tipUpdate?.values ?? {}), false)
})
