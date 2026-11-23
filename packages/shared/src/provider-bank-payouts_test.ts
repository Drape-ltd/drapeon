import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import { projectBankPayoutEvents, withdrawnBankPayoutAmount, type BankPayoutEvent } from './provider-bank-payouts.ts'

const base: BankPayoutEvent = {
  id: 'row-created', provider: 'STRIPE',
  provider_bank_payout_id: 'po-one', amount: 8000, currency: 'USD',
  status: 'IN_TRANSIT', arrival_at: null,
  occurred_at: '2026-11-09T00:53:38Z',
  processed_at: '2026-11-09T00:53:40Z', created_at: '2026-11-09T00:53:40Z',
}

Deno.test('one Stripe payout with created, updated and paid events appears once for 8000', () => {
  const paid = { ...base, id: 'row-paid',
    status: 'PAID', occurred_at: '2026-11-09T00:58:38Z',
    processed_at: '2026-11-09T00:58:39Z' }
  const updated = { ...paid, id: 'row-updated' }
  const projected = projectBankPayoutEvents([base, updated, paid])
  assertEquals(projected.length, 1)
  assertEquals(projected[0].status, 'PAID')
  assertEquals(projected.reduce((sum, row) => sum + (row.amount ?? 0), 0), 8000)
})

Deno.test('older event processed later does not reverse a paid withdrawal', () => {
  const paid = { ...base, id: 'paid', status: 'PAID',
    occurred_at: '2026-11-09T01:00:00Z', processed_at: '2026-11-09T01:00:01Z' }
  const lateCreated = { ...base, processed_at: '2026-11-09T02:00:00Z' }
  assertEquals(projectBankPayoutEvents([paid, lateCreated])[0].status, 'PAID')
})

Deno.test('paid twice counts once and a later failed event is not withdrawn', () => {
  const paid = { ...base, id: 'paid', status: 'PAID', occurred_at: '2026-11-09T01:00:00Z' }
  const duplicatePaid = { ...paid, id: 'paid-again', processed_at: '2026-11-09T01:00:02Z' }
  assertEquals(projectBankPayoutEvents([paid, duplicatePaid]).length, 1)
  assertEquals(withdrawnBankPayoutAmount([paid, duplicatePaid], 'USD', Date.parse('2026-11-01')), 8000)
  const failed = { ...paid, id: 'failed', status: 'FAILED', occurred_at: '2026-11-09T01:01:00Z' }
  assertEquals(projectBankPayoutEvents([paid, failed])[0].status, 'FAILED')
  assertEquals(withdrawnBankPayoutAmount([paid, failed], 'USD', Date.parse('2026-11-01')), 0)
})

Deno.test('two payout IDs remain two withdrawals, even at the same amount', () => {
  const events = [
    base,
    { ...base, id: 'two', provider_bank_payout_id: 'po-two' },
  ]
  assertEquals(projectBankPayoutEvents(events).length, 2)
})

Deno.test('monthly total uses paid event time and excludes other currencies', () => {
  const oldCreated = { ...base, created_at: '2026-10-31T23:00:00Z',
    occurred_at: '2026-10-31T23:00:00Z' }
  const paid = { ...oldCreated, id: 'paid', status: 'PAID', occurred_at: '2026-11-01T01:00:00Z' }
  const otherCurrency = { ...paid, id: 'cad', currency: 'CAD', provider_bank_payout_id: 'po-cad' }
  const priorMonth = { ...paid, id: 'october', provider_bank_payout_id: 'po-october',
    occurred_at: '2026-10-30T01:00:00Z' }
  assertEquals(withdrawnBankPayoutAmount(
    [oldCreated, paid, otherCurrency, priorMonth], 'USD', Date.parse('2026-11-01T00:00:00Z'),
  ), 8000)
})

Deno.test('unknown payout IDs remain separate events and conflicting amounts fail closed', () => {
  assertEquals(projectBankPayoutEvents([
    { ...base, provider_bank_payout_id: null },
    { ...base, id: 'unknown-two', provider_bank_payout_id: null },
  ]).length, 2)
  assertThrows(() => projectBankPayoutEvents([
    base,
    { ...base, id: 'conflict', amount: 16000 },
  ]), Error, 'BANK_PAYOUT_EVENT_AMOUNT_CONFLICT')
})
