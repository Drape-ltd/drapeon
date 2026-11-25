#!/usr/bin/env node

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const PROJECT_REF = 'pqptfuqogvrajozfsqzi'
const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`
const args = process.argv.slice(2)
const outputIndex = args.indexOf('--output')
const outputPath = outputIndex >= 0 ? args[outputIndex + 1]?.trim() : null
if (outputIndex >= 0 && (!outputPath || args.length !== 3))
  throw new Error('Use --output supabase/.temp/<fixture>.json after the fixture name.')
const tempRoot = `${resolve('supabase/.temp')}/`
if (outputPath && !`${resolve(outputPath)}/`.startsWith(tempRoot))
  throw new Error('Fixture output must stay under the gitignored supabase/.temp directory.')
const fixtureName =
  args.find((value, index) => index !== outputIndex && index !== outputIndex + 1)?.trim() ||
  'Apple claim device proof'
if (fixtureName.length < 3 || fixtureName.length > 80)
  throw new Error('Fixture name must be 3–80 characters.')
const linkedRef = readFileSync(
  new URL('../supabase/.temp/project-ref', import.meta.url),
  'utf8'
).trim()
if (linkedRef !== PROJECT_REF) throw new Error(`Refusing non-development project ${linkedRef}.`)

const keyResult = spawnSync(
  'supabase',
  ['projects', 'api-keys', '--project-ref', PROJECT_REF, '-o', 'json'],
  { encoding: 'utf8' }
)
if (keyResult.status !== 0) throw new Error('Could not load development API keys.')
const keys = JSON.parse(keyResult.stdout)
const serviceKey = keys.find((entry) => entry.name === 'service_role')?.api_key
if (!serviceKey) throw new Error('Development service-role key is unavailable.')

const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { createClient } = webRequire('@supabase/supabase-js')
const client = createClient(PROJECT_URL, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const { data: staleProfiles, error: staleProfilesError } = await client
  .from('tailor_profiles')
  .select('id,user_id')
  .eq('display_name', fixtureName)
if (staleProfilesError) throw staleProfilesError
for (const staleProfile of staleProfiles ?? []) {
  const { data: staleInvites } = await client
    .from('tailor_claim_invites')
    .select('id,tailor_draft_media(storage_path)')
    .eq('tailor_profile_id', staleProfile.id)
  const paths = (staleInvites ?? []).flatMap((invite) =>
    (invite.tailor_draft_media ?? []).map((media) => media.storage_path)
  )
  if (paths.length) await client.storage.from('tailor-draft-media').remove(paths)
  await client.from('tailor_profiles').delete().eq('id', staleProfile.id)
  await client.from('users').delete().eq('id', staleProfile.user_id)
  const { error: deleteError } = await client.auth.admin.deleteUser(staleProfile.user_id)
  if (deleteError && deleteError.code !== 'user_not_found') throw deleteError
}

const userId = randomUUID()
const profileId = randomUUID()
const inviteId = randomUUID()
const token = randomBytes(32).toString('base64url')
const tokenHash = createHash('sha256').update(token).digest('base64url')
const avatarId = randomUUID()
const photoId = randomUUID()
const removablePhotoId = randomUUID()
const avatarPath = `${inviteId}/${avatarId}.jpg`
const photoPath = `${inviteId}/${photoId}.jpg`
const removablePhotoPath = `${inviteId}/${removablePhotoId}.jpg`
const mediaFixtures = [
  {
    id: avatarId,
    path: avatarPath,
    bytes: readFileSync(
      new URL('../apps/web/public/studio-preview/easy-everyday.jpg', import.meta.url)
    ),
    kind: 'AVATAR',
    width: 640,
    height: 960,
    sortOrder: 0,
    cover: false,
  },
  {
    id: photoId,
    path: photoPath,
    bytes: readFileSync(
      new URL('../apps/web/public/studio-preview/adire-ensemble.jpg', import.meta.url)
    ),
    kind: 'PHOTO',
    width: 733,
    height: 1100,
    sortOrder: 1,
    cover: true,
  },
  {
    id: removablePhotoId,
    path: removablePhotoPath,
    bytes: readFileSync(
      new URL('../apps/web/public/studio-preview/teal-occasion.jpg', import.meta.url)
    ),
    kind: 'PHOTO',
    width: 733,
    height: 1100,
    sortOrder: 2,
    cover: false,
  },
].map((item) => ({
  ...item,
  contentType: 'image/jpeg',
  sha256: createHash('sha256').update(item.bytes).digest('hex'),
}))
let createdUser = false

try {
  const { error: authError } = await client.auth.admin.createUser({
    id: userId,
    email: `draft+${userId}@claim.drapeon.invalid`,
    email_confirm: false,
    ban_duration: '876000h',
    app_metadata: { role: 'TAILOR', account_origin: 'STAFF_DRAFT' },
    user_metadata: {
      role: 'TAILOR',
      account_origin: 'STAFF_DRAFT',
      display_name: fixtureName,
    },
  })
  if (authError) throw authError
  createdUser = true

  const { data: principals, error: principalError } = await client
    .from('ops_workforce_principals')
    .select('id')
    .is('revoked_at', null)
    .limit(1)
  if (principalError || !principals?.[0]?.id)
    throw new Error('No active development Ops principal.')

  const { error: profileError } = await client.from('tailor_profiles').insert({
    id: profileId,
    user_id: userId,
    display_name: fixtureName,
    business_name: fixtureName,
    bio: 'Handcrafted occasion wear with a focus on thoughtful fit and polished finishing.',
    location: 'Lagos, Nigeria',
    languages: ['English'],
    specialty_tags: ['OTHER'],
    price_range_min: 1000,
    price_range_max: 2000,
    currency: 'USD',
    is_live: false,
    is_verified: false,
    lifecycle_state: 'OPENED',
  })
  if (profileError) throw profileError

  const { error: inviteError } = await client.from('tailor_claim_invites').insert({
    id: inviteId,
    tailor_user_id: userId,
    tailor_profile_id: profileId,
    token_hash: tokenHash,
    status: 'OPENED',
    expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    created_by_principal: principals[0].id,
    correlation_id: randomUUID(),
    opened_at: new Date().toISOString(),
    approved_by_principal: principals[0].id,
    approval_reason: 'Development-only physical-device claim proof.',
    evidence_ref: 'dev-physical-device-proof',
    public_evidence_reviewed: true,
    video_waiver_acknowledged: true,
    marketplace_placement: 'TAILORING',
    approved_at: new Date().toISOString(),
  })
  if (inviteError) throw inviteError

  for (const media of mediaFixtures) {
    const { error: uploadError } = await client.storage
      .from('tailor-draft-media')
      .upload(media.path, media.bytes, { contentType: media.contentType, upsert: false })
    if (uploadError) throw uploadError
  }
  const { error: mediaError } = await client.from('tailor_draft_media').insert(
    mediaFixtures.map((media) => ({
      id: media.id,
      invite_id: inviteId,
      storage_path: media.path,
      media_kind: media.kind,
      content_type: media.contentType,
      byte_size: media.bytes.byteLength,
      sha256: media.sha256,
      width: media.width,
      height: media.height,
      confirmed_at: new Date().toISOString(),
      sort_order: media.sortOrder,
      is_cover: media.cover,
      focal_x: 0.5,
      focal_y: 0.5,
      moderation_status: 'APPROVED',
    }))
  )
  if (mediaError) throw mediaError

  const fixture = {
    result: 'tailor_claim_provider_fixture_ready',
    userId,
    profileId,
    inviteId,
    token,
    appPath: `/claim/${token}`,
    expiresInMinutes: 60,
  }
  if (outputPath) {
    writeFileSync(outputPath, `${JSON.stringify(fixture)}\n`, { encoding: 'utf8', mode: 0o600 })
    console.log(
      JSON.stringify({
        result: fixture.result,
        userId,
        profileId,
        inviteId,
        output: outputPath,
        expiresInMinutes: fixture.expiresInMinutes,
      })
    )
  } else {
    console.log(JSON.stringify(fixture))
  }
} catch (error) {
  if (createdUser) await client.auth.admin.deleteUser(userId).catch(() => null)
  throw error
}
