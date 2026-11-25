import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const sql = readFileSync(
  new URL('../supabase/migrations/20261125075040_rls_performance_batch11.sql', import.meta.url),
  'utf8',
)

const targets = [
  'commercial_adjustment_events',
  'consultation_booking_slots',
  'diary_attachments',
  'fabric_release_adjustment_links',
  'financial_case_events',
  'financial_case_evidence',
  'order_call_sessions',
  'order_fabric_events',
  'order_return_shipment_events',
  'order_return_shipments',
  'order_settlement_events',
  'order_studio_design_versions',
  'order_tip_events',
]

test('batch 11 covers every remaining Production advisor table', () => {
  const tables = [...sql.matchAll(/on public[.]([a-z_]+)/gu)].map((match) => match[1])
  assert.deepEqual([...new Set(tables)].sort(), targets)
  assert.equal((sql.match(/alter policy/gu) ?? []).length, 15)
})

test('every direct auth.uid call uses an initplan expression', () => {
  const executableSql = sql.replaceAll(/--[^\n]*/gu, '')
  assert.doesNotMatch(executableSql.replaceAll('(select auth.uid())', ''), /auth[.]uid[ ]*[(]/u)
})

test('all policies are altered in place and none are dropped', () => {
  assert.doesNotMatch(sql, /drop policy/iu)
  assert.equal((sql.match(/alter policy/gu) ?? []).length, 15)
})

test('only the two formerly public auth-dependent policies narrow role', () => {
  const roleChanges = [...sql.matchAll(/alter policy "([^"]+)"[^;]+?to authenticated/gu)].map((match) => match[1])
  assert.deepEqual(roleChanges, [
    'Order parties read consultation booking slots',
    'Order parties see call sessions',
  ])
})

test('drifted IDs compare safely and canonical id_text joins remain', () => {
  for (const expression of [
    'order_record.id::text = booking.order_id::text',
    'o.id::text = order_call_sessions.order_id::text',
    'tp.id::text = o.tailor_profile_id::text',
    'o.id::text = r.order_id::text',
    'o.id::text = order_studio_design_versions.order_id::text',
    'join public.orders o on o.id_text = fc.order_id',
  ]) assert.ok(sql.includes(expression), `missing drift-safe expression: ${expression}`)
})

test('diary insert keeps the full owner and parent-owner WITH CHECK', () => {
  assert.match(sql, /Diary photos: tailor adds own"[^;]+with check[^;]+tailor_id = [(]select auth[.]uid[(][)][)][^;]+d[.]tailor_id = [(]select auth[.]uid[(][)][)]/u)
})
