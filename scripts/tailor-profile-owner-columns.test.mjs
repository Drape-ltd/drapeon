#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const ownerRpcMigration = readFileSync(
  join(root, 'supabase/migrations/20261117194812_restrict_tailor_profile_owner_columns.sql'),
  'utf8',
)
const batchOneDocumentAndHandoffRevokeMigration = readFileSync(
  join(root, 'supabase/migrations/20261117194900_stage_tailor_profile_document_and_handoff_revokes.sql'),
  'utf8',
)
const devOnlyEarlyRevokeMigration = readFileSync(
  join(root, 'supabase/migrations/20261117204214_stage_tailor_profile_private_column_revokes.sql'),
  'utf8',
)
const productionPolicyMigration = readFileSync(
  join(root, 'supabase/migrations/20261118014508_phase4_production_tailor_profile_policy_helpers.sql'),
  'utf8',
)
const devOnlyDocumentAndHandoffRevokeMigration = readFileSync(
  join(root, 'supabase/migrations/20261118022134_stage_tailor_profile_document_and_handoff_revokes.sql'),
  'utf8',
)
const testProfileRevokeMigration = readFileSync(
  join(root, 'supabase/migrations/20261118022149_stage_tailor_profile_test_flag_revoke.sql'),
  'utf8',
)

// Stage B0 may run before the mobile release because these fields are absent
// from the released native projection. The broader list deliberately waits for
// the RPC-capable app build and its minimum-version/adoption gate.
const batchOnePrivateColumns = [
  'id_selfie_document_url',
  'id_verification_handoff_id',
]

const deferredPrivateColumns = [
  'id_verification_metadata',
  'id_verification_method',
  'id_verification_rejected_at',
  'id_verification_rejection_reason',
  'id_verification_status',
  'id_verification_submitted_at',
  'id_verified_at',
  'payout_account_change_count',
  'payout_account_change_locked_until',
  'payout_account_last_changed_at',
  'payout_account_type',
  'payout_account_verified',
  'payout_account_verified_at',
  'payout_currency',
  'payout_destination_hold_until',
  'payout_provider',
  'payout_reverification_required',
  'paystack_recipient_code',
  'stripe_connect_account_id',
]

assert.equal(batchOnePrivateColumns.length, 2, 'Batch 1 must revoke only the two released-client-safe fields')
for (const column of ['is_test_profile', ...batchOnePrivateColumns]) {
  assert.match(devOnlyEarlyRevokeMigration, new RegExp(`'${column}'`), `Dev-only B0 proof must cover ${column}`)
}
for (const column of deferredPrivateColumns) {
  assert.doesNotMatch(devOnlyEarlyRevokeMigration, new RegExp(`'${column}'`), `B0 must not revoke ${column} before mobile is released`)
}
for (const column of batchOnePrivateColumns) {
  assert.match(batchOneDocumentAndHandoffRevokeMigration, new RegExp(`'${column}'`), `Batch 1 must revoke ${column}`)
  assert.match(devOnlyDocumentAndHandoffRevokeMigration, new RegExp(`'${column}'`), `Dev-only history must preserve ${column}`)
}
assert.doesNotMatch(
  batchOneDocumentAndHandoffRevokeMigration,
  /'is_test_profile'|revoke\s+select\s*\(\s*is_test_profile\s*\)/iu,
  'Batch 1 must not revoke the policy input before the helper',
)
assert.match(testProfileRevokeMigration, /is_test_profile/u, 'B0b must revoke is_test_profile after the helper')
for (const column of ['id_selfie_document_url', 'id_verification_handoff_id']) {
  assert.doesNotMatch(testProfileRevokeMigration, new RegExp(`'${column}'`), `B0b must only revoke is_test_profile`)
}
assert.match(ownerRpcMigration, /security definer/i)
assert.match(ownerRpcMigration, /where tp\.user_id::text = \(select auth\.uid\(\)\)::text/i)
assert.match(ownerRpcMigration, /revoke all on function public\.get_my_tailor_account_profile\(\) from public/i)
assert.match(ownerRpcMigration, /grant execute on function public\.get_my_tailor_account_profile\(\) to authenticated/i)
assert.doesNotMatch(ownerRpcMigration, /revoke select \(/i, 'owner RPC migration must remain additive')

for (const helper of ['is_my_tailor_profile', 'is_public_tailor_profile']) {
  assert.match(
    productionPolicyMigration,
    new RegExp(`create or replace function public\\.${helper}\\(p_tailor_profile_id text\\)[\\s\\S]*?security definer`, 'i'),
    `${helper} must keep profile-policy checks in a narrow security-definer helper`,
  )
}
assert.match(productionPolicyMigration, /drop policy if exists "public: view live portfolio"/i)
assert.match(productionPolicyMigration, /using \(public\.is_public_tailor_profile\(tailor_profile_id::text\)\)/i)
assert.match(productionPolicyMigration, /using \(public\.is_my_tailor_profile\(tailor_profile_id::text\)\)/i)

// These are the complete browser-account profile fields that the owner RPC
// deliberately projects. Keeping them here makes an accidental regression to
// a direct table read visible in review.
for (const field of [
  'display_name',
  'business_name',
  'bio',
  'location',
  'languages',
  'specialty_tags',
  'currency',
  'availability',
  'portfolio_video_urls',
  'marketplace_category',
  'id_verification_status',
  'payout_account_verified',
  'payout_provider',
]) {
  assert.match(ownerRpcMigration, new RegExp(`'${field}'`), `owner RPC must project ${field}`)
}

// The owner RPC is deliberately a narrower account projection, not a way to
// return identity-document locations or provider account identifiers to a
// browser client. Keep those out even before the later B migration removes
// their legacy direct-column grants.
for (const field of [
  'id_selfie_document_url',
  'id_verification_handoff_id',
  'paystack_recipient_code',
  'stripe_connect_account_id',
]) {
  assert.doesNotMatch(
    ownerRpcMigration,
    new RegExp(`tp\\.${field}`),
    `owner RPC must not expose ${field}`,
  )
}

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(?:ts|tsx)$/u.test(entry.name) ? [path] : []
  })
}

const directProfileSelect = /\.from\(['"]tailor_profiles['"]\)[\s\S]{0,1000}?\.select\((['"`])([\s\S]*?)\1\)/gu
for (const app of ['apps/web/features/account', 'apps/web/components', 'apps/mobile']) {
  for (const file of sourceFiles(join(root, app))) {
    // Ops server reads use an authenticated Ops server client, not a browser
    // publishable-key session. The account and mobile surfaces are the public
    // client boundary this contract protects.
    if (file.includes('/apps/web/components/account-preview/')) continue
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(directProfileSelect)) {
      for (const column of ['is_test_profile', ...batchOnePrivateColumns]) {
        assert.equal(
          match[2].includes(column),
          false,
        `${file} directly selects owner-only tailor_profiles.${column}; use get_my_tailor_account_profile instead`,
        )
      }
    }
  }
}

const evidence = readFileSync(join(root, 'docs/tailor-profile-owner-column-security.md'), 'utf8')
for (const column of deferredPrivateColumns) {
  assert.match(evidence, new RegExp('`' + column + '`'), `release plan must preserve the later B gate for ${column}`)
}
assert.match(evidence, /minimum-version\/adoption gate/i)
const productionPlan = evidence.split('## Production promotion plan')[1]
assert.doesNotMatch(
  productionPlan,
  /20261117204214/u,
  'the Dev-only B0 migration must never be included in a Production batch',
)
assert.match(productionPlan, /20261117194812[\s\S]*20261117194900[\s\S]*id_selfie_document_url[\s\S]*id_verification_handoff_id/u)
assert.match(productionPlan, /20261118014508[\s\S]*20261118022149/u)
assert.doesNotMatch(
  productionPlan,
  /20261118022134/u,
  'the Dev-only B0a history migration must never be included in a Production batch',
)

// The only Edge reader of the B0-only `is_test_profile` filter is public
// read-gateway. It authenticates requests itself but deliberately queries with
// the service role and returns a projection that does not expose that field.
const readGateway = readFileSync(join(root, 'supabase/functions/read-gateway/index.ts'), 'utf8')
assert.match(readGateway, /import \{ getServiceRoleKey, getSupabaseUrl \}/)
assert.match(readGateway, /createClient\(getSupabaseUrl\(\), getServiceRoleKey\(\)\)/)

for (const helper of [
  'apps/web/lib/own-tailor-profile.ts',
  'apps/mobile/lib/tailor-profile-guard.ts',
]) {
  assert.match(
    readFileSync(join(root, helper), 'utf8'),
    /get_my_tailor_account_profile/,
    `${helper} must use the owner-scoped RPC`,
  )
}

console.log('Tailor owner-column contract passed.')
