import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeCronRequest } from '../_shared/cron.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'

const FN = 'purge-tailor-drafts'
const BATCH = 50
const RETENTION_DAYS = 30
const errorMessage = (cause: unknown) =>
  (cause instanceof Error ? cause.message : String(cause)).slice(0, 500)

Deno.serve(async (request) => {
  const cors = getCorsHeaders(request)
  const unauthorized = await authorizeCronRequest(request, FN, cors)
  if (unauthorized) return unauthorized
  const client = createClient(getSupabaseUrl(), getServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: reapedBootstrapSessions, error: bootstrapReaperError } = await client.rpc(
    'reap_expired_tailor_claim_bootstrap_sessions',
    { p_limit: BATCH }
  )
  if (bootstrapReaperError) {
    log('error', FN, 'bootstrap_session.reap_failed', { error: bootstrapReaperError.message })
    return new Response(JSON.stringify({ error: 'Bootstrap session reaper failed.' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
  const bootstrapSessionsReaped = (reapedBootstrapSessions ?? []).length
  const now = new Date().toISOString()
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString()
  const abandonedCutoff = new Date(Date.now() - 86400000).toISOString()

  const { data: abandoned, error: abandonedError } = await client
    .from('tailor_draft_media')
    .select('id,storage_path')
    .is('confirmed_at', null)
    .lt('created_at', abandonedCutoff)
    .order('created_at')
    .limit(BATCH)
  if (abandonedError)
    return new Response(JSON.stringify({ error: 'Abandoned upload lookup failed.' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  let abandonedPurged = 0
  for (const asset of abandoned ?? []) {
    const removal = await client.storage.from('tailor-draft-media').remove([asset.storage_path])
    if (removal.error) {
      log('error', FN, 'abandoned_media.purge_failed', {
        asset_id: asset.id,
        error: removal.error.message,
      })
      continue
    }
    const deleted = await client
      .from('tailor_draft_media')
      .delete()
      .eq('id', asset.id)
      .is('confirmed_at', null)
    if (!deleted.error) abandonedPurged++
  }

  const { data: eligible, error: eligibleError } = await client
    .from('tailor_claim_invites')
    .select('id,tailor_user_id,tailor_profile_id,status,expires_at,updated_at')
    .or(
      `and(status.in.(INVITED,OPENED),expires_at.lt.${now}),and(status.in.(EXPIRED,REVOKED,DECLINED),updated_at.lt.${cutoff})`
    )
    .order('updated_at')
    .limit(BATCH)
  if (eligibleError)
    return new Response(JSON.stringify({ error: 'Purge lookup failed.' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })

  let expired = 0
  const terminal = []
  for (const invite of eligible ?? []) {
    if (['INVITED', 'OPENED'].includes(invite.status)) {
      const transitioned = await client
        .from('tailor_claim_invites')
        .update({ status: 'EXPIRED', token_hash: null, updated_at: now })
        .eq('id', invite.id)
        .in('status', ['INVITED', 'OPENED'])
      if (transitioned.error) {
        log('error', FN, 'draft.expire_failed', {
          invite_id: invite.id,
          error: transitioned.error.message,
        })
        continue
      }
      const profile = await client
        .from('tailor_profiles')
        .update({ lifecycle_state: 'EXPIRED', updated_at: now })
        .eq('user_id', invite.tailor_user_id)
      if (profile.error) {
        log('error', FN, 'draft.profile_expire_failed', {
          invite_id: invite.id,
          error: profile.error.message,
        })
        continue
      }
      expired++
    } else {
      terminal.push({
        invite_id: invite.id,
        tailor_user_id: invite.tailor_user_id,
        tailor_profile_id: String(invite.tailor_profile_id),
        terminal_status: invite.status,
      })
    }
  }
  if (terminal.length) {
    const queued = await client
      .from('tailor_draft_purges')
      .upsert(terminal, { onConflict: 'invite_id', ignoreDuplicates: true })
    if (queued.error)
      return new Response(JSON.stringify({ error: 'Purge ledger enqueue failed.' }), {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
  }

  const { data: pending, error: pendingError } = await client
    .from('tailor_draft_purges')
    .select('*')
    .neq('step', 'DONE')
    .order('created_at')
    .limit(BATCH)
  if (pendingError)
    return new Response(JSON.stringify({ error: 'Purge ledger lookup failed.' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })

  let purged = 0
  let failed = 0
  for (const purge of pending ?? []) {
    try {
      const attempt = await client
        .from('tailor_draft_purges')
        .update({
          attempts: Number(purge.attempts) + 1,
          last_attempt_at: now,
          last_error: null,
          updated_at: now,
        })
        .eq('invite_id', purge.invite_id)
      if (attempt.error) throw attempt.error

      if (purge.step === 'QUEUED') {
        const { data: assets, error: assetError } = await client
          .from('tailor_draft_media')
          .select('storage_path,media_asset_id')
          .eq('invite_id', purge.invite_id)
        if (assetError) throw assetError
        const paths = (assets ?? []).map((item) => item.storage_path).filter(Boolean)
        if (paths.length) {
          const removal = await client.storage.from('tailor-draft-media').remove(paths)
          if (removal.error) throw removal.error
        }
        const mediaAssetIds = (assets ?? []).map((item) => item.media_asset_id).filter(Boolean)
        if (mediaAssetIds.length) {
          const removedAssets = await client.from('media_assets').delete().in('id', mediaAssetIds)
          if (removedAssets.error) throw removedAssets.error
        }
        const mediaRows = await client
          .from('tailor_draft_media')
          .delete()
          .eq('invite_id', purge.invite_id)
        if (mediaRows.error) throw mediaRows.error
        const advanced = await client
          .from('tailor_draft_purges')
          .update({ step: 'MEDIA_DELETED', updated_at: now })
          .eq('invite_id', purge.invite_id)
        if (advanced.error) throw advanced.error
        purge.step = 'MEDIA_DELETED'
      }

      if (purge.step === 'MEDIA_DELETED') {
        const removedProfile = await client
          .from('tailor_profiles')
          .delete()
          .eq('id', purge.tailor_profile_id)
        if (removedProfile.error) throw removedProfile.error
        const advanced = await client
          .from('tailor_draft_purges')
          .update({ step: 'PROFILE_DELETED', updated_at: now })
          .eq('invite_id', purge.invite_id)
        if (advanced.error) throw advanced.error
        purge.step = 'PROFILE_DELETED'
      }

      if (purge.step === 'PROFILE_DELETED') {
        const existing = await client.auth.admin.getUserById(purge.tailor_user_id)
        if (existing.error && existing.error.status !== 404) throw existing.error
        if (existing.data?.user) {
          const deletion = await client.auth.admin.deleteUser(purge.tailor_user_id)
          if (deletion.error && deletion.error.status !== 404) throw deletion.error
        }
        const advanced = await client
          .from('tailor_draft_purges')
          .update({ step: 'AUTH_DELETED', updated_at: now })
          .eq('invite_id', purge.invite_id)
        if (advanced.error) throw advanced.error
        purge.step = 'AUTH_DELETED'
      }

      const completed = await client
        .from('tailor_draft_purges')
        .update({ step: 'DONE', completed_at: now, last_error: null, updated_at: now })
        .eq('invite_id', purge.invite_id)
      if (completed.error) throw completed.error
      purged++
      await audit(client, {
        event: 'tailor_draft.purged',
        actor_id: null,
        actor_role: 'SYSTEM',
        severity: 'info',
        payload: {
          invite_id: purge.invite_id,
          terminal_status: purge.terminal_status,
          retention_days: RETENTION_DAYS,
          attempts: Number(purge.attempts) + 1,
        },
      })
    } catch (cause) {
      failed++
      const error = errorMessage(cause)
      await client
        .from('tailor_draft_purges')
        .update({ last_error: error, last_attempt_at: now, updated_at: now })
        .eq('invite_id', purge.invite_id)
      log('error', FN, 'draft.purge_failed', { invite_id: purge.invite_id, error })
    }
  }

  return new Response(
    JSON.stringify({
      ok: failed === 0,
      scanned: (pending ?? []).length,
      expired,
      purged,
      abandonedPurged,
      bootstrapSessionsReaped,
      failed,
      batch: BATCH,
    }),
    {
      status: failed ? 500 : 200,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    }
  )
})
