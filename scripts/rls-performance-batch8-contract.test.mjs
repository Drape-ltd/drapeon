import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const sql = readFileSync(
  new URL('../supabase/migrations/20261125064301_rls_performance_batch8.sql', import.meta.url),
  'utf8',
)

const targets = [
  'commercial_benefit_redemptions',
  'commercial_benefit_reservations',
  'commercial_grants',
  'consultation_attendance_reviews',
  'drape_vision_scan_logs',
  'financial_cases',
  'message_reactions',
  'order_fabric_funding_allocations',
  'provider_disputes',
  'tailor_client_notes',
]

test('batch 8 is limited to the ten reviewed Production tables', () => {
  const tables = [...sql.matchAll(/on public[.]([a-z_]+)/gu)].map((match) => match[1])
  assert.deepEqual([...new Set(tables)].sort(), targets)
})

test('every direct auth.uid call uses an initplan expression', () => {
  const executableSql = sql.replaceAll(/--[^\n]*/gu, '')
  assert.doesNotMatch(executableSql.replaceAll('(select auth.uid())', ''), /auth[.]uid[ ]*[(]/u)
})

test('all reviewed policies require authenticated', () => {
  const blocks = sql.match(/alter policy [^;]+;/gu) ?? []
  assert.equal(blocks.length, 12)
  for (const block of blocks) assert.match(block, /to authenticated/u)
})

test('message reaction joins normalize all drifted IDs', () => {
  for (const expression of [
    'o.id::text = m.order_id::text',
    'm.id::text = message_reactions.message_id::text',
    'm.order_id::text = message_reactions.order_id::text',
    'o.id::text = message_reactions.order_id::text',
    'tp.id::text = o.tailor_profile_id::text',
    'tp.user_id::text = (select auth.uid())::text',
  ]) {
    assert.ok(sql.includes(expression), `missing drift-safe expression: ${expression}`)
  }
})

test('Dev-only duplicate client-note policy is removed without changing ownership', () => {
  assert.match(sql, /drop policy if exists "tailors: manage own client notes"/u)
  assert.match(sql, /tailor_id::text = [(]select auth[.]uid[(][)][)]::text/u)
})
