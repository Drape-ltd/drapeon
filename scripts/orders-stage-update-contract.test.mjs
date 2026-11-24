import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migration = await readFile(
  new URL('../supabase/migrations/20261124160643_revoke_anon_orders_stage_update.sql', import.meta.url),
  'utf8',
)

test('anon cannot update orders.stage through a table or column grant', () => {
  assert.match(migration, /revoke update on table public\.orders from anon/iu)
  assert.match(migration, /revoke update \(stage\) on table public\.orders from anon/iu)
  assert.match(migration, /has_table_privilege\('anon', 'public\.orders', 'UPDATE'\)/u)
  assert.match(migration, /has_column_privilege\('anon', 'public\.orders', 'stage', 'UPDATE'\)/u)
})
