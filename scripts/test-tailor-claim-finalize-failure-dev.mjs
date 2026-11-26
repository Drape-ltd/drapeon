#!/usr/bin/env node

// Development-only disposable fixture. The fixture's token stays in a gitignored file.
import { randomInt, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const projectRef = 'pqptfuqogvrajozfsqzi'
const url = `https://${projectRef}.supabase.co`
const fixturePath = process.argv[2]
if (!fixturePath || !resolve(fixturePath).startsWith(resolve('supabase/.temp') + '/'))
  throw new Error('Pass a gitignored Development fixture file under supabase/.temp.')
const linkedRef = readFileSync(new URL('../supabase/.temp/project-ref', import.meta.url), 'utf8').trim()
if (linkedRef !== projectRef) throw new Error('Refusing a non-Development project.')
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
if (!fixture.token || !fixture.inviteId || !fixture.userId || !fixture.profileId)
  throw new Error('Development fixture is incomplete.')

const keysResult = spawnSync('supabase', ['projects', 'api-keys', '--project-ref', projectRef, '-o', 'json'], {
  encoding: 'utf8',
})
if (keysResult.status !== 0) throw new Error('Cannot load Development API keys.')
const keys = JSON.parse(keysResult.stdout)
const serviceKey = keys.find((item) => item.name === 'service_role')?.api_key
const anonKey = keys.find((item) => item.name === 'default')?.api_key ??
  keys.find((item) => item.name === 'anon')?.api_key
if (!serviceKey || !anonKey) throw new Error('Development API keys unavailable.')
const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { createClient } = webRequire('@supabase/supabase-js')
const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const anon = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function requireSuccess(error, label) {
  if (error) throw new Error(`${label} failed: ${error.code ?? error.message}`)
}

async function finalize(accessToken, idempotencyKey) {
  const response = await fetch(`${url}/functions/v1/tailor-claim-action`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ action: 'FINALIZE', idempotencyKey }),
  })
  return { status: response.status, body: await response.json() }
}

async function receipt() {
  const { data, error } = await admin.from('tailor_claim_finalize_receipts')
    .select('id,outcome,failure_code,source_manifest').eq('invite_id', fixture.inviteId).maybeSingle()
  requireSuccess(error, 'Receipt read')
  return data
}

let delaySet = false
try {
  const email = `finalize-qa-${randomUUID()}@example.invalid`
  const authUpdate = await admin.auth.admin.updateUserById(fixture.userId, {
    email, email_confirm: true, ban_duration: 'none',
    app_metadata: { role: 'TAILOR', account_origin: 'CLAIMED' },
  })
  requireSuccess(authUpdate.error, 'Auth fixture handover')
  const userUpdate = await admin.from('users').update({
    email, phone: `+1415555${String(randomInt(1000, 10000))}`,
    phone_verified_at: new Date().toISOString(), role: 'TAILOR',
  }).eq('id', fixture.userId)
  requireSuccess(userUpdate.error, 'Public user fixture')
  const { data: media, error: mediaError } = await admin.from('tailor_draft_media')
    .select('id,media_kind,storage_path,content_type').eq('invite_id', fixture.inviteId)
    .eq('moderation_status', 'APPROVED').order('sort_order')
  requireSuccess(mediaError, 'Fixture media')
  if (!media?.some((item) => item.media_kind === 'AVATAR') ||
      !media.some((item) => item.media_kind === 'PHOTO')) throw new Error('Fixture media incomplete.')
  const inviteUpdate = await admin.from('tailor_claim_invites').update({
    status: 'CLAIMED_AWAITING_EMAIL', consent_recorded_at: new Date().toISOString(),
    consent_text_version: 'qa-finalize-v1', consent_media_manifest: media.map((item) => item.id),
  }).eq('id', fixture.inviteId)
  requireSuccess(inviteUpdate.error, 'Invite fixture claim')
  const profileUpdate = await admin.from('tailor_profiles').update({
    lifecycle_state: 'CLAIMED_AWAITING_EMAIL',
    bio: 'Development-only recovery proof for an imported tailoring shop with approved work and a complete public profile. No real tailor uses this fixture.',
  }).eq('id', fixture.profileId)
  requireSuccess(profileUpdate.error, 'Profile fixture claim')

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink', email,
  })
  requireSuccess(linkError, 'QA sign-in link')
  const tokenHash = link?.properties?.hashed_token ??
    (link?.properties?.action_link
      ? new URL(link.properties.action_link).searchParams.get('token_hash') : null)
  if (!tokenHash) throw new Error('QA sign-in token hash unavailable.')
  const signedIn = await anon.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' })
  requireSuccess(signedIn.error, 'QA sign-in')
  const accessToken = signedIn.data.session?.access_token
  if (!accessToken) throw new Error('QA session unavailable.')

  const delay = spawnSync('supabase', [
    'secrets', 'set', 'TAILOR_CLAIM_FINALIZE_TEST_DELAY_MS=20000', '--project-ref', projectRef,
  ], { encoding: 'utf8' })
  if (delay.status !== 0) throw new Error('Cannot set Development-only finalize delay.')
  delaySet = true
  const oldPhoto = media.find((item) => item.media_kind === 'PHOTO')
  const first = finalize(accessToken, `finalize-failure-${randomUUID()}`)
  let prepared = null
  for (let attempt = 0; attempt < 40; attempt++) {
    prepared = await receipt()
    if (prepared?.outcome === 'IN_PROGRESS') break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  if (prepared?.outcome !== 'IN_PROGRESS') throw new Error('FINALIZE did not prepare in time.')
  await new Promise((resolve) => setTimeout(resolve, 1_500))
  requireSuccess((await admin.from('tailor_draft_media').update({ moderation_status: 'BLOCKED' })
    .eq('id', oldPhoto.id)).error, 'Forced non-retryable media change')
  const failed = await first
  if (failed.status !== 409 || failed.body.error !== 'FINALIZE_MEDIA_CHANGED')
    throw new Error(`Expected terminal media failure, got HTTP ${failed.status} / ${failed.body.error}`)
  const failedReceipt = await receipt()
  if (failedReceipt?.outcome !== 'FAILED' || failedReceipt.failure_code !== 'FINALIZE_MEDIA_CHANGED')
    throw new Error('FINALIZE receipt did not fail and reset.')
  const { data: assets, error: assetError } = await admin.from('media_assets')
    .select('bucket_id,object_path,status,public_url,availability_state')
    .eq('tailor_profile_id', fixture.profileId)
  requireSuccess(assetError, 'Promoted media read')
  if (assets?.some((asset) => asset.status === 'ACTIVE' || asset.public_url ||
    asset.availability_state !== 'QUARANTINED'))
    throw new Error('Failed FINALIZE left an active public media record.')
  for (const asset of assets ?? []) {
    const { data: objects, error } = await admin.storage.from(asset.bucket_id)
      .list(asset.object_path.split('/').slice(0, -1).join('/'), {
        search: asset.object_path.split('/').at(-1),
      })
    requireSuccess(error, 'Public storage readback')
    if (objects?.some((object) => object.name === asset.object_path.split('/').at(-1)))
      throw new Error('Failed FINALIZE left a public storage object.')
  }

  requireSuccess((await admin.from('tailor_draft_media').update({ moderation_status: 'APPROVED' })
    .eq('id', oldPhoto.id)).error, 'Restore disposable media approval')
  const retried = await finalize(accessToken, `finalize-retry-${randomUUID()}`)
  if (retried.status !== 200 || retried.body.state !== 'LIVE')
    throw new Error(`Retry did not reach LIVE: HTTP ${retried.status} / ${retried.body.error}`)
  const liveReceipt = await receipt()
  const [{ data: invite }, { data: profile }] = await Promise.all([
    admin.from('tailor_claim_invites').select('status').eq('id', fixture.inviteId).single(),
    admin.from('tailor_profiles').select('lifecycle_state,is_live').eq('id', fixture.profileId).single(),
  ])
  if (liveReceipt?.outcome !== 'SUCCEEDED' || invite?.status !== 'LIVE' ||
      profile?.lifecycle_state !== 'LIVE' || profile?.is_live !== true)
    throw new Error('LIVE database readback failed.')
  console.log(JSON.stringify({
    result: 'finalize_terminal_failure_recovery_passed', inviteId: fixture.inviteId,
    profileId: fixture.profileId, failedReceiptId: failedReceipt.id,
    liveReceiptId: liveReceipt.id, publicMediaRemoved: true, lifecycle: 'LIVE',
  }))
} finally {
  if (delaySet) {
    const unset = spawnSync('supabase', [
      'secrets', 'unset', 'TAILOR_CLAIM_FINALIZE_TEST_DELAY_MS', '--project-ref', projectRef,
    ], { encoding: 'utf8' })
    if (unset.status !== 0) console.error('Development finalize delay must be unset manually.')
  }
}
