import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import test from 'node:test'

const root = new URL('..', import.meta.url)
const migration = await readFile(
  new URL('../supabase/migrations/20261124170000_restrict_remaining_security_definer_executes.sql', import.meta.url),
  'utf8',
)
const orderGrantMigration = await readFile(
  new URL('../supabase/migrations/20260316000002_rls_hardening.sql', import.meta.url),
  'utf8',
)
const fundedFabricMigration = await readFile(
  new URL('../supabase/migrations/20260821120000_fabric_funding_v2_candidates_handoffs.sql', import.meta.url),
  'utf8',
)
const fundedFabricTriggerMigration = await readFile(
  new URL('../supabase/migrations/20260801160000_fabric_receipt_reconciliation_settlement.sql', import.meta.url),
  'utf8',
)

const functions = [
  ['public.audit_measurement_scan_change()', 'service/trigger-only', []],
  ['public.capture_public_marketplace_visibility_change()', 'service/trigger-only', []],
  ['public.cleanup_terminal_tailor_claim_provider_identity()', 'service/trigger-only', []],
  ['public.compute_tailor_profile_completed()', 'service/trigger-only', []],
  ['public.compute_tailor_ranking_score()', 'service/trigger-only', []],
  ['public.enqueue_welcome_after_user_created()', 'service/trigger-only', []],
  ['public.get_order_fabric_cutting_blockers_v2(text)', 'service/trigger-only', [
    'supabase/functions/fabric-workflow-action/index.ts',
    'supabase/functions/tailor-order-action/index.ts',
  ]],
  ['public.handle_new_user()', 'service/trigger-only', []],
  ['public.increment_tailor_total_orders()', 'service/trigger-only', []],
  ['public.is_public_tailor_profile(text)', 'intended-public', []],
  ['public.lock_fabric_allocation_on_quote_acceptance()', 'service/trigger-only', []],
  ['public.mark_my_communication_inbox(uuid,text)', 'authenticated-only', ['supabase/functions/communications-action/index.ts']],
  ['public.prepare_account_phone()', 'service/trigger-only', []],
  ['public.prepare_customer_profile_phone()', 'service/trigger-only', []],
  ['public.record_dispatch_method_stage_transition()', 'service/trigger-only', []],
  ['public.record_public_visibility_tombstone(text,uuid,text,text,jsonb)', 'service/trigger-only', []],
  ['public.refresh_wishlist_collection_summary(uuid)', 'service/trigger-only', []],
  ['public.refresh_wishlist_collection_summary_trigger()', 'service/trigger-only', []],
  ['public.reject_staff_draft_data_api_request()', 'intended-public', []],
  ['public.rls_auto_enable()', 'service/trigger-only', []],
  ['public.set_my_communication_preference(text,text,boolean,text)', 'authenticated-only', ['supabase/functions/communications-action/index.ts']],
  ['public.set_my_marketing_consent(text,boolean,text,text,jsonb)', 'authenticated-only', ['supabase/functions/communications-action/index.ts']],
  ['public.set_review_published_at()', 'service/trigger-only', []],
  ['public.sync_financial_case_from_legacy_dispute()', 'service/trigger-only', []],
  ['public.sync_public_user_email_after_auth_change()', 'service/trigger-only', []],
  ['public.sync_settlement_evidence_from_order()', 'service/trigger-only', []],
  ['public.touch_wishlist_collection()', 'service/trigger-only', []],
  ['public.update_tailor_rating_stats()', 'service/trigger-only', []],
]

function block(name) {
  const match = migration.match(new RegExp(`${name} constant text\\[\\] := array\\[([\\s\\S]*?)\\n  \\];`, 'u'))
  assert.ok(match, `missing ${name}`)
  return match[1]
}

const classificationBlocks = {
  'service/trigger-only': block('service_or_trigger_signatures'),
  'authenticated-only': block('authenticated_signatures'),
  'intended-public': block('intended_public_signatures'),
}

async function sourceFiles(path) {
  const entries = await readdir(new URL(`../${path}/`, import.meta.url), { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const relative = join(path, entry.name)
    if (entry.isDirectory()) return sourceFiles(relative)
    if (!['.js', '.jsx', '.mjs', '.ts', '.tsx'].includes(extname(entry.name))) return []
    if (/\.test\.[^.]+$/u.test(entry.name)) return []
    return [relative]
  }))
  return nested.flat()
}

const scopedFiles = (await Promise.all(['apps', 'packages', 'supabase/functions'].map(sourceFiles))).flat()
const scopedSources = await Promise.all(scopedFiles.map(async (path) => [path, await readFile(new URL(`../${path}`, import.meta.url), 'utf8')]))

for (const [signature, classification, callers] of functions) {
  test(`${signature} has an explicit ${classification} contract`, () => {
    assert.match(classificationBlocks[classification], new RegExp(signature.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))
    assert.match(migration, /grant execute on function %s to service_role|grant execute on function %s to authenticated, service_role|grant execute on function %s to anon, authenticated, service_role/u)
  })

  test(`${signature} runtime callers are recorded`, () => {
    const functionName = signature.slice('public.'.length, signature.indexOf('('))
    const found = scopedSources.filter(([, source]) => source.includes(functionName)).map(([path]) => path).sort()
    assert.deepEqual(found, [...callers].sort())
  })
}

test('service and user-token callers retain the roles their RPCs require', async () => {
  const fabric = await readFile(new URL('../supabase/functions/fabric-workflow-action/index.ts', import.meta.url), 'utf8')
  const tailor = await readFile(new URL('../supabase/functions/tailor-order-action/index.ts', import.meta.url), 'utf8')
  const communications = await readFile(new URL('../supabase/functions/communications-action/index.ts', import.meta.url), 'utf8')

  assert.match(fabric, /createClient\(getSupabaseUrl\(\), getServiceRoleKey\(\)\)/u)
  assert.match(tailor, /SUPABASE_SERVICE_ROLE_KEY/u)
  assert.match(communications, /getSupabaseAnonKey\(\)[\s\S]*Authorization: authorization/u)
  assert.match(migration, /grant execute on function %s to authenticated, service_role/u)
  assert.match(migration, /grant execute on function %s to anon, authenticated, service_role/u)
  assert.match(migration, /grant execute on function %s to authenticator/u)
})

test('all 28 Production findings are covered exactly once', () => {
  assert.equal(functions.length, 28)
  assert.equal(new Set(functions.map(([signature]) => signature)).size, 28)
})

test('guard_funded_fabric_cutting cannot be invoked by an authenticated stage update', () => {
  assert.match(orderGrantMigration, /revoke update on table orders from authenticated/iu)
  const safeColumns = orderGrantMigration.match(/column_name\s+=\s+any\(array\[([\s\S]*?)\]\)/iu)
  assert.ok(safeColumns, 'authenticated orders UPDATE allowlist is missing')
  assert.doesNotMatch(safeColumns[1], /['"]stage['"]/iu)

  assert.match(
    fundedFabricTriggerMigration,
    /create trigger orders_guard_funded_fabric_cutting before update of stage on public\.orders[\s\S]*?execute function public\.guard_funded_fabric_cutting\(\)/iu,
  )
  assert.match(fundedFabricMigration, /create or replace function public\.guard_funded_fabric_cutting\(\) returns trigger language plpgsql set search_path=/iu)
  assert.doesNotMatch(fundedFabricMigration, /guard_funded_fabric_cutting\(\)[^$]*security definer/iu)
})
