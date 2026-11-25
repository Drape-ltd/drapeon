import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const sql = readFileSync(
  new URL('../supabase/migrations/20261125000600_rls_performance_batch5.sql', import.meta.url),
  'utf8',
)

const targets = [
  'communication_inbox',
  'consultation_bookings',
  'custom_order_brief_drafts',
  'custom_order_details',
  'identity_retention_records',
  'identity_verification_consents',
  'identity_verification_handoffs',
  'profile_change_requests',
  'referrals',
  'users',
]

test('batch 5 is limited to the ten reviewed Production tables', () => {
  const tables = [...sql.matchAll(/on public[.]([a-z_]+)/gu)].map((match) => match[1])
  assert.deepEqual([...new Set(tables)].sort(), targets)
})

test('every direct auth.uid call uses an initplan expression', () => {
  const executableSql = sql.replaceAll(/--[^\n]*/gu, '')
  assert.doesNotMatch(executableSql.replaceAll('(select auth.uid())', ''), /auth[.]uid[ ]*[(]/u)
})

test('formerly public ownership policies are authenticated-only', () => {
  for (const table of ['users', 'referrals', 'custom_order_details', 'consultation_bookings']) {
    const policyBlock = sql.match(new RegExp(`alter policy [^;]+on public[.]${table}[^;]+;`, 'gu'))
    assert.ok(policyBlock?.length, `missing ${table} policy`)
    for (const policy of policyBlock) assert.match(policy, /to authenticated/u)
  }
  assert.doesNotMatch(sql, /to (?:public|anon)(?:\s|$)/u)
})

test('cross-project ID drift is normalized at order joins', () => {
  for (const column of ['o.id', 'o.customer_id', 'o.tailor_id']) {
    assert.match(sql, new RegExp(`${column.replace('.', '[.]')}::text`, 'u'))
  }
  assert.match(sql, /custom_order_details[.]order_id::text/u)
  assert.match(sql, /consultation_bookings[.]order_id::text/u)
})
