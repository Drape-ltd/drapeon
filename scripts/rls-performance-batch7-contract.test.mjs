import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const sql = readFileSync(
  new URL('../supabase/migrations/20261125061503_rls_performance_batch7.sql', import.meta.url),
  'utf8',
)

const targets = [
  'commercial_adjustments',
  'consultation_reschedule_requests',
  'order_material_advances',
  'order_payments',
  'order_production_evidence',
  'order_quotes',
  'order_return_requests',
  'order_settlement_plans',
  'order_tips',
  'payout_change_requests',
]

test('batch 7 is limited to the ten reviewed Production tables', () => {
  const tables = [...sql.matchAll(/on public[.]([a-z_]+)/gu)].map((match) => match[1])
  assert.deepEqual([...new Set(tables)].sort(), targets)
})

test('every direct auth.uid call uses an initplan expression', () => {
  const executableSql = sql.replaceAll(/--[^\n]*/gu, '')
  assert.doesNotMatch(executableSql.replaceAll('(select auth.uid())', ''), /auth[.]uid[ ]*[(]/u)
})

test('all reviewed policies require authenticated', () => {
  const blocks = sql.match(/alter policy [^;]+;/gu) ?? []
  assert.equal(blocks.length, targets.length)
  for (const block of blocks) assert.match(block, /to authenticated/u)
})

test('cross-project order ID drift is normalized on both sides', () => {
  for (const table of [
    'consultation_reschedule_requests',
    'order_payments',
    'order_production_evidence',
    'order_quotes',
    'order_return_requests',
  ]) {
    assert.match(sql, new RegExp(`${table}[.]order_id::text`, 'u'))
  }
  assert.match(sql, /(?:o|order_row|order_record)[.]id::text/u)
  for (const column of ['customer_id', 'tailor_id']) {
    assert.match(sql, new RegExp(`(?:o|order_row|order_record)[.]${column}::text`, 'u'))
  }
})
