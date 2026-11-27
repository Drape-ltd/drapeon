import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const config = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'wrangler.dev.jsonc'), 'utf8'))
const vars = config.vars ?? {}
const requiredSecrets = new Set(config.secrets?.required ?? [])

assert.equal(config.name, 'drape-ops-dev')
assert.equal(config.workers_dev, false)
assert.equal(config.preview_urls, false)
assert.deepEqual(config.routes?.map((route) => route.pattern), ['ops-dev.drapeon.co/*'])
assert.equal(vars.DRAPE_OPS_ENV, 'development')
assert.equal(vars.DRAPE_EXPECTED_SUPABASE_PROJECT_REF, 'pqptfuqogvrajozfsqzi')
assert.equal(vars.NEXT_PUBLIC_SUPABASE_URL, 'https://pqptfuqogvrajozfsqzi.supabase.co')
assert.equal(vars.NEXT_PUBLIC_SITE_URL, 'https://ops-dev.drapeon.co')
assert.equal(vars.OPS_HOSTNAME, 'ops-dev.drapeon.co')
assert.equal(vars.OPS_CANONICAL_ORIGIN, 'https://ops-dev.drapeon.co')
assert.equal(vars.CF_ACCESS_TEAM_DOMAIN, 'drapeon.cloudflareaccess.com')
assert.deepEqual(new Set(vars.OPS_ALLOWED_EMAILS.split(',')), new Set([
  'dimowoope@gmail.com', 'koleosho530@gmail.com', 'founders@drapeon.co',
]))
for (const key of ['CF_ACCESS_AUD', 'CF_ACCESS_SENSITIVE_AUD', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
  assert.ok(requiredSecrets.has(key), `${key} must be a required Dev Worker secret`)
  assert.equal(Object.hasOwn(vars, key), false, `${key} must not be committed as a Dev Worker var`)
}
for (const key of ['SUPABASE_SERVICE_ROLE_KEY', 'OPS_DASHBOARD_TOKEN', 'OPS_LOCAL_WORKFORCE_DRY_RUN',
  'OPS_LOCAL_SUPABASE_MFA', 'OPS_ALLOW_BOOTSTRAP_IN_PRODUCTION']) {
  assert.equal(Object.hasOwn(vars, key), false, `${key} must not be bound to Dev Ops`)
  assert.equal(requiredSecrets.has(key), false, `${key} must not be a Dev Ops secret`)
}
console.log('[ops env] Dev Ops is isolated to ops-dev.drapeon.co and the Dev Supabase project.')
