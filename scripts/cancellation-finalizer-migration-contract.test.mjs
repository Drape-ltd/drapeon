import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const migrationDir = new URL('../supabase/migrations/', import.meta.url)
const latestDefinition = readdirSync(migrationDir)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .filter((name) => /create or replace function public\.finalize_ops_order_cancellation_refund\(/i
    .test(readFileSync(new URL(name, migrationDir), 'utf8')))
  .at(-1)
assert.ok(latestDefinition, 'a cancellation refund finalizer migration must exist')

const migration = `supabase/migrations/${latestDefinition}`
const rollback = `supabase/migrations/rollback/${latestDefinition.replace(/\.sql$/, '.rollback.sql')}`
const priorRollback = 'supabase/migrations/rollback/20261107194113_cancellation_review_money_desk_refund.rollback.sql'

for (const path of [migration, rollback, priorRollback]) {
  test(`${path} preserves the effective dispute finalizer hardening`, () => {
    const sql = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
    assert.ok(sql.includes('where id::text = p_dispute_id::text for update'), 'preserve text dispute IDs')
    assert.ok(/v_order\.id::uuid,\s*'REFUNDED'::text,\s*null::text,/.test(sql), 'preserve typed terminal arguments')
    assert.ok(sql.includes("'ops.order_cancellation_refund_completed'::text"), 'preserve typed terminal event')
    assert.ok(sql.includes('resolved_by = null,'), 'preserve UUID-only resolved_by')
    assert.ok(!sql.includes('resolved_by = nullif(trim(coalesce(p_actor_email'), 'never write actor email to resolved_by')
  })
}
