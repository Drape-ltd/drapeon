// Explicit Dev-only smoke test. Creates and deletes only its own synthetic account.
// No campaigns, real recipients, provider messages, or production endpoints are used.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const ref = 'pqptfuqogvrajozfsqzi'
const url = `https://${ref}.supabase.co`
const keys = JSON.parse(execFileSync('supabase', ['projects', 'api-keys', '--project-ref', ref, '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
const service = keys.find(key => key.name === 'service_role')?.api_key
const anon = keys.find(key => key.name === 'anon')?.api_key
if (!service || !anon) throw new Error('Dev credentials unavailable')
let fixtureId
let inviteId

async function request(path, { key = service, token = service, method = 'GET', body } = {}) {
  const response = await fetch(`${url}${path}`, {
    method, headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
  })
  return { status: response.status, data: await response.json().catch(() => null) }
}
function check(condition, name) {
  if (!condition) throw new Error(name)
  console.log(`PASS ${name}`)
}
function status(result, expected, name) { check(result.status === expected, `${name} (${result.status})`) }

try {
  const email = `marketing-closeout-${randomUUID()}@example.invalid`
  const created = await request('/auth/v1/admin/users', { method: 'POST', body: { email, password: `${randomUUID()}Aa9!`, email_confirm: true, user_metadata: { role: 'CUSTOMER', display_name: 'Marketing QA fixture', is_test_account: true } } })
  status(created, 200, 'Dev fixture created')
  fixtureId = created.data.id
  const account = await request('/rest/v1/users?on_conflict=id', { method: 'POST', body: { id: fixtureId, email, role: 'CUSTOMER', display_name: 'Marketing QA fixture' } })
  if (account.status !== 201) {
    const updated = await request(`/rest/v1/users?id=eq.${fixtureId}`, { method: 'PATCH', body: { role: 'CUSTOMER' } })
    check(updated.status === 200 && updated.data?.length === 1, 'Fixture canonical role set')
  }
  const link = await request('/auth/v1/admin/generate_link', { method: 'POST', body: { type: 'magiclink', email } })
  check(Boolean(link.data?.hashed_token), 'Dev-only sign-in link generated without sending mail')
  const session = await request('/auth/v1/verify', { method: 'POST', key: anon, token: anon, body: { type: 'magiclink', token_hash: link.data.hashed_token } })
  check(Boolean(session.data?.access_token), 'Dev fixture authenticated')
  const token = session.data.access_token
  const action = body => request('/functions/v1/communications-action', { method: 'POST', key: anon, token, body })

  status(await action({ action: 'PREFERENCES_GET' }), 200, 'Preferences load')
  status(await action({ action: 'TOPIC_PREFERENCE_SET', topicKey: 'UNKNOWN', channel: 'EMAIL', enabled: true }), 400, 'Unknown topic rejected')
  status(await action({ action: 'TOPIC_PREFERENCE_SET', topicKey: 'DRAPEON_STORIES', channel: 'PUSH', enabled: false }), 400, 'Disallowed topic channel rejected')
  status(await action({ action: 'TOPIC_PREFERENCE_SET', topicKey: 'DRAPEON_STORIES', channel: 'EMAIL', enabled: true }), 400, 'Enabling topic without consent rejected')
  status(await action({ action: 'CONSENT_SET', channel: 'EMAIL', granted: true, policyVersion: 'communications-v1' }), 200, 'Explicit fixture consent recorded')
  status(await action({ action: 'TOPIC_PREFERENCE_SET', topicKey: 'DRAPEON_STORIES', channel: 'EMAIL', enabled: true }), 200, 'Consented topic saved')
  const preferences = await action({ action: 'PREFERENCES_GET' })
  check(preferences.data.marketingTopics?.some(row => row.topicKey === 'DRAPEON_STORIES' && row.channel === 'EMAIL' && row.enabled), 'Canonical topic readback')
  status(await action({ action: 'TOPIC_PREFERENCE_SET', topicKey: 'DRAPEON_STORIES', channel: 'EMAIL', enabled: false }), 200, 'Topic opt-out saved')

  const surveyBody = { kind: 'ONBOARDING_PULSE', subjectType: 'ACCOUNT', subjectId: fixtureId, score: 4, tags: ['clear', 'forbidden-tag'], channel: 'WEB' }
  const survey = body => request('/functions/v1/submit-survey', { method: 'POST', key: anon, token, body })
  status(await request('/functions/v1/submit-survey', { method: 'POST', key: anon, token: anon, body: surveyBody }), 401, 'Unauthenticated feedback rejected')
  status(await survey({ ...surveyBody, subjectId: randomUUID() }), 403, 'Another account subject rejected')
  const notAvailable = await survey(surveyBody)
  check(notAvailable.status === 409 && notAvailable.data?.code === 'SURVEY_NOT_AVAILABLE', 'Missing invitation rejected')
  const invitation = await request('/rest/v1/survey_invites', { method: 'POST', body: {
    kind: surveyBody.kind, version: 1, subject_type: 'ACCOUNT', subject_id: fixtureId,
    user_id: fixtureId, role: 'CUSTOMER', channel: 'WEB', status: 'PENDING',
    available_at: new Date(Date.now() + 3600000).toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString(),
    idempotency_key: `marketing-closeout:${fixtureId}`, metadata: { source: 'marketing-closeout-qa' },
  } })
  status(invitation, 201, 'Private synthetic invitation created')
  inviteId = invitation.data[0].id
  const delayed = await survey(surveyBody)
  check(delayed.status === 409 && delayed.data?.code === 'SURVEY_NOT_READY', 'Waiting period enforced')
  status(await request(`/rest/v1/survey_invites?id=eq.${inviteId}`, { method: 'PATCH', body: { available_at: new Date(Date.now() - 3600000).toISOString() } }), 200, 'Only fixture invitation made due')
  const saved = await survey(surveyBody)
  if (saved.status === 409 && saved.data?.code === 'SURVEY_SUPPRESSED') {
    console.log(`PASS live suppression respected (${saved.data.reason}); existing Dev incidents untouched`)
    console.log('HOLD persisted survey happy path: live Dev suppression blocks it')
  } else {
    status(saved, 201, 'Feedback persisted')
    const replay = await survey(surveyBody)
    check(replay.status === 200 && replay.data?.deduplicated && replay.data.responseId === saved.data.responseId, 'Replay returns same durable receipt')
    const responses = await request(`/rest/v1/survey_responses?user_id=eq.${fixtureId}&select=id,tags`)
    check(responses.data?.length === 1 && responses.data[0].tags.join(',') === 'clear', 'One private response with allow-listed tags')
    const completed = await request(`/rest/v1/survey_invites?id=eq.${inviteId}&select=status`)
    check(completed.data?.[0]?.status === 'COMPLETED', 'Invitation durably completed')
  }
} finally {
  if (inviteId) {
    status(await request(`/rest/v1/survey_invites?id=eq.${inviteId}`, { method: 'DELETE' }), 200, 'Only fixture invitation removed')
  }
  if (fixtureId) {
    status(await request(`/auth/v1/admin/users/${fixtureId}`, { method: 'DELETE' }), 200, 'Only fixture account removed')
  }
}
