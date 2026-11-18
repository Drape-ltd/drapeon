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
const hardeningMigration = readFileSync(
  new URL('../../migrations/20261117213656_harden_tailor_claim_email_verification.sql', import.meta.url),
  'utf8'
)
const bootstrapMigration = readFileSync(
  new URL('../../migrations/20261117225500_add_tailor_claim_bootstrap_sessions.sql', import.meta.url),
  'utf8'
)
const providerBootstrapMigration = readFileSync(
  new URL('../../migrations/20261118021045_add_tailor_claim_provider_bootstrap.sql', import.meta.url),
  'utf8'
)
const sharedAuth = readFileSync(new URL('../_shared/auth.ts', import.meta.url), 'utf8')

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

test('email and code digests use the dedicated claim HMAC key', () => {
  assert.match(source, /TAILOR_CLAIM_HMAC_KEY/)
  assert.match(source, /keyedHash\(`email:/)
  assert.match(source, /keyedHash\(`code:/)
  assert.doesNotMatch(source, /importKey\([\s\S]{0,160}getServiceRoleKey\(\)/)
})

test('state gates precede the account collision lookup', () => {
  const inviteGate = hardeningMigration.indexOf("v_invite.status not in ('INVITED', 'OPENED')")
  const pathGate = hardeningMigration.indexOf('v_path.locked_at is not null')
  const expiryGate = hardeningMigration.indexOf('v_code.expires_at <= now()')
  const collision = hardeningMigration.indexOf('select 1 from auth.users')
  assert.ok(inviteGate > 0 && inviteGate < collision)
  assert.ok(pathGate > inviteGate && pathGate < collision)
  assert.ok(expiryGate > pathGate && expiryGate < collision)
  assert.match(hardeningMigration, /where au\.email = p_email/)
  assert.doesNotMatch(source, /ctaUrl: 'https:\/\/drapeon\.co'/)
})

test('bootstrap session is short-lived and the real JWT stays inert outside claim', () => {
  assert.match(bootstrapMigration, /now\(\) \+ interval '10 minutes'/)
  assert.match(bootstrapMigration, /is_staff_draft_identity/)
  assert.match(bootstrapMigration, /as restrictive for all to authenticated/)
  assert.match(bootstrapMigration, /not public\.is_staff_draft_identity\(\)/)
  assert.match(bootstrapMigration, /is_active_tailor_claim_bootstrap_session/)
  assert.match(bootstrapMigration, /auth_session_id = nullif\(auth\.jwt\(\) ->> 'session_id'/)
  assert.match(sharedAuth, /account_origin === 'STAFF_DRAFT'/)
  assert.match(sharedAuth, /blocked STAFF_DRAFT claim session/)
  assert.match(source, /BOOTSTRAP_EMAIL_SESSION/)
  assert.match(source, /type: 'magiclink'/)
  assert.match(source, /verifyOtp/)
  assert.match(source, /activate_tailor_claim_bootstrap_session/)
})

test('provider bootstrap and verification stay bound to the placeholder session', () => {
  assert.match(providerBootstrapMigration, /prepare_tailor_claim_provider_bootstrap_session/)
  assert.match(providerBootstrapMigration, /v_invite\.status not in \('INVITED', 'OPENED'\)/)
  assert.doesNotMatch(providerBootstrapMigration, /tailor_claim_email_codes/)
  assert.match(source, /BOOTSTRAP_PROVIDER_SESSION/)
  assert.match(source, /getActiveStaffDraftClaimSession\(request\)/)
  assert.match(source, /identity\.id === identityId/)
  assert.match(source, /identity\.provider === provider/)
  assert.match(source, /identity\.user_id === claimSession\.userId/)
  assert.match(source, /invite\?\.token_hash !== hash/)
  assert.match(source, /tailor_claim\.provider_identity_verified/)
})
