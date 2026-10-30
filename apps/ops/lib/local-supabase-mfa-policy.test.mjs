import assert from 'node:assert/strict'
import test from 'node:test'
import { DEV_SUPABASE_PROJECT_REF, PROD_SUPABASE_PROJECT_REF, localSupabaseMfaGate } from '../../web/lib/local-supabase-mfa-policy.mjs'

const dev = {
  NODE_ENV: 'development', DRAPE_OPS_ENV: 'development', OPS_LOCAL_SUPABASE_MFA: '1',
  DRAPE_EXPECTED_SUPABASE_PROJECT_REF: DEV_SUPABASE_PROJECT_REF,
  NEXT_PUBLIC_SUPABASE_URL: `https://${DEV_SUPABASE_PROJECT_REF}.supabase.co`,
}

test('allows only the exact Dev project in a non-production runtime with the explicit flag', () => {
  assert.equal(localSupabaseMfaGate(dev).allowed, true)
  assert.equal(localSupabaseMfaGate({ ...dev, OPS_LOCAL_SUPABASE_MFA: undefined }).allowed, false)
  assert.equal(localSupabaseMfaGate({ ...dev, NODE_ENV: 'production' }).allowed, false)
  assert.equal(localSupabaseMfaGate({ ...dev, DRAPE_OPS_ENV: 'production' }).allowed, false)
})

test('denies the Prod project even when the local MFA flag is on', () => {
  assert.equal(localSupabaseMfaGate({
    ...dev,
    DRAPE_EXPECTED_SUPABASE_PROJECT_REF: PROD_SUPABASE_PROJECT_REF,
    NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_SUPABASE_PROJECT_REF}.supabase.co`,
  }).allowed, false)
})

test('denies a mismatched expected project ref', () => {
  assert.equal(localSupabaseMfaGate({ ...dev, DRAPE_EXPECTED_SUPABASE_PROJECT_REF: PROD_SUPABASE_PROJECT_REF }).allowed, false)
})
