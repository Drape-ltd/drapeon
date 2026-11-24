import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const sql = readFileSync(
  new URL('../supabase/migrations/20261124234500_rls_performance_batch3.sql', import.meta.url),
  'utf8',
)

const targets = ['disputes', 'order_group_members', 'portfolio_items', 'portfolio_photos', 'push_tokens']

test('batch 3 is limited to the five reviewed Production tables', () => {
  const tables = [...sql.matchAll(/on public[.]([a-z_]+)/gu)].map((match) => match[1])
  assert.deepEqual([...new Set(tables)].sort(), targets)
})

test('anon branches stay separate from authenticated branches', () => {
  assert.match(sql, /Order parties see their dispute"[^]*for select to authenticated/u)
  assert.match(sql, /Order owners or invitees view group members"[^]*for select to authenticated/u)
  assert.match(sql, /anon: view live portfolio"[^]*for select to anon/u)
  assert.match(sql, /authenticated: view live or own portfolio"[^]*for select to authenticated/u)
  assert.match(sql, /anon: read public portfolio photos"[^]*for select to anon/u)
  assert.match(sql, /authenticated: read public or own portfolio photos"[^]*for select to authenticated/u)
  assert.doesNotMatch(sql, /for select to public/u)
})

test('every direct auth.uid call uses an initplan expression', () => {
  const executableSql = sql.replaceAll(/--[^\n]*/gu, '')
  assert.doesNotMatch(executableSql.replaceAll('(select auth.uid())', ''), /auth[.]uid[ ]*[(]/u)
})

test('merged policies retain every Production predicate', () => {
  assert.match(sql, /o[.]customer_id::text = [(]select auth[.]uid[(][)][)]::text/u)
  assert.match(sql, /tp[.]user_id::text = [(]select auth[.]uid[(][)][)]::text/u)
  assert.match(sql, /owner_customer_id = [(]select auth[.]uid[(][)][)][^]*or invited_user_id = [(]select auth[.]uid[(][)][)]/u)
  assert.match(sql, /is_public_tailor_profile[^]*or is_my_tailor_profile/u)
})
