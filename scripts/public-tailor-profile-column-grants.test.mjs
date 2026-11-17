import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const baseUrl = process.env.SUPABASE_TEST_URL
const publishableKey = process.env.SUPABASE_TEST_ANON_KEY
const authenticatedToken = process.env.SUPABASE_TEST_AUTH_JWT

const catalogueColumns = [
  'id',
  'display_name',
  'business_name',
  'avatar_url',
  'location',
  'availability',
  'shop_paused',
  'is_live',
]

// Read-only Production baseline, captured from
// information_schema.column_privileges on 2026-11-17. The roles deliberately
// differ: public marketplace reads are narrower than a signed-in tailor's own
// profile and setup reads.
const expectedColumnsByRole = {
  anon: [
    'accepts_custom_orders_now', 'availability', 'avatar_url', 'avg_rating',
    'avg_response_hours', 'bio', 'business_name', 'created_at', 'currency',
    'delivery_available', 'delivery_fee', 'display_name', 'id',
    'id_verification_status', 'is_live', 'is_verified', 'languages', 'location',
    'marketplace_category', 'pickup_available', 'portfolio_photo_urls',
    'portfolio_video_urls', 'price_range_max', 'price_range_min',
    'profile_completed', 'ranking_score', 'seller_type', 'shipping_available',
    'shipping_fee', 'ships_internationally', 'shop_paused', 'specialty_tags',
    'supports_custom_orders', 'supports_ready_made', 'tier', 'total_orders',
    'total_reviews', 'updated_at',
  ],
  authenticated: [
    'accepts_custom_orders_now', 'availability', 'avatar_url', 'avg_rating',
    'avg_response_hours', 'bio', 'business_name', 'bypass_attempts',
    'consultation_call_type', 'consultation_currency',
    'consultation_duration_minutes', 'consultation_fee_amount',
    'consultation_fee_creditable', 'consultation_mode',
    'consultation_policy_published_at', 'consultation_policy_version',
    'consultation_requirement', 'created_at', 'currency', 'delivery_available',
    'delivery_fee', 'display_name', 'id', 'id_selfie_document_url',
    'id_verification_handoff_id', 'id_verification_metadata',
    'id_verification_method', 'id_verification_rejected_at',
    'id_verification_rejection_reason', 'id_verification_status',
    'id_verification_submitted_at', 'id_verified_at', 'is_live',
    'is_test_profile', 'is_verified', 'languages', 'location',
    'marketplace_category', 'payout_account_change_count',
    'payout_account_change_locked_until', 'payout_account_last_changed_at',
    'payout_account_type', 'payout_account_verified',
    'payout_account_verified_at', 'payout_currency',
    'payout_destination_hold_until', 'payout_provider',
    'payout_reverification_required', 'paystack_recipient_code',
    'pickup_available', 'portfolio_photo_urls', 'portfolio_video_urls',
    'price_range_max', 'price_range_min', 'profile_completed', 'ranking_score',
    'seller_type', 'shipping_available', 'shipping_fee',
    'ships_internationally', 'shop_paused', 'specialty_tags',
    'stripe_connect_account_id', 'supports_custom_orders',
    'supports_ready_made', 'tier', 'tier_lost_at', 'total_orders',
    'total_reviews', 'updated_at', 'user_id',
  ],
}

const publicAppProjections = {
  catalogue: catalogueColumns,
  mobileSearch: [
    'id', 'display_name', 'location', 'seller_type', 'specialty_tags',
    'avg_rating', 'total_reviews', 'tier', 'availability', 'avg_response_hours',
    'price_range_min', 'currency', 'avatar_url', 'supports_custom_orders',
    'supports_ready_made', 'marketplace_category',
  ],
  savedTailor: [
    'id', 'display_name', 'location', 'tier', 'avg_rating', 'total_reviews',
    'avatar_url', 'portfolio_photo_urls',
  ],
}

const authenticatedAppProjections = {
  webTailorProfile: [
    'id', 'user_id', 'display_name', 'business_name', 'bio', 'location',
    'languages', 'specialty_tags', 'price_range_min', 'price_range_max',
    'currency', 'tier', 'availability', 'accepts_custom_orders_now',
    'shop_paused', 'seller_type', 'is_live', 'is_verified', 'avg_rating',
    'total_reviews', 'total_orders', 'supports_custom_orders',
    'supports_ready_made', 'pickup_available', 'delivery_available',
    'shipping_available', 'consultation_mode', 'consultation_requirement',
    'consultation_fee_amount', 'consultation_currency',
    'consultation_duration_minutes', 'consultation_call_type',
    'consultation_fee_creditable', 'portfolio_photo_urls',
    'portfolio_video_urls', 'avatar_url',
  ],
  tailorSetup: [
    'id', 'display_name', 'location', 'bio', 'specialty_tags', 'languages',
    'availability', 'currency', 'id_verification_status', 'seller_type',
    'supports_custom_orders', 'supports_ready_made',
    'accepts_custom_orders_now', 'shop_paused', 'pickup_available',
    'delivery_available', 'shipping_available', 'delivery_fee', 'shipping_fee',
    'consultation_mode', 'consultation_requirement', 'consultation_fee_amount',
    'consultation_duration_minutes', 'consultation_call_type',
    'consultation_fee_creditable', 'marketplace_category', 'is_verified',
  ],
}

// Mirrors the sensitive list protected by
// 20260506000001_tailor_profile_private_column_grants.sql. The request is
// always limited to zero rows: the test proves access control without reading
// any tailor data.
const sensitiveColumns = [
  'stripe_account_id',
  'stripe_connect_account_id',
  'paystack_account_id',
  'paystack_recipient_code',
  'id_document_url',
  'payout_bank_name',
  'payout_bank_code',
  'payout_account_name',
  'payout_account_masked',
  'manual_bank_name',
  'manual_bank_country_code',
  'manual_bank_country_name',
  'manual_bank_swift_bic',
  'manual_bank_account_number',
  'manual_bank_account_name',
  'manual_bank_verified_by',
  'is_test_profile',
  'id_selfie_document_url',
  'id_verification_handoff_id',
  'id_verification_metadata',
  'id_verification_rejection_reason',
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
  'user_id',
]

function requireTestCredentials() {
  assert.ok(baseUrl, 'SUPABASE_TEST_URL is required')
  assert.ok(publishableKey, 'SUPABASE_TEST_ANON_KEY is required')
}

const canRunPublicApiContract = Boolean(baseUrl && publishableKey)
const canRunAuthenticatedApiContract = Boolean(baseUrl && publishableKey && authenticatedToken)

function columnsForRole(sql, role) {
  const match = [...sql.matchAll(
    /grant\s+select\s*\(([\s\S]*?)\)\s+on\s+table\s+public\.tailor_profiles\s+to\s+(anon|authenticated)\b/giu
  )].find((candidate) => candidate[2].toLowerCase() === role)
  assert.ok(match, `missing ${role} column grant`)
  return match[1].split(',').map((column) => column.trim()).filter(Boolean).sort()
}

function assertProjectionIsGranted(role, name, columns) {
  const granted = new Set(expectedColumnsByRole[role])
  for (const column of columns) {
    assert.ok(granted.has(column), `${role} must retain ${column} for ${name}`)
  }
}

test('the repair retains the complete Production per-column grant baseline', async () => {
  const conditionalMigration = await readFile(
    new URL(
      '../supabase/migrations/20261117190000_harden_catalogue_profile_column_grants.sql',
      import.meta.url
    ),
    'utf8'
  )
  const restoreMigration = await readFile(
    new URL(
      '../supabase/migrations/20261117191500_restore_tailor_profile_column_grants.sql',
      import.meta.url
    ),
    'utf8'
  )

  assert.doesNotMatch(
    conditionalMigration,
    /grant\s+select\s+on\s+(?:table\s+)?public\.tailor_profiles\s+to\s+(?:anon|authenticated)/iu
  )
  assert.match(conditionalMigration, /information_schema\.table_privileges/iu)
  assert.match(restoreMigration, /has_column_privilege\('anon', 'public\.tailor_profiles', 'bio', 'select'\)/iu)
  assert.match(restoreMigration, /has_column_privilege\('authenticated', 'public\.tailor_profiles', 'user_id', 'select'\)/iu)

  for (const role of ['anon', 'authenticated']) {
    const expected = [...expectedColumnsByRole[role]].sort()
    assert.deepEqual(columnsForRole(conditionalMigration, role), expected)
    assert.deepEqual(columnsForRole(restoreMigration, role), expected)
  }

  for (const [name, columns] of Object.entries(publicAppProjections)) {
    assertProjectionIsGranted('anon', name, columns)
  }
  for (const [name, columns] of Object.entries(authenticatedAppProjections)) {
    assertProjectionIsGranted('authenticated', name, columns)
  }
})

async function selectStatus(columns, bearerToken = publishableKey) {
  const params = new URLSearchParams({ select: columns.join(','), limit: '0' })
  const response = await fetch(`${baseUrl}/rest/v1/tailor_profiles?${params}`, {
    headers: {
      apikey: publishableKey,
      authorization: `Bearer ${bearerToken}`,
      Range: '0-0',
    },
  })
  return {
    body: await response.text(),
    status: response.status,
  }
}

test(
  'the public key can read every public application projection and no protected field',
  { skip: !canRunPublicApiContract },
  async () => {
    requireTestCredentials()
    for (const [name, columns] of Object.entries(publicAppProjections)) {
      const projection = await selectStatus(columns)
      assert.equal(projection.status, 200, `${name} must be readable by the public key: ${projection.body}`)
    }

    for (const column of sensitiveColumns) {
      const sensitiveProjection = await selectStatus([column])
      assert.equal(
        sensitiveProjection.status,
        401,
        `public key must not read tailor_profiles.${column}: ${sensitiveProjection.body}`
      )
    }
  }
)

test(
  'the signed-in application projections remain readable',
  { skip: !canRunAuthenticatedApiContract },
  async () => {
    for (const [name, columns] of Object.entries(authenticatedAppProjections)) {
      const projection = await selectStatus(columns, authenticatedToken)
      assert.equal(projection.status, 200, `${name} must be readable when signed in: ${projection.body}`)
    }
  }
)
