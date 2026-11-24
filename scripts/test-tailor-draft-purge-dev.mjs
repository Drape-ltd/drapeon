#!/usr/bin/env node

// Development-only live proof for the purge retry ledger. The fixture is
// terminal and over the retention threshold, so the worker must enqueue it,
// process it, and leave the durable DONE ledger row behind.
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

const PROJECT_REF = 'pqptfuqogvrajozfsqzi'
const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`
const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { createClient } = webRequire('@supabase/supabase-js')

const keys = spawnSync(
  'supabase',
  ['projects', 'api-keys', '--project-ref', PROJECT_REF, '--output', 'json'],
  { encoding: 'utf8' },
)
if (keys.status !== 0) throw new Error('Could not load Development API-key metadata.')
const serviceKey = JSON.parse(keys.stdout).find((entry) => entry.name === 'service_role')?.api_key
if (!serviceKey) throw new Error('Development service-role key is unavailable.')

const client = createClient(PROJECT_URL, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const userId = randomUUID()
const profileId = randomUUID()
const inviteId = randomUUID()
const expiredAt = new Date(Date.now() - 31 * 86400_000).toISOString()

async function fail(message, error) {
  if (error) throw new Error(`${message}: ${error.message}`)
  throw new Error(message)
}

const { error: userError } = await client.auth.admin.createUser({
  id: userId,
  email: `draft+purge-proof-${userId}@claim.drapeon.invalid`,
  email_confirm: false,
  ban_duration: '876000h',
  app_metadata: { role: 'TAILOR', account_origin: 'STAFF_DRAFT' },
})
if (userError) await fail('Could not create purge-proof placeholder', userError)

try {
  const { data: principals, error: principalError } = await client
    .from('ops_workforce_principals')
    .select('id')
    .is('revoked_at', null)
    .limit(1)
  if (principalError || !principals?.[0]?.id)
    await fail('No active Development Ops principal is available', principalError)

  const { error: profileError } = await client.from('tailor_profiles').insert({
    id: profileId,
    user_id: userId,
    display_name: 'Development purge ledger proof',
    business_name: 'Development purge ledger proof',
    bio: 'Development-only retention proof; this profile is immediately purged.',
    location: 'Lagos, Nigeria',
    languages: ['English'],
    specialty_tags: ['OTHER'],
    price_range_min: 1000,
    price_range_max: 2000,
    currency: 'USD',
    is_live: false,
    is_verified: false,
    lifecycle_state: 'REVOKED',
  })
  if (profileError) await fail('Could not create purge-proof profile', profileError)

  const { error: inviteError } = await client.from('tailor_claim_invites').insert({
    id: inviteId,
    tailor_user_id: userId,
    tailor_profile_id: profileId,
    token_hash: null,
    status: 'REVOKED',
    expires_at: expiredAt,
    created_by_principal: principals[0].id,
    correlation_id: randomUUID(),
    updated_at: expiredAt,
  })
  if (inviteError) await fail('Could not create terminal purge-proof invite', inviteError)

  const { data: eligibleInvite, error: eligibilityError } = await client
    .from('tailor_claim_invites')
    .select('id,status,updated_at')
    .eq('id', inviteId)
    .in('status', ['EXPIRED', 'REVOKED', 'DECLINED'])
    .lt('updated_at', new Date(Date.now() - 30 * 86400_000).toISOString())
    .maybeSingle()
  if (eligibilityError || !eligibleInvite)
    await fail('Purge-proof invite did not meet the terminal retention query', eligibilityError)

  const response = await fetch(`${PROJECT_URL}/functions/v1/purge-tailor-drafts`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`Purge worker returned ${response.status}: ${JSON.stringify(body)}`)

  const { data: ledger, error: ledgerError } = await client
    .from('tailor_draft_purges')
    .select('invite_id,step,attempts,terminal_status,completed_at')
    .eq('invite_id', inviteId)
    .maybeSingle()
  if (ledgerError || !ledger || ledger.step !== 'DONE' || !ledger.completed_at)
    throw new Error(
      `Purge ledger row was not completed: ${ledgerError?.message ?? JSON.stringify({ response: body, ledger })}`,
    )

  console.log(JSON.stringify({
    result: 'development_purge_ledger_proof_passed',
    inviteId,
    profileId,
    userId,
    httpStatus: response.status,
    worker: { scanned: body?.scanned, purged: body?.purged, failed: body?.failed },
    ledger: {
      step: ledger.step,
      attempts: ledger.attempts,
      terminalStatus: ledger.terminal_status,
      completed: Boolean(ledger.completed_at),
    },
  }))
} catch (error) {
  // Preserve the durable ledger on success only; a failed setup must not leave
  // a placeholder or invite behind to be mistaken for a real draft.
  await client.from('tailor_claim_invites').delete().eq('id', inviteId)
  await client.from('tailor_profiles').delete().eq('id', profileId)
  await client.auth.admin.deleteUser(userId)
  throw error
}
