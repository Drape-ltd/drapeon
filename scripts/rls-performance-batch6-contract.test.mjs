import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const sql = readFileSync(
  new URL('../supabase/migrations/20261125054108_rls_performance_batch6.sql', import.meta.url),
  'utf8',
)

const targets = [
  'customer_measurement_profiles',
  'measurement_scans',
  'order_call_rooms',
  'order_events',
  'order_handoff_issues',
  'quote_revision_requests',
  'tailor_data_exports',
  'tailor_quote_drafts',
  'wishlist_collections',
  'wishlist_items',
]

test('batch 6 is limited to the ten reviewed Production tables', () => {
  const tables = [...sql.matchAll(/on public[.]([a-z_]+)/gu)].map((match) => match[1])
  assert.deepEqual([...new Set(tables)].sort(), targets)
})

test('every direct auth.uid call uses an initplan expression', () => {
  const executableSql = sql.replaceAll(/--[^\n]*/gu, '')
  assert.doesNotMatch(executableSql.replaceAll('(select auth.uid())', ''), /auth[.]uid[ ]*[(]/u)
})

test('formerly public ownership policies are authenticated-only', () => {
  const executableSql = sql.replaceAll(/--[^\n]*/gu, '')
  for (const table of [
    'customer_measurement_profiles',
    'measurement_scans',
    'order_call_rooms',
    'order_handoff_issues',
    'tailor_data_exports',
  ]) {
    const blocks = sql.match(new RegExp(`alter policy [^;]+on public[.]${table}[^;]+;`, 'gu'))
    assert.ok(blocks?.length, `missing ${table} policy`)
    for (const block of blocks) assert.match(block, /to authenticated/u)
  }
  assert.doesNotMatch(executableSql, /to (?:public|anon)(?:\s|$)/u)
})

test('cross-project order ID drift is normalized on both sides', () => {
  for (const table of ['order_call_rooms', 'order_handoff_issues', 'quote_revision_requests', 'order_events']) {
    assert.match(sql, new RegExp(`${table}[.]order_id::text`, 'u'))
  }
  for (const column of ['id', 'customer_id', 'tailor_id']) {
    assert.match(sql, new RegExp(`(?:o|order_row)[.]${column}::text`, 'u'))
  }
  assert.match(sql, /tp[.]id::text = o[.]tailor_profile_id::text/u)
  assert.match(sql, /tp[.]user_id::text = [(]select auth[.]uid[(][)][)]::text/u)
})
