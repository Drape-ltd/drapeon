import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const sql = readFileSync(
  new URL('../supabase/migrations/20261125074847_align_authenticated_view_grants_with_dev.sql', import.meta.url),
  'utf8',
)

const views = [
  'commercial_benefit_reporting',
  'commercial_delivery_outcome_reporting',
  'commercial_tip_reporting',
  'drape_vision_ground_truth_comparison',
]

test('follow-up revokes exactly four non-Data-API atoms from each reviewed view', () => {
  const executableSql = sql.replaceAll(/--[^\n]*/gu, '')
  const statements = executableSql.split(';').map((value) => value.trim()).filter(Boolean)
  assert.equal(statements.length, 4)
  for (const [index, statement] of statements.entries()) {
    assert.match(statement, /^revoke maintain, references, trigger, truncate/u)
    assert.match(statement, new RegExp(`on table public[.]${views[index]}\\s+from authenticated$`, 'u'))
    assert.doesNotMatch(statement, /\b(?:select|insert|update|delete)\b/iu)
  }
})

test('follow-up changes no other role and grants nothing', () => {
  assert.doesNotMatch(sql, /\bgrant\b/iu)
  assert.doesNotMatch(sql, /from (?:anon|service_role|public);/iu)
})
