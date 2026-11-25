import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const sql = readFileSync(
  new URL('../supabase/migrations/20261125072653_rls_performance_batch10.sql', import.meta.url),
  'utf8',
)

const targets = [
  'commercial_receipts',
  'consultation_attendance_evidence',
  'order_fabric_candidates',
  'order_fabric_handoffs',
  'order_fulfillment_events',
  'order_fulfillment_parcels',
  'order_fulfillment_runs',
  'order_refund_resolutions',
  'order_settlement_tranches',
  'studio_collections',
]

test('batch 10 is limited to the ten reviewed Production tables', () => {
  const tables = [...sql.matchAll(/on public[.]([a-z_]+)/gu)].map((match) => match[1])
  assert.deepEqual([...new Set(tables)].sort(), targets)
})

test('all ten policies are altered in place and none are dropped', () => {
  assert.equal((sql.match(/alter policy/gu) ?? []).length, 10)
  assert.doesNotMatch(sql, /drop policy/iu)
})

test('every direct auth.uid call uses an initplan expression', () => {
  const executableSql = sql.replaceAll(/--[^\n]*/gu, '')
  assert.doesNotMatch(executableSql.replaceAll('(select auth.uid())', ''), /auth[.]uid[ ]*[(]/u)
})

test('orders joins are safe across the text/uuid project drift', () => {
  for (const expression of [
    'o.id::text = order_fulfillment_runs.order_id::text',
    'o.id::text = order_refund_resolutions.order_id::text',
    'o.id::text = order_fulfillment_events.order_id::text',
    'o.id::text = order_fulfillment_parcels.order_id::text',
    'o.customer_id::text',
    'o.tailor_id::text',
  ]) assert.ok(sql.includes(expression), `missing drift-safe expression: ${expression}`)
})

test('the consultation evidence policy keeps the canonical id_text join', () => {
  assert.match(sql, /o[.]id_text = consultation_attendance_evidence[.]order_id/u)
})
