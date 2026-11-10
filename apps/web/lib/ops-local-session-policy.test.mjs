import assert from 'node:assert/strict'
import test from 'node:test'
import { localOpsSessionReason } from './ops-local-session-policy.mjs'

test('an expired Dev MFA session routes to sign-in rather than a data outage', () => {
  assert.equal(localOpsSessionReason('local-supabase-mfa', false, false), 'session-expired')
  assert.equal(localOpsSessionReason('local-supabase-mfa', false, true), 'session-expired')
})

test('an active Dev MFA session reports a real data failure separately', () => {
  assert.equal(localOpsSessionReason('local-supabase-mfa', true, false), 'data-unavailable')
  assert.equal(localOpsSessionReason('local-supabase-mfa', true, true), null)
})

test('other access modes keep their existing routing', () => {
  assert.equal(localOpsSessionReason('cloudflare-access', false, false), null)
  assert.equal(localOpsSessionReason('bootstrap-token', false, false), null)
})
