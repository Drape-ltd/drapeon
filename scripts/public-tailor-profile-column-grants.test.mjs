import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const baseUrl = process.env.SUPABASE_TEST_URL
const publishableKey = process.env.SUPABASE_TEST_ANON_KEY

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
]

function requireTestCredentials() {
  assert.ok(baseUrl, 'SUPABASE_TEST_URL is required')
  assert.ok(publishableKey, 'SUPABASE_TEST_ANON_KEY is required')
}

const canRunPublicApiContract = Boolean(baseUrl && publishableKey)

test('the catalogue repair never reintroduces a table-wide profile read grant', async () => {
  const migration = await readFile(
    new URL(
      '../supabase/migrations/20261117190000_harden_catalogue_profile_column_grants.sql',
      import.meta.url
    ),
    'utf8'
  )
  assert.doesNotMatch(
    migration,
    /grant\s+select\s+on\s+(?:table\s+)?public\.tailor_profiles\s+to\s+(?:anon|authenticated)/iu
  )
})

async function selectStatus(columns) {
  const params = new URLSearchParams({ select: columns.join(','), limit: '0' })
  const response = await fetch(`${baseUrl}/rest/v1/tailor_profiles?${params}`, {
    headers: {
      apikey: publishableKey,
      authorization: `Bearer ${publishableKey}`,
      Range: '0-0',
    },
  })
  return {
    body: await response.text(),
    status: response.status,
  }
}

test(
  'the public key can read exactly the catalogue profile projection',
  { skip: !canRunPublicApiContract },
  async () => {
    requireTestCredentials()
    const catalogueProjection = await selectStatus(catalogueColumns)
    assert.equal(
      catalogueProjection.status,
      200,
      `catalogue projection must be readable by the public key: ${catalogueProjection.body}`
    )

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
