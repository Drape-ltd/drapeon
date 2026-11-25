import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const sql = readFileSync(
  new URL('../supabase/migrations/20261125070439_rls_performance_batch9.sql', import.meta.url),
  'utf8',
)

const targets = [
  'consultation_commercial_events',
  'drape_vision_ground_truth',
  'drape_vision_scorecard_rows',
  'order_call_participations',
  'order_resolution_decisions',
  'order_resolution_proposals',
  'order_settlement_evidence',
  'product_feedback',
  'provider_payout_events',
  'tailor_payout_setup_requests',
]

test('batch 9 is limited to the ten reviewed Production tables', () => {
  const tables = [...sql.matchAll(/on public[.]([a-z_]+)/gu)].map((match) => match[1])
  assert.deepEqual([...new Set(tables)].sort(), targets)
})

test('every direct auth.uid call uses an initplan expression', () => {
  const executableSql = sql.replaceAll(/--[^\n]*/gu, '')
  assert.doesNotMatch(executableSql.replaceAll('(select auth.uid())', ''), /auth[.]uid[ ]*[(]/u)
})

test('all twelve policies require authenticated and none are dropped', () => {
  const blocks = sql.match(/alter policy [^;]+;/gu) ?? []
  assert.equal(blocks.length, 12)
  for (const block of blocks) assert.match(block, /to authenticated/u)
  assert.doesNotMatch(sql, /drop policy/iu)
})

test('drifted order and tailor joins cast both sides', () => {
  for (const expression of [
    'order_record.id::text = consultation_commercial_events.order_id::text',
    'o.id::text = order_call_participations.order_id::text',
    'feedback_order.id::text = product_feedback.order_id::text',
    'o.id::text = order_resolution_proposals.order_id::text',
    'o.id::text = r.order_id::text',
    'tp.id::text = provider_payout_events.tailor_profile_id::text',
  ]) assert.ok(sql.includes(expression), `missing drift-safe expression: ${expression}`)
})

test('product feedback keeps scan and order ownership branches', () => {
  assert.match(sql, /scan[.]id = product_feedback[.]measurement_scan_id/u)
  assert.match(sql, /scan[.]user_id = [(]select auth[.]uid[(][)][)]/u)
  assert.match(sql, /feedback_order[.]customer_id::text/u)
  assert.match(sql, /feedback_order[.]tailor_id::text/u)
  assert.match(sql, /feedback_tailor[.]user_id::text/u)
})
