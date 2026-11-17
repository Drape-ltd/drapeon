#!/usr/bin/env node
import assert from 'node:assert/strict'

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const email = process.env.TAILOR_PROFILE_OWNER_TEST_EMAIL
const password = process.env.TAILOR_PROFILE_OWNER_TEST_PASSWORD

if (!url || !anonKey || !email || !password) {
  throw new Error(
    'Set SUPABASE_URL, SUPABASE_ANON_KEY, TAILOR_PROFILE_OWNER_TEST_EMAIL, and TAILOR_PROFILE_OWNER_TEST_PASSWORD for a Dev QA authenticated account before running this test.',
  )
}

// B0 can ship before the mobile release because these fields are not in the
// released native client projection. The broader owner-only list is tested by
// the later B release after the app minimum-version/adoption gate.
const earlyPrivateColumns = [
  'is_test_profile',
  'id_selfie_document_url',
  'id_verification_handoff_id',
]

const deferredForMobileCompatibility = [
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

async function request(path, init = {}) {
  return fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: anonKey,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
}

const signIn = await request('/auth/v1/token?grant_type=password', {
  method: 'POST',
  body: JSON.stringify({ email, password }),
})
assert.equal(signIn.status, 200, 'Dev QA customer sign-in must succeed')
const session = await signIn.json()
assert.equal(typeof session.access_token, 'string', 'Dev QA customer must receive an access token')

const authHeaders = { authorization: `Bearer ${session.access_token}` }

const publicProfile = await request(
  `/rest/v1/tailor_profiles?select=${encodeURIComponent(
    'id,display_name,business_name,bio,location,availability,is_live,is_verified,avatar_url,avg_rating,total_reviews,total_orders,marketplace_category,seller_type',
  )}&limit=0`,
  { headers: authHeaders },
)
assert.equal(publicProfile.status, 200, 'signed-in customer must retain the public catalogue projection')

const statuses = []
for (const column of earlyPrivateColumns) {
  const response = await request(
    `/rest/v1/tailor_profiles?select=${encodeURIComponent(column)}&limit=0`,
    { headers: authHeaders },
  )
  statuses.push({ column, status: response.status })
  // PostgREST performs column privilege checks before evaluating the zero-row
  // request, so this proves the field cannot be projected without reading it.
  assert.ok(
    response.status === 401 || response.status === 403,
    `signed-in non-owner must not select ${column}; got ${response.status}`,
  )
}

const ownProfile = await request('/rest/v1/rpc/get_my_tailor_account_profile', {
  method: 'POST',
  headers: authHeaders,
  body: '{}',
})
assert.equal(ownProfile.status, 200, 'owner-scoped RPC must remain callable by authenticated users')

console.log(
  JSON.stringify({
    stage_b0_checked: statuses.length,
    denied: statuses.length,
    deferred_for_mobile_compatibility: deferredForMobileCompatibility.length,
    public_profile_projection_status: publicProfile.status,
    own_profile_rpc_status: ownProfile.status,
  }),
)
