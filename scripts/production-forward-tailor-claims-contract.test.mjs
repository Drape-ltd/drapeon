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
const purgeLedgerRepair = migration('20261124154325_prod_forward_tailor_draft_purges_table.sql')

assert.equal(names.length, 5, 'Production forward batch cannot exceed five migrations')
const [foundation, bootstrap, transition, boundary, purge] = names.map(migration)
const developmentPolicyRepair = migration('20261124034830_wrap_staff_draft_rls_identity_check.sql')

for (const object of [
  'lifecycle_state',
  'tailor_claim_invites',
  'tailor_draft_media',
  'tailor_draft_action_receipts',
  'tailor-draft-media',
  'is_public_tailor_profile',
]) assert.match(foundation, new RegExp(object), `foundation omits ${object}`)

const reorderDefinitions = foundation.match(/create or replace function public\.reorder_tailor_draft_media\([\s\S]*?\)\s*returns boolean/g) ?? []
assert.equal(reorderDefinitions.length, 2, 'foundation must retain both reorder hardening definitions')
for (const definition of reorderDefinitions) {
  assert.match(definition, /p_asset_ids uuid\[\]/,
    'reorder replacements must preserve the same input parameter name')
}

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
assert.match(boundary, /not \(select public\.is_staff_draft_identity\(\)\)/i,
  'boundary must use an initPlan wrapper for the claim-session identity helper')
assert.match(boundary, /pg_get_expr\(p\.polqual, p\.polrelid\)[\s\S]*is_staff_draft_identity/i,
  'boundary coverage must reject an unwrapped policy predicate')
assert.match(boundary, /STAFF_DRAFT policy coverage missing or not initPlan-wrapped/i,
  'boundary must assert full catalog coverage')
assert.match(boundary, /pgrst\.db_pre_request/i, 'boundary must configure the PostgREST hook')
assert.match(boundary, /realtime\.messages/i, 'boundary must retain the Realtime deny layer')
assert.match(developmentPolicyRepair, /not \(select public\.is_staff_draft_identity\(\)\)/i,
  'Development repair must use the initPlan wrapper too')
assert.match(developmentPolicyRepair, /realtime\.messages/i,
  'Development repair must preserve the Realtime deny layer')
assert.match(boundary, /clear_tailor_claim_placeholder_provider_identities/i,
  'boundary must clean up provider proof on terminal failures')
assert.match(purge, /purge-tailor-drafts/, 'purge schedule is missing')

for (const definition of [
  /create table if not exists public\.tailor_draft_purges/i,
  /create index if not exists tailor_draft_purges_pending_idx/i,
  /alter table public\.tailor_draft_purges enable row level security/i,
  /revoke all on table public\.tailor_draft_purges from public, anon, authenticated/i,
  /grant select, insert, update on table public\.tailor_draft_purges to service_role/i,
]) assert.match(purgeLedgerRepair, definition, 'purge ledger repair must create the private retry ledger')

assert.doesNotMatch(purgeLedgerRepair, /create\s+or\s+replace\s+function\s+public\.reconcile_cron_edge_outcomes/i,
  'the shared reconciliation function requires a separate reviewed migration')
assert.doesNotMatch(purgeLedgerRepair, /cron\.(?:schedule|unschedule)/i,
  'the availability repair must not alter the existing purge schedule')

console.log('production-forward tailor drafts + claims migration contract passed')
