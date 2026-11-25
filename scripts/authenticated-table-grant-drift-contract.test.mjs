import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const sql = readFileSync(
  new URL('../supabase/migrations/20261125073302_align_authenticated_table_grants_with_dev.sql', import.meta.url),
  'utf8',
)

test('migration only revokes verified non-Data-API authenticated extras', () => {
  const executableSql = sql.replaceAll(/--[^\n]*/gu, '')
  assert.doesNotMatch(executableSql, /\bgrant\b/iu)
  const statements = executableSql.split(';').map((value) => value.trim()).filter(Boolean)
  assert.equal(statements.length, 76)
  for (const statement of statements) {
    assert.match(statement, /^revoke\b/u)
    assert.match(statement, / from authenticated$/u)
    assert.doesNotMatch(statement, /\b(?:select|insert|update|delete)\b/iu)
  }
})

test('migration never changes anon, service_role or PUBLIC', () => {
  assert.doesNotMatch(sql, /from (?:anon|service_role|public);/iu)
})

test('public-read tables retain authenticated SELECT', () => {
  for (const table of ['portfolio_items', 'portfolio_photos', 'reviews', 'seller_items']) {
    const statement = sql.match(new RegExp(`revoke ([^;]+) on table public[.]${table} from authenticated;`, 'u'))
    assert.ok(statement, `missing ${table} delta revoke`)
    assert.doesNotMatch(statement[1], /\bselect\b/u)
  }
})

test('client SELECT and DML remain untouched on every table', () => {
  const executableSql = sql.replaceAll(/--[^\n]*/gu, '')
  assert.doesNotMatch(executableSql, /revoke [^;]*\b(?:select|insert|update|delete)\b/iu)
})
