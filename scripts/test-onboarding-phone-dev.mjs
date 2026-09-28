// Explicit development-only API smoke test. Never relies on the CLI's linked project.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const ref = 'pqptfuqogvrajozfsqzi'
const url = `https://${ref}.supabase.co`
const keys = JSON.parse(execFileSync('supabase', ['projects', 'api-keys', '--project-ref', ref, '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
const service = keys.find(key => key.name === 'service_role')?.api_key
const anon = keys.find(key => key.name === 'anon')?.api_key
if (!service || !anon) throw new Error('Development credentials unavailable')
const fixtures = []
const phone = '+12025550134'
const otherPhone = '+12025550135'

async function request(path, { token = service, key = service, method = 'GET', body } = {}) {
  const response = await fetch(`${url}${path}`, {
    method, headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json().catch(() => null)
  return { status: response.status, data }
}
function expect(result, status, name) {
  if (result.status !== status) throw new Error(`${name}: expected ${status}, got ${result.status}`)
  console.log(`PASS ${name} (${status})`)
}
async function fixture() {
  const password = `${randomUUID()}Aa9!`
  const email = `phone-save-smoke-${randomUUID()}@example.com`
  const created = await request('/auth/v1/admin/users', { method: 'POST', body: { email, password, email_confirm: true } })
  if (created.status !== 200 || !created.data?.id) throw new Error('Could not create development fixture')
  const id = created.data.id
  fixtures.push(id)
  const account = await request('/rest/v1/users?on_conflict=id', { method: 'POST', body: { id, email, role: 'TAILOR', display_name: 'Phone Save QA', phone: null } })
  if (account.status !== 201) {
    const patched = await request(`/rest/v1/users?id=eq.${id}`, { method: 'PATCH', body: { role: 'TAILOR', phone: null } })
    if (patched.status !== 200 || patched.data?.length !== 1) throw new Error('Could not prepare development account')
  }
  const link = await request('/auth/v1/admin/generate_link', { method: 'POST', body: { type: 'magiclink', email } })
  if (!link.data?.hashed_token) throw new Error('Could not prepare development-only sign-in link')
  const signedIn = await request('/auth/v1/verify', { method: 'POST', key: anon, token: anon, body: { type: 'magiclink', token_hash: link.data.hashed_token } })
  if (!signedIn.data?.access_token) throw new Error(`Could not sign in development fixture (${signedIn.status}; ${signedIn.data?.error_code ?? signedIn.data?.code ?? 'unknown'}; ${signedIn.data?.msg ?? signedIn.data?.error_description ?? 'no reason'})`)
  return { id, token: signedIn.data.access_token }
}
async function action(user, number = phone) {
  return request('/functions/v1/account-profile-action', { method: 'POST', key: anon, token: user.token, body: { action: 'save-onboarding-phone', role: 'TAILOR', phone: number } })
}

try {
  const user = await fixture()
  const second = await fixture()
  expect(await action({ token: anon }), 401, 'unauthenticated save rejected')
  await request(`/rest/v1/users?id=eq.${user.id}`, { method: 'PATCH', body: { role: 'CUSTOMER' } })
  expect(await action(user), 403, 'client cannot claim tailor role')
  await request(`/rest/v1/users?id=eq.${user.id}`, { method: 'PATCH', body: { role: 'TAILOR' } })
  let result = await action(user)
  if (result.status === 409 && result.data?.error?.startsWith('Verify your phone')) {
    console.log('PASS enforced OTP blocks unverified initial contact')
    // Trusted verification fixture only; no SMS is sent and no production data touched.
    const verified = await request('/rest/v1/account_phone_verifications', { method: 'POST', body: {
      user_id: user.id, phone, otp_hash: '0'.repeat(64),
      expires_at: new Date(Date.now() + 600000).toISOString(), verified_at: new Date().toISOString(),
    } })
    if (verified.status !== 201) throw new Error('Could not prepare development verification fixture')
    result = await action(user)
  }
  expect(result, 200, 'initial contact saved')
  if (result.data?.savedPhone !== phone) throw new Error('Incorrect save receipt')
  const readback = await request(`/rest/v1/users?id=eq.${user.id}&select=phone`, { key: anon, token: user.token })
  expect(readback, 200, 'authenticated canonical readback')
  if (readback.data?.[0]?.phone !== phone) throw new Error('Canonical phone missing')
  expect(await action(user), 200, 'same contact retry is idempotent')
  expect(await action(user, otherPhone), 409, 'existing contact cannot be replaced')
  const verification = await request('/rest/v1/account_phone_verifications', { method: 'POST', body: {
    user_id: second.id, phone, otp_hash: '0'.repeat(64),
    expires_at: new Date(Date.now() + 600000).toISOString(), verified_at: new Date().toISOString(),
  } })
  if (verification.status !== 201) throw new Error('Could not prepare duplicate-number fixture')
  expect(await action(second), 409, 'duplicate contact rejected')
} finally {
  for (const id of fixtures) {
    const deleted = await request(`/auth/v1/admin/users/${id}`, { method: 'DELETE' })
    if (deleted.status !== 200) throw new Error(`Development fixture cleanup failed: ${id}`)
  }
  console.log(`Cleaned up ${fixtures.length} development-only fixture accounts; no messages sent.`)
}
