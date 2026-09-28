import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { scoreBucket, surveyInviteAvailability, validateSubject } from './policy.ts'

const now = Date.parse('2026-09-28T18:00:00Z')
const invite = { status: 'PENDING', available_at: '2026-09-28T17:00:00Z', expires_at: '2026-10-28T17:00:00Z' }

Deno.test('ready and sent invitations accept feedback', () => {
  assertEquals(surveyInviteAvailability(invite, now), { ok: true })
  assertEquals(surveyInviteAvailability({ ...invite, status: 'SENT' }, now), { ok: true })
})
Deno.test('missing and terminal invitations fail closed', () => {
  for (const value of [null, ...['COMPLETED', 'SUPPRESSED', 'EXPIRED'].map(status => ({ ...invite, status }))]) {
    assertEquals(surveyInviteAvailability(value, now).ok, false)
  }
})
Deno.test('invitation delay cannot be bypassed', () => {
  assertEquals(surveyInviteAvailability({ ...invite, available_at: '2026-09-28T19:00:00Z' }, now).ok, false)
})
Deno.test('expired, malformed and inverted dates fail closed', () => {
  for (const value of [
    { ...invite, expires_at: '2026-09-28T18:00:00Z' },
    { ...invite, expires_at: 'invalid' },
    { ...invite, available_at: 'invalid' },
    { ...invite, expires_at: invite.available_at },
  ]) assertEquals(surveyInviteAvailability(value, now).ok, false)
})
Deno.test('feedback telemetry uses coarse score buckets', () => {
  assertEquals([1, 2, 3, 4, 5].map(scoreBucket), ['1-2', '1-2', '3', '4-5', '4-5'])
})

function database(rows: Array<{ table: string; data: unknown; error?: unknown }>) {
  const calls: Array<[string, unknown]> = []
  const db = {
    from(table: string) {
      const result = rows.shift()
      assertEquals(table, result?.table)
      const query = {
        select(value: string) { calls.push(['select', value]); return this },
        eq(key: string, value: unknown) { calls.push([key, value]); return this },
        neq() { return this }, in() { return this }, not() { return this },
        order() { return this }, limit() { return this },
        maybeSingle() { return Promise.resolve({ data: result?.data, error: result?.error ?? null }) },
        then(resolve: (result: unknown) => unknown) { return Promise.resolve({ data: result?.data, error: result?.error ?? null }).then(resolve) },
      }
      return query
    },
  }
  return { db: db as never, calls }
}
const order = { id: 'canonical-order', stage: 'COMPLETE', customer_id: 'customer', tailor_id: 'tailor', tailor_profile_id: 'profile' }

Deno.test('customer feedback uses canonical order ID without generated text aliases', async () => {
  const { db, calls } = database([{ table: 'orders', data: order }])
  assertEquals((await validateSubject(db, 'customer', 'CUSTOMER', 'CUSTOMER_POST_COMPLETION_CSAT', 'ORDER', order.id)).ok, true)
  assertEquals(calls.some(([key, value]) => key === 'id' && value === order.id), true)
  assertEquals(calls.some(([key, value]) => key === 'select' && String(value).includes('id_text')), false)
})
Deno.test('other customers cannot submit an order survey', async () => {
  const { db } = database([{ table: 'orders', data: order }])
  assertEquals((await validateSubject(db, 'other', 'CUSTOMER', 'CUSTOMER_POST_COMPLETION_CSAT', 'ORDER', order.id)).ok, false)
})
Deno.test('incomplete and missing orders do not accept feedback', async () => {
  for (const value of [null, { ...order, stage: 'MAKING' }]) {
    const { db } = database([{ table: 'orders', data: value }])
    assertEquals((await validateSubject(db, 'customer', 'CUSTOMER', 'CUSTOMER_POST_COMPLETION_CSAT', 'ORDER', order.id)).ok, false)
  }
})
Deno.test('account feedback is restricted to the caller', async () => {
  const { db } = database([])
  assertEquals((await validateSubject(db, 'customer', 'CUSTOMER', 'ONBOARDING_PULSE', 'ACCOUNT', 'customer')).ok, true)
  assertEquals((await validateSubject(db, 'customer', 'CUSTOMER', 'ONBOARDING_PULSE', 'ACCOUNT', 'other')).ok, false)
  assertEquals((await validateSubject(db, 'customer', 'CUSTOMER', 'ONBOARDING_PULSE', 'ORDER', order.id)).ok, false)
})
Deno.test('support feedback requires an owned resolved case', async () => {
  for (const [value, expected] of [
    [{ id: 'case', user_id: 'customer', status: 'RESOLVED' }, true],
    [{ id: 'case', user_id: 'other', status: 'RESOLVED' }, false],
    [{ id: 'case', user_id: 'customer', status: 'OPEN' }, false],
  ] as const) {
    const { db } = database([{ table: 'ops_issues', data: value }])
    assertEquals((await validateSubject(db, 'customer', 'CUSTOMER', 'SUPPORT_RESOLUTION_CSAT', 'SUPPORT_CASE', 'case')).ok, expected)
  }
})
Deno.test('tailor feedback rejects missing and failed provider payouts', async () => {
  for (const paid of [false, true]) {
    const rows = [
      { table: 'orders', data: order },
      { table: 'orders', data: { id: order.id } },
      { table: 'order_settlement_tranches', data: paid ? [{ payout_id: 'payout' }] : [] },
      ...(paid ? [{ table: 'payouts', data: [{ status: 'FAILED', bank_settlement_status: 'PAID' }] }] : []),
    ]
    const { db } = database(rows)
    assertEquals((await validateSubject(db, 'tailor', 'TAILOR', 'TAILOR_FIRST_ORDER_CSAT', 'ORDER', order.id)).ok, false)
  }
})
Deno.test('first-order tailor feedback accepts provider-confirmed payout only', async () => {
  const { db } = database([
    { table: 'orders', data: order },
    { table: 'orders', data: { id: order.id } },
    { table: 'order_settlement_tranches', data: [{ payout_id: 'payout' }] },
    { table: 'payouts', data: [{ status: 'PAID', provider_transfer_status: 'PAID_TO_BANK' }] },
  ])
  assertEquals((await validateSubject(db, 'tailor', 'TAILOR', 'TAILOR_FIRST_ORDER_CSAT', 'ORDER', order.id)).ok, true)
})
