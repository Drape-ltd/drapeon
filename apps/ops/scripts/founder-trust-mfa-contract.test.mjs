import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const auth = readFileSync(new URL('../../web/lib/ops-auth.ts', import.meta.url), 'utf8')
const proof = readFileSync(new URL('../../web/lib/founder-trust-mfa.ts', import.meta.url), 'utf8')
const sessionRoute = readFileSync(new URL('../app/api/founder-trust-mfa-session/route.ts', import.meta.url), 'utf8')
const casePage = readFileSync(new URL('../app/ops/cases/[caseNumber]/page.tsx', import.meta.url), 'utf8')
const evidence = readFileSync(new URL('../../web/app/ops/identity-document/[profileId]/route.ts', import.meta.url), 'utf8')
const trustRoute = readFileSync(new URL('../app/api/actions/trust/route.ts', import.meta.url), 'utf8')
const moneyRoute = readFileSync(new URL('../app/ops/api/actions/money/route.ts', import.meta.url), 'utf8')
const exportRoute = readFileSync(new URL('../app/ops/api/exports/route.ts', import.meta.url), 'utf8')
const workforceRoute = readFileSync(new URL('../app/api/actions/workforce/route.ts', import.meta.url), 'utf8')
const deletionRoute = readFileSync(new URL('../app/api/actions/account-deletion/route.ts', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../../../supabase/migrations/20261113042617_temporary_founder_trust_totp_fallback.sql', import.meta.url), 'utf8')
const rollback = readFileSync(new URL('../../../supabase/migrations/rollback/20261113042617_temporary_founder_trust_totp_fallback.rollback.sql', import.meta.url), 'utf8')

function functionBody(source, name) {
  const start = source.indexOf(`export function ${name}`)
  const next = source.indexOf('\nexport function ', start + 1)
  return source.slice(start, next === -1 ? source.length : next)
}

test('generic protected actions do not accept the temporary founder proof', () => {
  assert.doesNotMatch(functionBody(auth, 'hasFreshOpsMfa'), /founderTrustMfa/u)
  for (const route of [moneyRoute, exportRoute, workforceRoute, deletionRoute]) {
    assert.match(route, /hasFreshOpsMfa/u)
    assert.doesNotMatch(route, /hasFreshOpsTrustMfa|founderTrustMfa/u)
  }
})

test('trust-only proof requires normal Cloudflare founder authority plus validated fresh AAL2 TOTP', () => {
  assert.match(proof, /workforceSession\.mode !== 'cloudflare-access'/u)
  assert.match(proof, /workforceSession\.role !== 'admin'/u)
  assert.match(proof, /workforceSession\.email !== FOUNDER_TRUST_EMAIL/u)
  assert.match(proof, /client\.auth\.getUser\(accessToken\)/u)
  assert.match(proof, /getAuthenticatorAssuranceLevel\(accessToken\)/u)
  assert.match(proof, /aalData\.currentLevel !== 'aal2'/u)
  assert.match(proof, /user\.id !== binding\.auth_user_id/u)
  assert.match(proof, /nowSeconds - mfaAt > FOUNDER_TRUST_MFA_MAX_AGE_SECONDS/u)
})

test('step-up never signs up users and sets a short secure strict server cookie', () => {
  assert.doesNotMatch(sessionRoute, /signUp|sign-up/u)
  assert.match(sessionRoute, /email: FOUNDER_TRUST_EMAIL/u)
  assert.match(sessionRoute, /if \(!getTurnstileSiteKey\(\)\) return response/u)
  assert.match(sessionRoute, /if \(!captchaToken\) return response/u)
  assert.match(sessionRoute, /httpOnly: true/u)
  assert.match(sessionRoute, /sameSite: 'strict'/u)
  assert.match(sessionRoute, /secure: true/u)
  assert.match(sessionRoute, /Math\.min\(session\.expires_in \?\? 900, 900\)/u)
})

test('only trust case evidence and trust decisions consume the fallback proof', () => {
  assert.match(casePage, /\/ops\/founder-mfa\?returnTo=/u)
  assert.match(casePage, /\/ops\/founder-mfa\/evidence\/trust/u)
  assert.match(evidence, /hasFreshOpsTrustMfa\(session\)/u)
  assert.match(trustRoute, /hasFreshOpsTrustMfa\(session\)/u)
  assert.match(trustRoute, /prepare_founder_mfa_trust_verification_decision/u)
})

test('customer-web trust evidence fails closed before the fallback migration exists', () => {
  const bindingStart = proof.indexOf('export async function getFounderTrustFallbackBinding')
  const bindingEnd = proof.indexOf('\nexport async function ', bindingStart + 1)
  const bindingLoader = proof.slice(bindingStart, bindingEnd)
  const proofVerifier = proof.slice(proof.indexOf('export async function verifyFounderTrustMfaProof'))
  const trustMfaGate = functionBody(auth, 'hasFreshOpsTrustMfa')

  // A missing table is returned by PostgREST as a query error. The binding
  // loader converts every query error to no binding instead of throwing or
  // manufacturing authority.
  assert.match(bindingLoader, /return error \|\| !data \? null/u)
  assert.match(proofVerifier, /\|\| !binding/u)

  // The customer-web evidence route uses the trust gate, and that gate accepts
  // no fallback path without a validated proof. The existing dedicated
  // Cloudflare sensitive-app proof remains the only pre-migration path.
  assert.match(evidence, /!hasFreshOpsTrustMfa\(session\)/u)
  assert.match(trustMfaGate, /if \(hasFreshOpsMfa\(session, maxAgeSeconds\)\) return true/u)
  assert.match(trustMfaGate, /\|\| !proof/u)
})

test('database gate is exact, append-only, auto-expiring, and reversibly disabled', () => {
  assert.match(migration, /project_ref text not null check \(project_ref = 'wkfsrunetmgjdtcurmoj'\)/u)
  assert.match(migration, /expires_at <= timestamptz '2026-12-01 06:00:00\+00'/u)
  assert.match(migration, /p_mfa_authenticated_at < now\(\) - interval '15 minutes'/u)
  assert.match(migration, /public\.current_ops_environment\(\) <> 'PRODUCTION'/u)
  assert.match(migration, /trg_ops_founder_trust_mfa_events_immutable/u)
  assert.match(migration, /where lower\(email\) = 'founders@drapeon.co'/u)
  assert.match(rollback, /set enabled = false/u)
  assert.doesNotMatch(rollback, /drop table|delete from/u)
})
