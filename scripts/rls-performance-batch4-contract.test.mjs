import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const sql = readFileSync(
  new URL('../supabase/migrations/20261124234600_rls_performance_batch4.sql', import.meta.url),
  'utf8',
)

const targets = [
  'communication_consents',
  'communication_preferences',
  'diary_entries',
  'saved_tailors',
  'seller_items',
]

test('batch 4 is limited to the five reviewed Production tables', () => {
  const tables = [...sql.matchAll(/on public[.]([a-z_]+)/gu)].map((match) => match[1])
  assert.deepEqual([...new Set(tables)].sort(), targets)
})

test('seller item anon and authenticated branches remain role-separated', () => {
  assert.match(sql, /anon reads live seller items"[^]*for select to anon/u)
  assert.match(sql, /authenticated reads live or own seller items"[^]*for select to authenticated/u)
  assert.match(sql, /is_live[^]*is_public_tailor_profile[^]*or is_my_tailor_profile/u)
  assert.doesNotMatch(sql, /for select to (?:public|anon,[ ]*authenticated)/u)
})

test('seller item writes remain owner-only', () => {
  assert.match(sql, /tailors insert own seller items"[^]*with check [(]is_my_tailor_profile/u)
  assert.match(sql, /tailors update own seller items"[^]*using [(]is_my_tailor_profile[^]*with check [(]is_my_tailor_profile/u)
  assert.match(sql, /tailors delete own seller items"[^]*using [(]is_my_tailor_profile/u)
})

test('every direct auth.uid call uses an initplan expression', () => {
  const executableSql = sql.replaceAll(/--[^\n]*/gu, '')
  assert.doesNotMatch(executableSql.replaceAll('(select auth.uid())', ''), /auth[.]uid[ ]*[(]/u)
})
