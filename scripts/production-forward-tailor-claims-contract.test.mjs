import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const migration = (name) => readFileSync(resolve(root, 'supabase/migrations', name), 'utf8')
const names = [
  '20261123174412_prod_forward_tailor_claim_draft_foundation.sql',
  '20261123174413_prod_forward_tailor_claim_email_bootstrap.sql',
  '20261123174414_prod_forward_tailor_claim_transition_finalize.sql',
  '20261123174415_prod_forward_tailor_claim_security_boundary.sql',
  '20261123174416_prod_forward_tailor_draft_purge_schedule.sql',
]

assert.equal(names.length, 5, 'Production forward batch cannot exceed five migrations')
const [foundation, bootstrap, transition, boundary, purge] = names.map(migration)

for (const object of [
  'lifecycle_state',
  'tailor_claim_invites',
  'tailor_draft_media',
  'tailor_draft_action_receipts',
  'tailor-draft-media',
  'is_public_tailor_profile',
]) assert.match(foundation, new RegExp(object), `foundation omits ${object}`)

for (const object of [
  'tailor_claim_email_paths',
  'tailor_claim_email_codes',
  'tailor_claim_email_jobs',
  'tailor_claim_bootstrap_sessions',
  'prepare_tailor_claim_provider_proof',
]) assert.match(bootstrap, new RegExp(object), `bootstrap omits ${object}`)

for (const object of [
  'tailor_claim_transition_receipts',
  'tailor_claim_finalize_receipts',
  'prepare_tailor_profile_claim',
  'complete_tailor_profile_claim',
  'prepare_tailor_profile_finalize',
  'complete_tailor_profile_finalize',
  'pickup_postal_code',
]) assert.match(transition, new RegExp(object), `transition/finalize omits ${object}`)

assert.match(boundary, /pg_class[\s\S]*pg_namespace[\s\S]*c\.relrowsecurity/i,
  'boundary must enumerate the live RLS catalog')
assert.match(boundary, /create policy deny_staff_draft_claim_session on %I\.%I as restrictive/i,
  'boundary must stamp a restrictive policy dynamically')
assert.match(boundary, /STAFF_DRAFT policy coverage missing/i,
  'boundary must assert full catalog coverage')
assert.match(boundary, /pgrst\.db_pre_request/i, 'boundary must configure the PostgREST hook')
assert.match(boundary, /realtime\.messages/i, 'boundary must retain the Realtime deny layer')
assert.match(boundary, /clear_tailor_claim_placeholder_provider_identities/i,
  'boundary must clean up provider proof on terminal failures')
assert.match(purge, /purge-tailor-drafts/, 'purge schedule is missing')

console.log('production-forward tailor drafts + claims migration contract passed')
