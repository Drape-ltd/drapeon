#!/usr/bin/env node

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const PROJECT_REF = 'pqptfuqogvrajozfsqzi'
const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`
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
  .select('user_id')
  .eq('display_name', 'Apple claim device proof')
if (staleProfilesError) throw staleProfilesError
for (const staleProfile of staleProfiles ?? []) {
  const { error: deleteError } = await client.auth.admin.deleteUser(staleProfile.user_id)
  if (deleteError) throw deleteError
}

const userId = randomUUID()
const profileId = randomUUID()
const inviteId = randomUUID()
const token = randomBytes(32).toString('base64url')
const tokenHash = createHash('sha256').update(token).digest('base64url')
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
      display_name: 'Apple claim device proof',
    },
  })
  if (authError) throw authError
  createdUser = true

  const { data: principals, error: principalError } = await client
    .from('ops_workforce_principals')
    .select('id')
    .is('revoked_at', null)
    .limit(1)
  if (principalError || !principals?.[0]?.id) throw new Error('No active development Ops principal.')

  const { error: profileError } = await client.from('tailor_profiles').insert({
    id: profileId,
    user_id: userId,
    display_name: 'Apple claim device proof',
    business_name: 'Apple claim device proof',
    bio: 'Development-only physical-device proof profile that is never public or live.',
    location: 'Development',
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
  })
  if (inviteError) throw inviteError

  console.log(
    JSON.stringify({
      result: 'tailor_claim_provider_fixture_ready',
      userId,
      profileId,
      inviteId,
      token,
      appPath: `/claim/${token}`,
      expiresInMinutes: 60,
    })
  )
} catch (error) {
  if (createdUser) await client.auth.admin.deleteUser(userId).catch(() => null)
  throw error
}
