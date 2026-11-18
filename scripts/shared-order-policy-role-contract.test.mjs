import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migration = await readFile(
  new URL(
    '../supabase/migrations/20261117170000_production_shared_order_policy_authenticated.sql',
    import.meta.url,
  ),
  'utf8',
)

test('the Production shared-order policy repair changes only its target role', () => {
  const executableSql = migration.replace(/^--.*$/gmu, '')

  assert.match(executableSql, /from\s+pg_policies/iu)
  assert.match(executableSql, /alter\s+policy\s+"customers: read tailor profile for shared orders"[\s\S]*?to\s+authenticated/iu)
  assert.doesNotMatch(executableSql, /create\s+policy/iu)
  assert.doesNotMatch(executableSql, /drop\s+policy/iu)
  assert.doesNotMatch(executableSql, /orders\.customer_id/iu)
  assert.doesNotMatch(executableSql, /::text/iu)
})
