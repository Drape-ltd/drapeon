import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const migration = (name) => readFileSync(resolve(root, 'supabase/migrations', name), 'utf8')

const schema = migration('20261118023004_prod_forward_push_notification_schema.sql')
const receipts = migration('20261118023124_prod_forward_push_notification_receipt_contract.sql')
const provenance = migration('20261118023335_prod_forward_push_token_provenance.sql')

for (const column of [
  'expo_project_id',
  'app_variant',
  'application_id',
  'apns_environment',
  'token_generation_started_at',
  'quarantined_at',
  'quarantine_reason',
  'notification_job_id',
]) {
  assert.match(schema, new RegExp(`\\b${column}\\b`), `schema migration omits ${column}`)
}
assert.doesNotMatch(schema, /create\s+(or\s+replace\s+)?function|create\s+trigger/i,
  'schema migration must remain schema-only')

assert.match(receipts, /p_status\s*=\s*'ACCEPTED'\s+and\s+p_channel\s+not\s+in\s*\('EMAIL',\s*'PUSH'\)/i,
  'receipt contract must allow PUSH provider acceptance')
assert.match(receipts, /sync_push_notification_outcome_on_attempt/i,
  'receipt contract must bind its reconciliation trigger')
assert.doesNotMatch(receipts, /alter\s+table\s+public\.push_tokens/i,
  'receipt contract must not carry schema changes')

for (const name of [
  'reset_push_quarantine_on_token_change',
  'register_push_token_with_provenance',
  'quarantine_repeated_bad_device_token',
  'push_tokens_reset_quarantine_on_token_change',
]) {
  assert.match(provenance, new RegExp(`\\b${name}\\b`), `provenance migration omits ${name}`)
}
assert.doesNotMatch(provenance, /insert\s+into\s+public\.push_tokens/i,
  'provenance migration must not backfill or create tokens')

console.log('push production forward migration contract passed')
