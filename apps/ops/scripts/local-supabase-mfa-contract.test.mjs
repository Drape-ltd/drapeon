import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const moneyRoute = readFileSync(new URL('../app/ops/api/actions/money/route.ts', import.meta.url), 'utf8')
const auth = readFileSync(new URL('../../web/lib/local-supabase-mfa.ts', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../../../supabase/migrations/20261030133137_dev_ops_supabase_mfa_identity_receipts.sql', import.meta.url), 'utf8')
const env = readFileSync(new URL('./verify-environment.mjs', import.meta.url), 'utf8')
const moneyDesk = readFileSync(new URL('../../web/lib/money-desk.ts', import.meta.url), 'utf8')
const devSeed = readFileSync(new URL('../../../supabase/verification/seed_dev_ops_mfa_principals.sql', import.meta.url), 'utf8')

test('legacy local-workforce cannot approve or execute money movement', () => {
  assert.match(moneyRoute, /session\.mode === 'local-workforce' && \(action === 'DECIDE' \|\| action === 'EXECUTE'\)/u)
  assert.match(moneyDesk, /legacy local workforce bridge cannot create approval receipts/u)
  assert.match(moneyDesk, /legacy local workforce bridge cannot execute Money Desk requests/u)
})

test('server validates the JWT, AAL2, fresh TOTP and binds by Auth user id', () => {
  assert.match(auth, /auth\.getUser\(accessToken\)/u)
  assert.match(auth, /getAuthenticatorAssuranceLevel\(accessToken\)/u)
  assert.match(auth, /aalData\.currentLevel !== 'aal2'/u)
  assert.match(auth, /newestTotpTimestamp\(payload\.amr\)/u)
  assert.match(auth, /\.eq\('auth_user_id', user\.id\)/u)
  assert.doesNotMatch(auth, /\.eq\('email',/u)
})

test('database stores receipts and enforces distinct principals', () => {
  for (const field of ['approver_principal_id','approver_auth_user_id','approver_aal','approver_mfa_at','approver_assurance_source']) assert.match(migration, new RegExp(field, 'u'))
  assert.match(migration, /requester_principal_id=p_principal_id or v_request\.requester_auth_user_id=p_auth_user_id/u)
  assert.match(migration, /approver_principal_id=p_principal_id or approver_auth_user_id=p_auth_user_id/u)
  assert.match(migration, /required_approval_count:=2/u)
  assert.match(migration, /public\.is_dev_ops_mfa_environment\(\)/u)
  assert.match(migration, /email_confirmed_at is not null/u)
  assert.match(migration, /requester_assurance_source is distinct from 'SUPABASE_MFA_LOCAL'/u)
  assert.match(migration, /requester_assurance_source = 'SUPABASE_MFA_LOCAL'[\s\S]+local Supabase MFA request must use the local decision path/u)
  assert.match(migration, /assurance_source is distinct from 'SUPABASE_MFA_LOCAL'/u)
  assert.doesNotMatch(migration, /insert into public\.ops_workforce_principals/u)
  assert.match(devSeed, /if not public\.is_dev_ops_mfa_environment\(\)[\s\S]+insert into public\.ops_workforce_principals[\s\S]+end \$seed\$/u)
})

test('production verification rejects the local MFA flag', () => {
  assert.match(env, /OPS_LOCAL_SUPABASE_MFA/u)
})
