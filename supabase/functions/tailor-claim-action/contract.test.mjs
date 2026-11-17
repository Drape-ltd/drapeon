import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
const config = readFileSync(new URL('../../config.toml', import.meta.url), 'utf8')
const migration = readFileSync(
  new URL('../../migrations/20261117212042_add_tailor_claim_email_codes.sql', import.meta.url),
  'utf8'
)
const collisionMigration = readFileSync(
  new URL('../../migrations/20261117212930_add_tailor_claim_email_collision_guard.sql', import.meta.url),
  'utf8'
)

test('public resolver fails closed and returns no draft identifiers', () => {
  assert.match(source, /resolve_tailor_claim_preview/)
  assert.match(source, /rateLimit\(client, ip/)
  assert.match(source, /rateLimit\(client, hash/)
  assert.match(source, /return json\(\{ actionable: true \}\)/)
  assert.doesNotMatch(source, /return json\(\{[^\n]*(invite_id|profile_id)/)
})

test('the public resolver explicitly owns JWT and audit handling', () => {
  assert.match(config, /\[functions\.tailor-claim-action\]\s+verify_jwt = false/u)
  assert.match(source, /await audit\(client/)
  assert.match(source, /tailor_claim\.app_link_opened/)
})

test('claim email codes store digests and enforce the agreed budgets', () => {
  assert.match(migration, /code_hash text not null/)
  assert.match(migration, /email_hash text not null/)
  assert.doesNotMatch(migration, /\bcode text\b|\bemail text\b/)
  assert.match(migration, /now\(\) \+ interval '10 minutes'/)
  assert.match(migration, /attempts between 0 and 5/)
  assert.match(migration, /v_hour_count >= 5/)
  assert.match(migration, /v_day_count >= 10/)
  assert.match(migration, /CODE_REQUEST_LIMIT/)
  assert.match(migration, /CODE_ATTEMPT_LIMIT/)
})

test('the client is told sent only after a provider outcome is recorded', () => {
  const recordCall = source.indexOf("rpc('record_tailor_claim_email_job_outcome'")
  const sentResponse = source.indexOf('return json({ sent: true')
  assert.ok(recordCall > 0)
  assert.ok(sentResponse > recordCall)
  assert.match(source, /recorded !== true/)
  assert.match(source, /Idempotency-Key/)
})

test('a verified address collision stops before any account mutation', () => {
  assert.match(collisionMigration, /auth\.users/)
  assert.match(collisionMigration, /public\.users/)
  assert.match(collisionMigration, /ACCOUNT_CONFLICT/)
  assert.match(collisionMigration, /v_code\.code_hash = p_code_hash/)
  assert.doesNotMatch(collisionMigration, /update\s+auth\.users|update\s+public\.users/)
  assert.match(source, /error: 'ACCOUNT_CONFLICT'/)
})
