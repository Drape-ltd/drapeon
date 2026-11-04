import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const route = readFileSync(new URL('../app/api/actions/trust/route.ts', import.meta.url), 'utf8')
const gate = readFileSync(
  new URL('../../web/lib/local-supabase-mfa-policy.mjs', import.meta.url),
  'utf8'
)

test('local trust decisions require the exact Dev-only Supabase MFA gate', () => {
  assert.match(route, /session\.mode === 'local-supabase-mfa'/u)
  assert.match(route, /isLocalSupabaseMfaEnabled\(\)/u)
  assert.match(route, /client\.rpc\('is_dev_ops_mfa_environment'\)/u)
  assert.match(route, /devEnvironment !== true/u)
  assert.match(gate, /env\.OPS_LOCAL_SUPABASE_MFA === '1'/u)
  assert.match(gate, /env\.NODE_ENV !== 'production'/u)
  assert.match(gate, /urlRef === DEV_SUPABASE_PROJECT_REF/u)
  assert.match(gate, /expectedRef === DEV_SUPABASE_PROJECT_REF/u)
})

test('local trust actor is bound to the verified Auth user and an active Dev principal', () => {
  assert.match(route, /!session\.authUserId\s*\|\|\s*!session\.principalId/u)
  assert.match(route, /\.eq\('id', session\.principalId\)/u)
  assert.match(route, /\.eq\('auth_user_id', session\.authUserId\)/u)
  assert.match(route, /principal\.status !== 'ACTIVE'/u)
  assert.match(route, /role === 'admin' \|\| role === 'trust'/u)
  assert.match(route, /environments\.includes\('development'\)/u)
  assert.match(route, /principal\.access_review_due_at/u)
})

test('local trust path preserves preflight, authoritative domain action, and terminal receipt', () => {
  assert.match(route, /client\.rpc\(\s*'prepare_ops_trust_verification_decision'/u)
  assert.match(route, /p_actor_principal_id: principal\.id/u)
  assert.match(route, /p_environment: 'DEVELOPMENT'/u)
  assert.match(route, /client\.functions\.invoke\(\s*'handle-verification-decision'/u)
  assert.match(route, /client\.rpc\('complete_ops_action_receipt'/u)
  assert.match(route, /outcome: 'FAILED'/u)
  assert.match(route, /outcome: 'SUCCEEDED'/u)
  assert.match(route, /receiptOutcome !== 'SUCCEEDED'/u)
})

test('production Cloudflare trust broker remains independently enforced', () => {
  assert.match(route, /\['cloudflare-access', 'local-supabase-mfa'\]\.includes\(session\.mode\)/u)
  assert.match(route, /validateServiceRoleTarget\(/u)
  assert.match(route, /cf-access-jwt-assertion/u)
  assert.match(route, /cloudflare-access-assertion-required/u)
  assert.match(route, /x-drape-ops-access-assertion/u)
})
