/**
 * Exercises the email-code reauth round trip directly against the deployed
 * function, using the saved browser session.
 *
 *   MODE=issue  node ./scripts/e2e-phone-api-check.mjs   → sends a code, stores challengeId
 *   MODE=verify CODE=123456 node ./scripts/e2e-phone-api-check.mjs → verifies it
 *
 * Kept separate from the UI walk because the panel holds its challenge in
 * component state: a page reload cannot re-enter a code that is already in
 * flight, so driving it through the UI always mints a fresh one.
 */
import fs from 'node:fs'
import path from 'node:path'

const FIX = '/private/tmp/claude-501/-Users-onaopemipodimowo-drape/bde2e37d-a93b-4ac4-a38b-619e2ca1e6d3/scratchpad'
const STATE = path.join(FIX, 'tailor-state.json')
const CHALLENGE = path.join(FIX, 'phone-challenge.json')

const state = JSON.parse(fs.readFileSync(STATE, 'utf8'))
const cookie = (state.cookies ?? []).find((c) => c.name.includes('auth-token'))
let raw = decodeURIComponent(cookie.value)
if (raw.startsWith('base64-')) raw = Buffer.from(raw.slice(7), 'base64').toString('utf8')
const parsed = JSON.parse(raw)
const token = Array.isArray(parsed) ? parsed[0] : parsed.access_token

const env = fs.readFileSync('.env.local', 'utf8')
const val = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim()
const url = val('NEXT_PUBLIC_SUPABASE_URL')
const key = val('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')

async function call(body) {
  const r = await fetch(`${url}/functions/v1/reauth-proof-action`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: r.status, body: await r.json().catch(() => ({})) }
}

if (process.env.MODE === 'issue') {
  const res = await call({ action: 'issue-email-challenge', purpose: 'PHONE_CHANGE' })
  console.log('status', res.status)
  console.log('maskedEmail:', res.body.maskedEmail)
  console.log('expiresAt:', res.body.expiresAt)
  if (res.body.challengeId) {
    fs.writeFileSync(CHALLENGE, JSON.stringify({ challengeId: res.body.challengeId }))
    console.log('challenge stored — waiting for the code')
  }
} else {
  const { challengeId } = JSON.parse(fs.readFileSync(CHALLENGE, 'utf8'))
  const res = await call({
    action: 'verify-email-challenge',
    purpose: 'PHONE_CHANGE',
    challengeId,
    code: process.env.CODE,
  })
  console.log('verify status', res.status)
  console.log('proof issued:', res.body.proof ? `yes (${String(res.body.proof).slice(0, 12)}…)` : 'no')
  if (res.body.error) console.log('error:', res.body.error, 'attemptsRemaining:', res.body.attemptsRemaining)

  if (res.body.proof) {
    const save = await fetch(`${url}/functions/v1/account-profile-action`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update-personal-info',
        role: 'TAILOR',
        displayName: 'Ope Tailor',
        phone: process.env.NEW_PHONE ?? '+12015550999',
        reauthProof: res.body.proof,
      }),
    })
    const saved = await save.json().catch(() => ({}))
    console.log('phone save status', save.status, saved.error ? `error: ${saved.error}` : 'saved')
  }
}
