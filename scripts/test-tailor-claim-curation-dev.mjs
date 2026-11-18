#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const PROJECT_REF = 'pqptfuqogvrajozfsqzi'
const token = process.argv[2]
const userId = process.argv[3]
const inviteId = process.argv[4]
if (!/^[A-Za-z0-9_-]{40,60}$/u.test(token ?? '') || !/^[0-9a-f-]{36}$/iu.test(userId ?? '') || !/^[0-9a-f-]{36}$/iu.test(inviteId ?? '')) {
  throw new Error('Pass the development token, user ID, and invite ID.')
}
const linkedRef = readFileSync(new URL('../supabase/.temp/project-ref', import.meta.url), 'utf8').trim()
if (linkedRef !== PROJECT_REF) throw new Error(`Refusing non-development project ${linkedRef}.`)

const keyResult = spawnSync('supabase', ['projects', 'api-keys', '--project-ref', PROJECT_REF, '-o', 'json'], { encoding: 'utf8' })
if (keyResult.status !== 0) throw new Error('Could not load development API keys.')
const keys = JSON.parse(keyResult.stdout)
const serviceKey = keys.find((entry) => entry.name === 'service_role')?.api_key
const anonKey = keys.find((entry) => entry.name === 'default')?.api_key ?? keys.find((entry) => entry.name === 'anon')?.api_key
if (!serviceKey || !anonKey) throw new Error('Development API keys are unavailable.')
const url = `https://${PROJECT_REF}.supabase.co`
const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { createClient } = webRequire('@supabase/supabase-js')
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
const sessionId = randomUUID()

function jwtClaim(jwt, key) {
  const payload = jwt.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')
  return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))[key]
}

async function action(accessToken, body) {
  const response = await fetch(`${url}/functions/v1/tailor-claim-action`, {
    method: 'POST',
    headers: { apikey: anonKey, authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

let accessToken = null
try {
  const { data: current, error: currentError } = await admin.auth.admin.getUserById(userId)
  if (currentError || !current.user?.email) throw currentError ?? new Error('Fixture user is missing.')
  const { error: rowError } = await admin.from('tailor_claim_bootstrap_sessions').insert({
    id: sessionId,
    invite_id: inviteId,
    user_id: userId,
    status: 'PREPARING',
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  })
  if (rowError) throw rowError
  const { error: unlockError } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: 'none',
    app_metadata: { ...(current.user.app_metadata ?? {}), role: 'TAILOR', account_origin: 'STAFF_DRAFT', claim_session_id: sessionId },
  })
  if (unlockError) throw unlockError
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email: current.user.email })
  const actionLink = link?.properties?.action_link
  const tokenHash = link?.properties?.hashed_token ?? (actionLink ? new URL(actionLink).searchParams.get('token_hash') : null)
  if (linkError || !tokenHash) throw linkError ?? new Error('Could not create fixture session link.')
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' })
  accessToken = verified.session?.access_token ?? null
  const authSessionId = accessToken ? jwtClaim(accessToken, 'session_id') : null
  if (verifyError || !accessToken || !authSessionId) throw verifyError ?? new Error('Could not verify fixture session.')
  const { error: activateError } = await admin.from('tailor_claim_bootstrap_sessions').update({
    status: 'ACTIVE', auth_session_id: authSessionId, activated_at: new Date().toISOString(),
  }).eq('id', sessionId)
  if (activateError) throw activateError

  const context = await action(accessToken, { action: 'GET_CLAIM_CONTEXT', token })
  if (context.status !== 200 || context.body.available !== true) throw new Error(`Context failed: ${JSON.stringify(context)}`)
  const removable = context.body.media.find((item) => item.kind === 'PHOTO' && !item.cover)
  const avatar = context.body.media.find((item) => item.kind === 'AVATAR')
  const cover = context.body.media.find((item) => item.kind === 'PHOTO' && item.cover)
  if (!removable || !avatar || !cover) throw new Error('Fixture does not contain avatar, cover, and removable photo.')

  const update = await action(accessToken, {
    action: 'UPDATE_CLAIM_PROFILE', token,
    ...context.body.profile,
    displayName: 'Claim curation proof',
    businessName: 'Claim curation proof',
    bio: 'This development-only profile proves that a claimant can safely edit imported storefront text using the same validation rules before taking ownership.',
  })
  if (update.status !== 200 || update.body.updated !== true) throw new Error(`Profile update failed: ${JSON.stringify(update)}`)
  const removed = await action(accessToken, { action: 'REMOVE_CLAIM_MEDIA', token, mediaId: removable.id })
  if (removed.status !== 200 || removed.body.removed !== true) throw new Error(`Media removal failed: ${JSON.stringify(removed)}`)
  const avatarRefusal = await action(accessToken, { action: 'REMOVE_CLAIM_MEDIA', token, mediaId: avatar.id })
  const coverRefusal = await action(accessToken, { action: 'REMOVE_CLAIM_MEDIA', token, mediaId: cover.id })
  if (avatarRefusal.body.error !== 'AVATAR_REQUIRED' || coverRefusal.body.error !== 'COVER_REQUIRED') {
    throw new Error(`Required media guards failed: ${JSON.stringify({ avatarRefusal, coverRefusal })}`)
  }
  const [{ data: blocked }, { data: audits }] = await Promise.all([
    admin.from('tailor_draft_media').select('id,moderation_status').eq('id', removable.id).maybeSingle(),
    admin.from('audit_logs').select('event').eq('actor_id', userId).in('event', ['tailor_claim.profile_edited', 'tailor_claim.media_removed']),
  ])
  if (blocked?.moderation_status !== 'BLOCKED' || new Set((audits ?? []).map((row) => row.event)).size !== 2) {
    throw new Error('Database state or audit proof is incomplete.')
  }
  console.log(JSON.stringify({ result: 'tailor_claim_curation_passed', profileUpdated: true, removablePhotoBlocked: true, avatarGuard: true, coverGuard: true, auditEvents: 2 }))
} finally {
  await admin.from('tailor_claim_bootstrap_sessions').update({ status: 'EXPIRED', completed_at: new Date().toISOString() }).eq('id', sessionId).in('status', ['PREPARING', 'ACTIVE'])
  const { data: current } = await admin.auth.admin.getUserById(userId)
  await admin.auth.admin.updateUserById(userId, {
    ban_duration: '876000h',
    app_metadata: { ...(current.user?.app_metadata ?? {}), role: 'TAILOR', account_origin: 'STAFF_DRAFT', claim_session_id: null },
  })
  if (accessToken) await admin.auth.admin.signOut(accessToken, 'global').catch(() => null)
}
