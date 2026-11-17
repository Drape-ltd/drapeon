import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { verifyCloudflareOpsAccess } from '../_shared/ops-access.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { log } from '../_shared/logger.ts'
import { inspectDraftMedia } from '../_shared/draft-media-validation.ts'
import { queuePrivateMediaSafetyReview } from '../_shared/media-safety.ts'
import { validateTailorDraftFields } from '../_shared/tailor-draft-profile.ts'

const FN = 'tailor-draft-action'
const encoder = new TextEncoder()
const allowedMime = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
])
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function base64url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')
}
function rawToken() {
  const value = new Uint8Array(32)
  crypto.getRandomValues(value)
  return base64url(value)
}
async function tokenHash(value: string) {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))))
}
async function sha256Hex(value: Uint8Array) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(value).buffer)),
    (byte) => byte.toString(16).padStart(2, '0')
  ).join('')
}
const text = (value: unknown, max = 500) =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''
const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
function hasVerifiedServiceRoleBroker(request: Request) {
  const authorization =
      request.headers
        .get('authorization')
        ?.replace(/^Bearer\s+/iu, '')
        .trim() ?? '',
    apiKey = request.headers.get('apikey')?.trim() ?? ''
  const [header, payload, signature, extra] = authorization.split('.')
  if (!header || !payload || !signature || extra || authorization !== apiKey) return false
  try {
    const claims = JSON.parse(
      atob(
        payload
          .replaceAll('-', '+')
          .replaceAll('_', '/')
          .padEnd(Math.ceil(payload.length / 4) * 4, '=')
      )
    ) as { role?: unknown; ref?: unknown; iat?: unknown; exp?: unknown }
    const now = Math.floor(Date.now() / 1000),
      expectedRef = new URL(getSupabaseUrl()).hostname.split('.')[0]
    return (
      claims.role === 'service_role' &&
      claims.ref === expectedRef &&
      typeof claims.iat === 'number' &&
      claims.iat <= now + 30 &&
      typeof claims.exp === 'number' &&
      claims.exp > now
    )
  } catch {
    return false
  }
}

Deno.serve(async (request) => {
  const cors = getCorsHeaders(request)
  const correlationId = crypto.randomUUID()
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'Cache-Control': 'private, no-store',
        'Referrer-Policy': 'no-referrer',
      },
    })
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ error: 'POST required.' }, 405)
  const raw = await request.text()
  if (raw.length > 64_000) return json({ error: 'Request too large.' }, 413)
  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw)
  } catch {
    return json({ error: 'Invalid request.' }, 400)
  }
  const action = text(body.action, 40).toUpperCase()
  const client = createClient(getSupabaseUrl(), getServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  if (action === 'RESOLVE_PREVIEW') {
    if (!hasVerifiedServiceRoleBroker(request))
      return json({ error: 'This preview is unavailable.' }, 404)
    const token = text(body.token, 100)
    const ip = text(request.headers.get('x-drape-client-ip'), 80)
    if (!/^([0-9a-f:.]+)$/iu.test(ip)) return json({ error: 'This preview is unavailable.' }, 404)
    if (!token || !(await checkRateLimit(client, `${FN}:resolve:ip:${ip}`, 600, 30)))
      return json({ error: 'This preview is unavailable.' }, 404)
    const hash = await tokenHash(token)
    if (!(await checkRateLimit(client, `${FN}:resolve:token:${hash}`, 600, 20)))
      return json({ error: 'This preview is unavailable.' }, 404)
    const { data: invite, error: resolveError } = await client
      .rpc('resolve_tailor_claim_preview', { p_token_hash: hash })
      .maybeSingle()
    if (resolveError) return json({ error: 'This preview is unavailable.' }, 404)
    if (!invite) return json({ error: 'This preview is unavailable.' }, 404)
    const resolution = invite as { invite_id: string; profile_id: string; opened_now: boolean }
    const { data: profile, error: profileError } = await client
      .from('tailor_profiles')
      .select(
        'id,display_name,business_name,bio,location,languages,specialty_tags,price_range_min,price_range_max,currency,seller_type,availability,supports_custom_orders,supports_ready_made,pickup_available,delivery_available,shipping_available'
      )
      .eq('id', resolution.profile_id)
      .eq('lifecycle_state', 'OPENED')
      .maybeSingle()
    if (profileError || !profile) return json({ error: 'This preview is unavailable.' }, 404)
    const { data: media, error: mediaError } = await client
      .from('tailor_draft_media')
      .select('media_kind,storage_path,sort_order,is_cover,focal_x,focal_y')
      .eq('invite_id', resolution.invite_id)
      .eq('moderation_status', 'APPROVED')
      .not('confirmed_at', 'is', null)
      .order('sort_order')
    if (mediaError) return json({ error: 'This preview is unavailable.' }, 404)
    const safeMedia = []
    for (const [index, asset] of (media ?? []).entries()) {
      const { data, error } = await client.storage
        .from('tailor-draft-media')
        .createSignedUrl(asset.storage_path, 300)
      if (error) return json({ error: 'This preview is unavailable.' }, 404)
      if (data?.signedUrl)
        safeMedia.push({
          id: `media-${index}`,
          kind: asset.media_kind,
          url: data.signedUrl,
          sortOrder: asset.sort_order,
          isCover: asset.is_cover,
          focalX: asset.focal_x,
          focalY: asset.focal_y,
        })
    }
    if (resolution.opened_now)
      await client.from('audit_logs').insert({
        actor_role: 'SYSTEM',
        event: 'tailor_claim.preview_opened',
        severity: 'info',
        payload: { invite_id: resolution.invite_id, correlation_id: correlationId },
      })
    return json({ ok: true, preview: { ...profile, id: 'private-preview', media: safeMedia } })
  }

  if (!hasVerifiedServiceRoleBroker(request))
    return json({ error: 'Trusted Ops broker authentication is required.' }, 401)
  const assertion = request.headers.get('x-drape-ops-access-assertion') ?? ''
  const sensitiveAudiences = list(Deno.env.get('CF_ACCESS_SENSITIVE_AUD')).map((v) =>
    v.toLowerCase()
  )
  const identity = await verifyCloudflareOpsAccess(assertion, {
    teamDomain: Deno.env.get('CF_ACCESS_TEAM_DOMAIN') ?? '',
    normalAudiences: list(Deno.env.get('CF_ACCESS_AUD')),
    sensitiveAudiences,
    requireSensitive: false,
    allowedEmailDomain: Deno.env.get('OPS_ALLOWED_EMAIL_DOMAIN') ?? 'drapeon.co',
    allowedEmails: list(Deno.env.get('OPS_ALLOWED_EMAILS')),
  })
  const fresh = Boolean(
    identity &&
    sensitiveAudiences.some((v) => identity.audiences.includes(v)) &&
    Math.floor(Date.now() / 1000) - identity.issuedAt <= 900
  )
  if (!identity || !fresh) return json({ error: 'Fresh protected workforce access required.' }, 401)
  const { data: principal, error: principalError } = await client
    .from('ops_workforce_principals')
    .select('id,status,roles,permitted_environments,access_subject,session_revoked_before')
    .eq('email', identity.email)
    .maybeSingle()
  const environment = (Deno.env.get('DRAPE_OPS_ENV') ?? '').toUpperCase()
  if (principalError) throw principalError
  const revokedBefore = principal?.session_revoked_before
    ? Math.floor(Date.parse(principal.session_revoked_before) / 1000)
    : 0
  if (
    !principal ||
    principal.status !== 'ACTIVE' ||
    (principal.access_subject && principal.access_subject !== identity.subject) ||
    identity.issuedAt <= revokedBefore ||
    !principal.permitted_environments?.includes(environment.toLowerCase()) ||
    !principal.roles?.some((r: string) => ['admin', 'trust'].includes(r))
  )
    return json({ error: 'Draft authority unavailable.' }, 403)
  const admin = principal.roles.includes('admin')
  const idempotencyKey = text(body.idempotencyKey, 180)
  if (idempotencyKey.length < 16) return json({ error: 'A replay key is required.' }, 400)
  const { data: newReceipt, error: receiptError } = await client
    .from('tailor_draft_action_receipts')
    .insert({
      actor_principal_id: principal.id,
      action_key: action,
      idempotency_key: idempotencyKey,
    })
    .select('id')
    .single()
  let receiptId = newReceipt?.id as string | undefined
  if (receiptError) {
    if (receiptError.code !== '23505')
      return json({ error: 'The action receipt could not be prepared.' }, 409)
    const { data: existing } = await client
      .from('tailor_draft_action_receipts')
      .select('id,action_key,outcome,response,http_status')
      .eq('actor_principal_id', principal.id)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle()
    if (!existing || existing.action_key !== action)
      return json({ error: 'The replay key is already bound to another action.' }, 409)
    if (['SUCCEEDED', 'FAILED'].includes(existing.outcome) && existing.response)
      return json(
        existing.response,
        existing.http_status ?? (existing.outcome === 'SUCCEEDED' ? 200 : 409)
      )
    return json({ error: 'This action is already being processed.', correlationId }, 409)
  }
  const succeed = async (body: Record<string, unknown>) => {
    const stored = { ...body }
    delete stored.token
    delete stored.signedUploadUrl
    delete stored.uploadToken
    await client
      .from('tailor_draft_action_receipts')
      .update({
        outcome: 'SUCCEEDED',
        response: stored,
        http_status: 200,
        completed_at: new Date().toISOString(),
      })
      .eq('id', receiptId!)
    return json(body)
  }
  const rejected = async (body: Record<string, unknown>, status: number, failureCode: string) => {
    await client
      .from('tailor_draft_action_receipts')
      .update({
        outcome: 'FAILED',
        response: body,
        http_status: status,
        failure_code: failureCode,
        completed_at: new Date().toISOString(),
      })
      .eq('id', receiptId!)
    return json(body, status)
  }

  try {
    if (action === 'CREATE') {
      const validated = validateTailorDraftFields(body)
      if (!validated.value)
        return await rejected(
          { error: validated.error ?? 'Draft details are invalid.' },
          400,
          'INVALID_CREATE'
        )
      const fields = validated.value,
        displayName = fields.displayName
      const userId = crypto.randomUUID(),
        email = `draft+${userId}@claim.drapeon.invalid`
      const { data: created, error: authError } = await client.auth.admin.createUser({
        id: userId,
        email,
        email_confirm: false,
        ban_duration: '876000h',
        user_metadata: { role: 'TAILOR', account_origin: 'STAFF_DRAFT', display_name: displayName },
      })
      if (authError || !created.user) throw authError ?? new Error('Placeholder creation failed')
      const { data: profile, error: profileError } = await client
        .from('tailor_profiles')
        .insert({
          user_id: userId,
          display_name: displayName,
          business_name: fields.businessName,
          bio: fields.bio,
          location: fields.location,
          languages: fields.languages,
          specialty_tags: fields.specialties,
          price_range_min: fields.priceMin,
          price_range_max: fields.priceMax,
          currency: fields.currency,
          seller_type: 'TAILOR',
          supports_custom_orders: true,
          supports_ready_made: false,
          pickup_available: false,
          delivery_available: false,
          shipping_available: false,
          is_live: false,
          is_verified: false,
          lifecycle_state: 'DRAFT',
        })
        .select('id')
        .single()
      if (profileError || !profile) {
        await client.auth.admin.deleteUser(userId)
        throw profileError ?? new Error('Profile creation failed')
      }
      const { data: invite, error: inviteError } = await client
        .from('tailor_claim_invites')
        .insert({
          tailor_user_id: userId,
          tailor_profile_id: profile.id,
          created_by_principal: principal.id,
          source_handle: text(body.sourceHandle, 120) || null,
          source_url: text(body.sourceUrl, 500) || null,
          correlation_id: correlationId,
        })
        .select('id')
        .single()
      if (inviteError || !invite) {
        await client.auth.admin.deleteUser(userId)
        throw inviteError ?? new Error('Invite creation failed')
      }
      await client.from('audit_logs').insert({
        actor_role: 'OPS',
        event: 'tailor_draft.created',
        severity: 'info',
        payload: {
          invite_id: invite.id,
          profile_id: profile.id,
          principal_id: principal.id,
          correlation_id: correlationId,
          idempotency_key: idempotencyKey,
        },
      })
      return await succeed({ ok: true, inviteId: invite.id, profileId: profile.id, correlationId })
    }
    const inviteId = text(body.inviteId, 40)
    if (!uuid.test(inviteId))
      return await rejected({ error: 'Valid draft required.' }, 400, 'INVALID_DRAFT')
    const { data: invite } = await client
      .from('tailor_claim_invites')
      .select('*,tailor_profiles(*)')
      .eq('id', inviteId)
      .maybeSingle()
    if (!invite) return await rejected({ error: 'Draft not found.' }, 404, 'DRAFT_NOT_FOUND')
    const mediaActions = new Set([
      'REGISTER_MEDIA',
      'CONFIRM_MEDIA',
      'MODERATE_MEDIA',
      'UPDATE_MEDIA',
      'REORDER_MEDIA',
      'DELETE_MEDIA',
    ])
    if (mediaActions.has(action) && invite.status !== 'DRAFT') {
      return await rejected(
        { error: 'Media freezes after a claim link is issued.' },
        409,
        'MEDIA_FROZEN'
      )
    }
    if (action === 'EDIT') {
      if (invite.status !== 'DRAFT')
        return await rejected(
          { error: 'Draft details freeze after a link is issued.' },
          409,
          'DRAFT_NOT_EDITABLE'
        )
      const validated = validateTailorDraftFields(body)
      if (!validated.value)
        return await rejected(
          { error: validated.error ?? 'Draft details are invalid.' },
          400,
          'INVALID_EDIT'
        )
      const fields = validated.value
      const patch: Record<string, unknown> = {
        display_name: fields.displayName,
        business_name: fields.businessName,
        bio: fields.bio,
        location: fields.location,
        languages: fields.languages,
        specialty_tags: fields.specialties,
        currency: fields.currency,
        price_range_min: fields.priceMin,
        price_range_max: fields.priceMax,
        updated_at: new Date().toISOString(),
      }
      const { error } = await client
        .from('tailor_profiles')
        .update(patch)
        .eq('id', invite.tailor_profile_id)
      if (error) throw error
    } else if (action === 'PREAPPROVE') {
      if (!admin)
        return await rejected({ error: 'Administrator approval required.' }, 403, 'ADMIN_REQUIRED')
      if (invite.status !== 'DRAFT')
        return await rejected(
          { error: 'Pre-approval is frozen after a link is issued.' },
          409,
          'PREAPPROVAL_FROZEN'
        )
      const reason = text(body.reason, 1000),
        evidence = text(body.evidenceRef, 500),
        placement = text(body.placement, 30)
      if (
        reason.length < 20 ||
        evidence.length < 8 ||
        !['TAILORING', 'READY_TO_WEAR'].includes(placement) ||
        body.publicEvidenceReviewed !== true ||
        body.videoWaiverAcknowledged !== true
      )
        return await rejected(
          { error: 'Reason, evidence, placement and acknowledgements are required.' },
          400,
          'INVALID_PREAPPROVAL'
        )
      const { data: approved, error } = await client
        .from('tailor_claim_invites')
        .update({
          approved_by_principal: principal.id,
          approval_reason: reason,
          evidence_ref: evidence,
          public_evidence_reviewed: true,
          video_waiver_acknowledged: true,
          marketplace_placement: placement,
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', inviteId)
        .eq('status', 'DRAFT')
        .select('id')
        .maybeSingle()
      if (error) throw error
      if (!approved)
        return await rejected(
          { error: 'Pre-approval is frozen after a link is issued.' },
          409,
          'PREAPPROVAL_FROZEN'
        )
    } else if (action === 'ISSUE') {
      if (!invite.approved_at)
        return await rejected(
          { error: 'Admin pre-approval is required before issuing a link.' },
          409,
          'PREAPPROVAL_REQUIRED'
        )
      const token = rawToken(),
        hash = await tokenHash(token),
        now = new Date(),
        expires = new Date(now.getTime() + 30 * 86400000).toISOString()
      const { data: issued, error } = await client.rpc('transition_tailor_claim_invite', {
        p_invite_id: inviteId,
        p_action: 'ISSUE',
        p_token_hash: hash,
        p_expires_at: expires,
      })
      if (error) throw error
      if (!issued)
        return await rejected(
          {
            error:
              'Complete the profile, approved avatar, approved photo, pre-approval and placement before issuing a link.',
          },
          409,
          'INVALID_INVITE_STATE'
        )
      await client.from('audit_logs').insert({
        actor_role: 'OPS',
        event: 'tailor_draft.invite_issued',
        severity: 'warn',
        payload: {
          invite_id: inviteId,
          principal_id: principal.id,
          expires_at: expires,
          correlation_id: correlationId,
          idempotency_key: idempotencyKey,
        },
      })
      return await succeed({ ok: true, token, expiresAt: expires, correlationId })
    } else if (action === 'REVOKE' || action === 'DECLINE') {
      const { data: transitioned, error } = await client.rpc('transition_tailor_claim_invite', {
        p_invite_id: inviteId,
        p_action: action,
        p_token_hash: null,
        p_expires_at: null,
      })
      if (error) throw error
      if (!transitioned)
        return await rejected(
          { error: 'Only draft, invited or opened profiles can be changed this way.' },
          409,
          'INVALID_INVITE_STATE'
        )
    } else if (action === 'REGISTER_MEDIA') {
      const kind = text(body.mediaKind, 10),
        mime = text(body.contentType, 80),
        bytes = Number(body.byteSize),
        sha = text(body.sha256, 100)
      if (
        !['AVATAR', 'PHOTO', 'VIDEO'].includes(kind) ||
        !allowedMime.has(mime) ||
        !Number.isInteger(bytes) ||
        bytes < 1 ||
        bytes > 52428800 ||
        !/^[a-f0-9]{64}$/iu.test(sha)
      )
        return await rejected({ error: 'Invalid media metadata.' }, 400, 'INVALID_MEDIA')
      const assetId = crypto.randomUUID(),
        extension = mime.startsWith('image/')
          ? mime === 'image/png'
            ? 'png'
            : mime === 'image/webp'
              ? 'webp'
              : 'jpg'
          : mime === 'video/quicktime'
            ? 'mov'
            : 'mp4'
      const path = `drafts/${rawToken()}/${rawToken()}.${extension}`
      const { data, error } = await client.storage
        .from('tailor-draft-media')
        .createSignedUploadUrl(path)
      if (error || !data) throw error ?? new Error('Upload URL failed')
      const { error: insertError } = await client.from('tailor_draft_media').insert({
        id: assetId,
        invite_id: inviteId,
        storage_path: path,
        media_kind: kind,
        content_type: mime,
        byte_size: bytes,
        sha256: sha,
        sort_order: Number(body.sortOrder) || 0,
        is_cover: body.isCover === true,
        focal_x: body.focalX ?? null,
        focal_y: body.focalY ?? null,
      })
      if (insertError) throw insertError
      return await succeed({
        ok: true,
        assetId,
        signedUploadUrl: data.signedUrl,
        uploadToken: data.token,
        storagePath: path,
        correlationId,
      })
    } else if (action === 'CONFIRM_MEDIA') {
      const assetId = text(body.assetId, 40)
      const { data: asset } = await client
        .from('tailor_draft_media')
        .select('id,storage_path,content_type,byte_size,sha256,media_kind')
        .eq('id', assetId)
        .eq('invite_id', inviteId)
        .maybeSingle()
      if (!asset)
        return await rejected({ error: 'Draft media was not found.' }, 404, 'MEDIA_NOT_FOUND')
      const { data: download, error: downloadError } = await client.storage
        .from('tailor-draft-media')
        .download(asset.storage_path)
      if (downloadError || !download)
        return await rejected(
          { error: 'The private upload did not finish.' },
          409,
          'UPLOAD_INCOMPLETE'
        )
      const bytes = new Uint8Array(await download.arrayBuffer()),
        inspection = inspectDraftMedia(bytes, asset.content_type)
      const valid =
        bytes.byteLength === Number(asset.byte_size) &&
        (await sha256Hex(bytes)) === asset.sha256 &&
        inspection &&
        inspection.width <= 12000 &&
        inspection.height <= 12000 &&
        (!inspection.durationMs || inspection.durationMs <= 300000)
      if (!valid) {
        await client.storage.from('tailor-draft-media').remove([asset.storage_path])
        await client.from('tailor_draft_media').delete().eq('id', assetId)
        return await rejected(
          { error: 'The uploaded bytes failed private media validation.' },
          415,
          'MEDIA_VALIDATION_FAILED'
        )
      }
      const mediaAssetId = await queuePrivateMediaSafetyReview(client, {
        fn: FN,
        actorId: invite.tailor_user_id,
        actorRole: 'OPS',
        bucketId: 'tailor-draft-media',
        objectPath: asset.storage_path,
        mimeType: inspection.mimeType,
        byteSize: bytes.byteLength,
        width: inspection.width,
        height: inspection.height,
        durationMs: inspection.durationMs,
        checksumSha256: asset.sha256,
        purpose: asset.media_kind,
        tailorProfileId: invite.tailor_profile_id,
        relatedEntityId: asset.id,
        metadata: { inviteId },
      })
      const { error } = await client
        .from('tailor_draft_media')
        .update({
          width: inspection.width,
          height: inspection.height,
          duration_ms: inspection.durationMs,
          media_asset_id: mediaAssetId,
          confirmed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', assetId)
      if (error) throw error
      return await succeed({ ok: true, assetId, moderationStatus: 'PENDING', correlationId })
    } else if (action === 'MODERATE_MEDIA') {
      if (!admin)
        return await rejected({ error: 'Administrator approval required.' }, 403, 'ADMIN_REQUIRED')
      const assetId = text(body.assetId, 40),
        decision = text(body.decision, 20).toUpperCase(),
        reason = text(body.reason, 500)
      if (!['APPROVE', 'BLOCK'].includes(decision) || reason.length < 12)
        return await rejected(
          { error: 'A media decision and reason are required.' },
          400,
          'INVALID_MEDIA_DECISION'
        )
      const { data: asset } = await client
        .from('tailor_draft_media')
        .select('id,media_asset_id')
        .eq('id', assetId)
        .eq('invite_id', inviteId)
        .not('confirmed_at', 'is', null)
        .maybeSingle()
      if (!asset?.media_asset_id)
        return await rejected(
          { error: 'Confirmed draft media was not found.' },
          404,
          'MEDIA_NOT_FOUND'
        )
      const status = decision === 'APPROVE' ? 'APPROVED' : 'BLOCKED'
      const { error } = await client.rpc('set_media_asset_moderation_status', {
        p_media_asset_id: asset.media_asset_id,
        p_status: status,
        p_risk_level: decision === 'APPROVE' ? 'LOW' : 'HIGH',
        p_reasons: decision === 'APPROVE' ? [] : [`OPS_BLOCK:${reason}`],
        p_reviewed_by: identity.email,
      })
      if (error) throw error
      const { error: updateError } = await client
        .from('tailor_draft_media')
        .update({ moderation_status: status, updated_at: new Date().toISOString() })
        .eq('id', assetId)
      if (updateError) throw updateError
    } else if (action === 'UPDATE_MEDIA') {
      const assetId = text(body.assetId, 40),
        sortOrder = Number(body.sortOrder),
        focalX = Number(body.focalX),
        focalY = Number(body.focalY)
      if (
        !uuid.test(assetId) ||
        !Number.isInteger(sortOrder) ||
        sortOrder < 0 ||
        sortOrder > 1000 ||
        !Number.isFinite(focalX) ||
        focalX < 0 ||
        focalX > 1 ||
        !Number.isFinite(focalY) ||
        focalY < 0 ||
        focalY > 1
      )
        return await rejected({ error: 'Invalid media layout.' }, 400, 'INVALID_MEDIA_LAYOUT')
      const { data: updated, error } = await client.rpc('update_tailor_draft_media_layout', {
        p_invite_id: inviteId,
        p_asset_id: assetId,
        p_sort_order: sortOrder,
        p_is_cover: body.isCover === true,
        p_focal_x: focalX,
        p_focal_y: focalY,
      })
      if (error) throw error
      if (updated !== true)
        return await rejected({ error: 'Draft media was not found.' }, 404, 'MEDIA_NOT_FOUND')
    } else if (action === 'REORDER_MEDIA') {
      const assetIds = Array.isArray(body.assetIds)
        ? body.assetIds.filter((item): item is string => typeof item === 'string')
        : []
      if (
        assetIds.length < 1 ||
        assetIds.length > 50 ||
        new Set(assetIds).size !== assetIds.length ||
        assetIds.some((item) => !uuid.test(item))
      )
        return await rejected({ error: 'Invalid media order.' }, 400, 'INVALID_MEDIA_ORDER')
      const { data: reordered, error } = await client.rpc('reorder_tailor_draft_media', {
        p_invite_id: inviteId,
        p_asset_ids: assetIds,
      })
      if (error) throw error
      if (reordered !== true)
        return await rejected({ error: 'The media order is stale.' }, 409, 'STALE_MEDIA_ORDER')
    } else if (action === 'DELETE_MEDIA') {
      const assetId = text(body.assetId, 40)
      const { data: asset } = await client
        .from('tailor_draft_media')
        .select('storage_path,media_asset_id')
        .eq('id', assetId)
        .eq('invite_id', inviteId)
        .maybeSingle()
      if (asset) {
        const removal = await client.storage.from('tailor-draft-media').remove([asset.storage_path])
        if (removal.error) throw removal.error
        const deleted = await client.from('tailor_draft_media').delete().eq('id', assetId)
        if (deleted.error) throw deleted.error
        if (asset.media_asset_id) {
          const removedAsset = await client
            .from('media_assets')
            .delete()
            .eq('id', asset.media_asset_id)
          if (removedAsset.error) throw removedAsset.error
        }
      }
    } else return await rejected({ error: 'Unsupported action.' }, 400, 'UNSUPPORTED_ACTION')
    await client.from('audit_logs').insert({
      actor_role: 'OPS',
      event: `tailor_draft.${action.toLowerCase()}`,
      severity: 'info',
      payload: {
        invite_id: inviteId,
        principal_id: principal.id,
        correlation_id: correlationId,
        idempotency_key: idempotencyKey,
      },
    })
    return await succeed({ ok: true, correlationId })
  } catch (error) {
    log('error', FN, 'action.failed', {
      action,
      correlation_id: correlationId,
      error: error instanceof Error ? error.message : String(error),
    })
    return await rejected(
      { error: 'The draft action could not be completed.', correlationId },
      409,
      'ACTION_FAILED'
    )
  }
})
