import assert from 'node:assert/strict'
import test from 'node:test'

import { canResolveLocalWorkforcePrincipal } from './local-workforce-principal-policy.mjs'

test('allows both development-only named workforce session modes', () => {
  for (const mode of ['local-workforce', 'local-supabase-mfa']) {
    assert.equal(canResolveLocalWorkforcePrincipal({
      nodeEnv: 'development',
      mode,
      email: 'founders@drapeon.co',
    }), true, mode)
  }
})

test('rejects production, remote, bootstrap, and unnamed sessions', () => {
  assert.equal(canResolveLocalWorkforcePrincipal({
    nodeEnv: 'production', mode: 'local-supabase-mfa', email: 'founders@drapeon.co',
  }), false)
  assert.equal(canResolveLocalWorkforcePrincipal({
    nodeEnv: 'development', mode: 'cloudflare-access', email: 'founders@drapeon.co',
  }), false)
  assert.equal(canResolveLocalWorkforcePrincipal({
    nodeEnv: 'development', mode: 'bootstrap-token', email: 'founders@drapeon.co',
  }), false)
  assert.equal(canResolveLocalWorkforcePrincipal({
    nodeEnv: 'development', mode: 'local-supabase-mfa', email: null,
  }), false)
})
