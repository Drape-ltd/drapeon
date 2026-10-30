import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const moneyRoute = readFileSync(new URL('../app/ops/api/actions/money/route.ts', import.meta.url), 'utf8')
const auth = readFileSync(new URL('../../web/lib/local-supabase-mfa.ts', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../../../supabase/migrations/20261030133137_dev_ops_supabase_mfa_identity_receipts.sql', import.meta.url), 'utf8')
const receiptRepair = readFileSync(new URL('../../../supabase/migrations/20261030151320_repair_local_mfa_receipt_triggers.sql', import.meta.url), 'utf8')
const behavioralTest = readFileSync(new URL('../../../supabase/tests/dev_ops_supabase_mfa_identity_receipts.sql', import.meta.url), 'utf8')
const priorMoneyDeskMigration = readFileSync(new URL('../../../supabase/migrations/20260913105000_founder_money_desk_approval.sql', import.meta.url), 'utf8')
const env = readFileSync(new URL('./verify-environment.mjs', import.meta.url), 'utf8')
const moneyDesk = readFileSync(new URL('../../web/lib/money-desk.ts', import.meta.url), 'utf8')
const devSeed = readFileSync(new URL('../../../supabase/verification/seed_dev_ops_mfa_principals.sql', import.meta.url), 'utf8')
const ownerEnablement = readFileSync(new URL('../../../supabase/verification/enable_dev_ops_mfa_owner.sql', import.meta.url), 'utf8')

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
  assert.match(migration, /create table if not exists public\.dev_ops_mfa_enablement/u)
  assert.match(migration, /revoke all on table public\.dev_ops_mfa_enablement from public, anon, authenticated, service_role/u)
  assert.match(migration, /public\.dev_ops_mfa_enablement[\s\S]+project_ref='pqptfuqogvrajozfsqzi'/u)
  assert.match(ownerEnablement, /revoke all on table public\.dev_ops_mfa_enablement from public, anon, authenticated, service_role/u)
  assert.match(ownerEnablement, /insert into public\.dev_ops_mfa_enablement\(singleton,project_ref\)[\s\S]+values\(true,'pqptfuqogvrajozfsqzi'\)/u)
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

test('legacy Money Desk decision body differs from the latest prior definition only by the local-MFA rejection', () => {
  const signature = 'create or replace function public.decide_money_desk_request('
  const extractDefinition = (source) => {
    const start = source.lastIndexOf(signature)
    assert.notEqual(start, -1, 'Money Desk decision definition is missing')
    const end = source.indexOf('\n$$;', start)
    assert.notEqual(end, -1, 'Money Desk decision definition terminator is missing')
    return source.slice(start, end + 4)
  }
  const localMfaRejection = /  if v_request\.requester_assurance_source = 'SUPABASE_MFA_LOCAL' then\n    raise exception 'A local Supabase MFA request must use the local decision path\.';\n  end if;\n/u
  const currentWithoutRejection = extractDefinition(migration).replace(localMfaRejection, '')
  assert.equal(currentWithoutRejection, extractDefinition(priorMoneyDeskMigration))
})

test('local MFA receipt triggers use table-specific functions', () => {
  const grantStart = receiptRepair.indexOf('create or replace function public.protect_local_mfa_grant_receipt_fn()')
  const requestStart = receiptRepair.indexOf('create or replace function public.protect_local_mfa_request_receipt_fn()')
  assert.notEqual(grantStart, -1)
  assert.notEqual(requestStart, -1)
  const grantBody = receiptRepair.slice(grantStart, requestStart)
  const requestBody = receiptRepair.slice(requestStart, receiptRepair.indexOf('revoke all', requestStart))
  assert.doesNotMatch(grantBody, /requester_/u)
  assert.match(requestBody, /requester_principal_id/u)
  assert.doesNotMatch(requestBody, /\bworkforce_principal_id\b|\bauth_user_id\b|\bmfa_authenticated_at\b/u)
  assert.match(receiptRepair, /execute function public\.protect_local_mfa_grant_receipt_fn\(\)/u)
  assert.match(receiptRepair, /execute function public\.protect_local_mfa_request_receipt_fn\(\)/u)
  assert.match(receiptRepair, /drop function if exists public\.protect_local_mfa_identity_receipt\(\)/u)
})

test('behavioral suite proves normal updates and rejects receipt mutations per table', () => {
  assert.match(behavioralTest, /update public\.money_desk_jit_grants set reason=reason\|\|' normal update'/u)
  assert.match(behavioralTest, /Grant receipt mutation was accepted/u)
  assert.match(behavioralTest, /update public\.money_desk_requests set approval_count=approval_count/u)
  assert.match(behavioralTest, /Request receipt mutation was accepted/u)
})
