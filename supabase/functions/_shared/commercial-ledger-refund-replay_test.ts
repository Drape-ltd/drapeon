import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { recordCommercialPaymentRefund } from './commercial-ledger.ts'

const paymentId = '11111111-1111-4111-8111-111111111111'
const orderId = '22222222-2222-4222-8222-222222222222'
const captureId = '33333333-3333-4333-8333-333333333333'
const refundId = 're_test_settled'

function settledLedgerClient(override: Record<string, unknown> | null = {}) {
  const reads: Array<{ table: string; filters: Record<string, unknown> }> = []
  const client = {
    from(table: string) {
      const filters: Record<string, unknown> = {}
      const query = {
        select(_columns: string) { return query },
        eq(column: string, value: unknown) { filters[column] = value; return query },
        async maybeSingle() {
          reads.push({ table, filters: { ...filters } })
          if (table !== 'commercial_ledger_transactions') {
            throw new Error(`Unexpected lookup of ${table} after a settled refund`)
          }
          if (filters.transaction_kind === 'CAPTURE') {
            return { data: { id: captureId, original_currency: 'USD' }, error: null }
          }
          if (filters.transaction_kind === 'REFUND') {
            return { data: override === null ? null : {
              id: '44444444-4444-4444-8444-444444444444',
              payment_id: paymentId,
              order_id: orderId,
              transaction_kind: 'REFUND',
              provider_reference: refundId,
              reversal_of_transaction_id: captureId,
              original_amount: 13531,
              original_currency: 'USD',
              settlement_amount: 13531,
              settlement_currency: 'USD',
              metadata: { exact_restoration: null, consultation_funded_refund: null },
              ...override,
            }, error: null }
          }
          throw new Error('Unexpected ledger query')
        },
      }
      return query
    },
    rpc() { throw new Error('A settled refund must not post another journal') },
  }
  return { client, reads }
}

const refund = {
  paymentId,
  orderId,
  refundAmount: 13531,
  idempotencyKey: `payment-refund:${paymentId}:13531:13531`,
  providerReference: refundId,
}

Deno.test('a settled Stripe refund replay reuses the exact journal without posting a second one', async () => {
  const { client, reads } = settledLedgerClient()
  const result = await recordCommercialPaymentRefund(client as never, refund)
  assertEquals(result.transactionId, '44444444-4444-4444-8444-444444444444')
  assertEquals((result as { alreadyRecorded?: boolean }).alreadyRecorded, true)
  assertEquals(reads.some((read) => read.filters.provider_reference === refundId), true)
})

Deno.test('a replay with a mismatched settled amount fails closed', async () => {
  const { client } = settledLedgerClient({ original_amount: 10000 })
  await assertRejects(
    () => recordCommercialPaymentRefund(client as never, refund),
    Error,
    'Existing refund journal does not match',
  )
})

Deno.test('a confirmed provider refund without a journal is not acknowledged as settled', async () => {
  const { client } = settledLedgerClient(null)
  await assertRejects(
    () => recordCommercialPaymentRefund(client as never, refund),
    Error,
  )
})

Deno.test('a journal for another capture cannot be reused', async () => {
  const { client } = settledLedgerClient({ reversal_of_transaction_id: 'another_capture' })
  await assertRejects(
    () => recordCommercialPaymentRefund(client as never, refund),
    Error,
    'Existing refund journal does not match',
  )
})
