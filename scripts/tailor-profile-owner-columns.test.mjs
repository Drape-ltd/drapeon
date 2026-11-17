#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const migration = readFileSync(
  join(root, 'supabase/migrations/20261117194812_restrict_tailor_profile_owner_columns.sql'),
  'utf8',
)
const policyMigration = readFileSync(
  join(root, 'supabase/migrations/20261117202000_harden_tailor_profile_policy_helpers.sql'),
  'utf8',
)

const ownerOnlyColumns = [
  'is_test_profile',
  'id_selfie_document_url',
  'id_verification_handoff_id',
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

for (const column of ownerOnlyColumns) {
  assert.match(migration, new RegExp(`'${column}'`), `migration must revoke ${column}`)
}
assert.match(migration, /security definer/i)
assert.match(migration, /where tp\.user_id::text = \(select auth\.uid\(\)\)::text/i)
assert.match(migration, /revoke all on function public\.get_my_tailor_account_profile\(\) from public/i)
assert.match(migration, /grant execute on function public\.get_my_tailor_account_profile\(\) to authenticated/i)
assert.match(migration, /revoke select \(id_verification_status\).*from anon/i)

for (const helper of ['is_my_tailor_profile', 'is_public_tailor_profile']) {
  assert.match(
    policyMigration,
    new RegExp(`create or replace function public\\.${helper}\\(p_tailor_profile_id text\\)[\\s\\S]*?security definer`, 'i'),
    `${helper} must keep profile-policy checks in a narrow security-definer helper`,
  )
}
assert.match(policyMigration, /drop policy if exists "public: view live portfolio"/i)
assert.match(policyMigration, /using \(public\.is_public_tailor_profile\(tailor_profile_id\)\)/i)
assert.match(policyMigration, /using \(public\.is_my_tailor_profile\(tailor_profile_id\)\)/i)

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
  assert.match(migration, new RegExp(`'${field}'`), `owner RPC must project ${field}`)
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
      for (const column of ownerOnlyColumns) {
        assert.equal(
          match[2].includes(column),
          false,
          `${file} directly selects owner-only tailor_profiles.${column}; use get_my_tailor_account_profile instead`,
        )
      }
    }
  }
}

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
