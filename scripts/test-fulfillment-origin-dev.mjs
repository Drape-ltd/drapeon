import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

// Explicit Dev-only fixtures. No messages, campaigns, or production writes.
const ref = 'pqptfuqogvrajozfsqzi'
const keys = JSON.parse(execFileSync('supabase', ['projects', 'api-keys', '--project-ref', ref, '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
const service = keys.find(row => row.name === 'service_role')?.api_key
const anon = keys.find(row => row.name === 'anon')?.api_key
if (!service || !anon) throw new Error('Dev credentials unavailable')
async function request(path, { token = service, key = service, method = 'GET', body } = {}) {
  const response = await fetch(`https://${ref}.supabase.co${path}`, {
    method, headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation,resolution=merge-duplicates' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
  })
  return { status: response.status, data: await response.json().catch(() => null) }
}
function pass(condition, label) { if (!condition) throw new Error(label); console.log(`PASS ${label}`) }
if (process.argv.includes('--cleanup-owned-fixtures')) {
  const fixtures = await request('/rest/v1/users?email=like.fulfillment-qa-*@example.invalid&display_name=eq.Fulfillment%20QA&select=id')
  pass(fixtures.status === 200, 'locate only owned synthetic fixtures')
  for (const row of fixtures.data) {
    const deleted = await request(`/auth/v1/admin/users/${row.id}`, { method: 'DELETE' })
    console.log('Fixture cleanup status', deleted.status, deleted.data?.code ?? deleted.data?.error_code ?? '')
    pass(deleted.status >= 200 && deleted.status < 300, 'owned fixture account deleted')
  }
  process.exit(0)
}
let userId
let profileId
try {
  const email = `fulfillment-qa-${randomUUID()}@example.invalid`
  const created = await request('/auth/v1/admin/users', { method: 'POST', body: { email, password: `${randomUUID()}Aa9!`, email_confirm: true } })
  pass(created.status === 200 && created.data?.id, 'create own Dev fixture')
  userId = created.data.id
  const account = await request('/rest/v1/users?on_conflict=id', { method: 'POST', body: { id: userId, email, role: 'TAILOR', display_name: 'Fulfillment QA' } })
  pass(account.status === 201 || account.status === 200, 'canonical tailor account')
  profileId = randomUUID()
  const seed = await request('/rest/v1/tailor_profiles', { method: 'POST', body: { id: profileId, user_id: userId, display_name: 'Fulfillment QA', location: 'Lagos, Nigeria', currency: 'NGN', is_live: true, is_verified: true, is_test_profile: false, profile_completed: true, pickup_available: false, delivery_available: true, shipping_available: true, supports_custom_orders: true } })
  pass(seed.status === 201, 'synthetic Dev live profile')
  const link = await request('/auth/v1/admin/generate_link', { method: 'POST', body: { type: 'magiclink', email } })
  const login = await request('/auth/v1/verify', { method: 'POST', key: anon, token: anon, body: { type: 'magiclink', token_hash: link.data?.hashed_token } })
  pass(Boolean(login.data?.access_token), 'authenticate fixture without sending mail')
  const token = login.data.access_token
  async function options() {
    return request('/functions/v1/read-gateway', { method: 'POST', key: anon, token: anon, body: { action: 'fulfillment-options', tailorId: profileId } })
  }
  let result = await options()
  pass(result.status === 200 && result.data?.data?.methods?.length === 0, 'missing origin hides all methods')
  const profile = { displayName: 'Fulfillment QA', location: 'Lagos, Nigeria', currency: 'NGN', pickupAvailable: false, deliveryAvailable: true, shippingAvailable: true, supportsCustomOrders: true, languages: ['English'], specialties: ['Kaftan'], bio: 'A synthetic development fixture for testing structured origin repair without contacting any real tailor.' }
  const rejected = await request('/functions/v1/tailor-profile-action', { method: 'POST', key: anon, token, body: { action: 'update-profile', profile } })
  console.log('Missing-origin response', rejected.status, rejected.data?.code ?? '')
  pass(rejected.status === 400 && rejected.data?.code === 'FULFILLMENT_ORIGIN_REQUIRED', 'authenticated missing-origin save rejected')
  const repaired = await request('/functions/v1/tailor-profile-action', { method: 'POST', key: anon, token, body: { action: 'update-profile', profile: { ...profile, pickupAddress: '10 Synthetic Test Street', pickupAddressLine1: '10 Synthetic Test Street', pickupCity: 'Lagos', pickupCountryCode: 'NG', pickupRegion: 'Lagos', pickupLocationVerificationSource: 'TAILOR_CONFIRMED_STRUCTURED', pickupLocationVerifiedAt: new Date().toISOString() } } })
  pass(repaired.status === 200, 'authenticated origin repair saved')
  const readback = await request(`/rest/v1/tailor_pickup_details?user_id=eq.${userId}&select=pickup_city,pickup_country_code,pickup_location_verified_at`, { key: anon, token })
  pass(readback.status === 200 && readback.data?.[0]?.pickup_city === 'Lagos' && Boolean(readback.data?.[0]?.pickup_location_verified_at), 'owner readback contains durable confirmation')
  result = await options()
  pass(result.status === 200 && JSON.stringify(result.data.data.methods) === JSON.stringify(['LOCAL_DELIVERY', 'SHIPPING']), 'fresh customer read restores only saved methods')
  pass(JSON.stringify(Object.keys(result.data.data).sort()) === JSON.stringify(['methods', 'originReady']), 'public response contains no private origin')
  const flags = await request(`/rest/v1/tailor_profiles?id=eq.${profileId}&select=pickup_available,delivery_available,shipping_available`)
  pass(flags.data?.[0]?.pickup_available === false && flags.data?.[0]?.delivery_available === true && flags.data?.[0]?.shipping_available === true, 'saved flags unchanged')
  const absent = await request('/functions/v1/read-gateway', { method: 'POST', key: anon, token: anon, body: { action: 'fulfillment-options', tailorId: randomUUID() } })
  pass(absent.status === 200 && absent.data?.data?.methods?.length === 0, 'missing profiles expose no readiness methods')
} finally {
  if (userId) {
    const deleted = await request(`/auth/v1/admin/users/${userId}`, { method: 'DELETE' })
    console.log('Fixture cleanup status', deleted.status, deleted.data?.code ?? deleted.data?.error_code ?? '')
    pass(deleted.status >= 200 && deleted.status < 300, 'own auth fixture and cascaded profile removed')
  }
}
