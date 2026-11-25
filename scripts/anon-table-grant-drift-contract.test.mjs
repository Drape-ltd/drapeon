import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const sql = readFileSync(
  new URL('../supabase/migrations/20261125060445_align_anon_table_grants_with_dev.sql', import.meta.url),
  'utf8',
)

test('grant drift migration only revokes privileges', () => {
  const executableSql = sql.replaceAll(/--[^\n]*/gu, '')
  assert.doesNotMatch(executableSql, /\bgrant\b/iu)
  const statements = executableSql.split(';').map((value) => value.trim()).filter(Boolean)
  assert.equal(statements.length, 79)
  for (const statement of statements) assert.match(statement, /^revoke\b/u)
})

test('tailor data exports loses every anon table privilege', () => {
  assert.match(
    sql,
    /revoke delete, insert, references, select, trigger, truncate, update on table public[.]tailor_data_exports from anon;/u,
  )
})

test('public marketplace reads retain anon select', () => {
  for (const table of ['portfolio_items', 'portfolio_photos', 'reviews', 'seller_items']) {
    const statement = sql.match(new RegExp(`revoke ([^;]+) on table public[.]${table} from anon;`, 'u'))
    assert.ok(statement, `missing ${table} revoke`)
    assert.doesNotMatch(statement[1], /\bselect\b/u)
  }
})

test('migration does not change authenticated, service or PUBLIC roles', () => {
  assert.doesNotMatch(sql, /from (?:authenticated|service_role|public);/u)
})
