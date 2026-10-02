import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { hasVerifiedProjectBroker } from './broker-policy.ts'
import { verifyCloudflareOpsAccess } from '../_shared/ops-access.ts'
import { canDecideTrustException, deriveTrustExceptionProfileRequirements, parseTrustExceptionCommand, trustExceptionFailureMessage } from '../_shared/trust-exception-policy.ts'
import { log } from '../_shared/logger.ts'

const list = (value: string | undefined) => (value ?? '').split(',').map(x => x.trim()).filter(Boolean)

Deno.serve(async request => {
  const cors = getCorsHeaders(request)
  const correlationId = crypto.randomUUID()
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  })
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ error: 'POST required.' }, 405)
  const serviceKey = getServiceRoleKey()
  if (!hasVerifiedProjectBroker(request, new URL(getSupabaseUrl()).hostname.split('.')[0])) return json({ error: 'Trusted broker required.' }, 401)
  try {
    const sensitiveAudiences = list(Deno.env.get('CF_ACCESS_SENSITIVE_AUD')).map(value => value.toLowerCase())
    const identity = await verifyCloudflareOpsAccess(request.headers.get('x-drape-ops-access-assertion') ?? '', {
      teamDomain: Deno.env.get('CF_ACCESS_TEAM_DOMAIN') ?? '',
      normalAudiences: list(Deno.env.get('CF_ACCESS_AUD')),
      sensitiveAudiences,
      requireSensitive: false,
      allowedEmailDomain: Deno.env.get('OPS_ALLOWED_EMAIL_DOMAIN') ?? 'drapeon.co',
      allowedEmails: list(Deno.env.get('OPS_ALLOWED_EMAILS')),
    })
    // Access itself performs the second factor; upstream IdP amr may be absent.
    // Match ops-trust-action: signed exact sensitive audience plus fresh issuance.
    const protectedAssurance = Boolean(identity && sensitiveAudiences.some(value => identity.audiences.includes(value)) && Math.floor(Date.now()/1000)-identity.issuedAt <= 900)
    if (!identity || !protectedAssurance) return json({ error: 'Fresh protected workforce access required.' }, 401)
    const raw = await request.text()
    if (raw.length > 16384) return json({ error: 'Request too large.' }, 413)
    const body = JSON.parse(raw) as Record<string, unknown>
    const read = body.action === 'READ'
    let command: ReturnType<typeof parseTrustExceptionCommand> | null = null
    try { command = read ? null : parseTrustExceptionCommand(body) }
    catch { return json({ error: 'A valid action, profile, reason, evidence reference, replay key and review acknowledgements are required.', code: 'INVALID_EXCEPTION_COMMAND', correlationId },400) }
    const profileId = command?.profileId ?? body.profileId
    if (typeof profileId !== 'string' || !/^[0-9a-f-]{36}$/iu.test(profileId)) return json({ error: 'Invalid profile ID.' }, 400)
    const environment = (Deno.env.get('DRAPE_OPS_ENV') ?? '').toUpperCase()
    if (!['DEVELOPMENT','PRODUCTION'].includes(environment)) return json({ error: 'Environment unavailable.' }, 503)
    const client = createClient(getSupabaseUrl(), serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    async function readProfileRequirements(profileId: string) {
      const { data: profile, error: profileError } = await client.from('tailor_profiles')
        .select('user_id,display_name,avatar_url,specialty_tags,portfolio_photo_urls')
        .eq('id', profileId).maybeSingle()
      if (profileError || !profile) return null
      const { data: user, error: userError } = await client.from('users')
        .select('phone').eq('id', profile.user_id).maybeSingle()
      if (userError || !user) return null
      return deriveTrustExceptionProfileRequirements({
        displayName: profile.display_name,
        phone: user.phone,
        avatarUrl: profile.avatar_url,
        specialtyTags: profile.specialty_tags,
        portfolioPhotoUrls: profile.portfolio_photo_urls,
      })
    }
    const { data: principal, error } = await client.from('ops_workforce_principals')
      .select('id,status,roles,permitted_environments,access_subject,session_revoked_before')
      .eq('email',identity.email).maybeSingle()
    if (error || !principal || !canDecideTrustException({ roles: principal.roles ?? [],
      status: principal.status, protectedAccess: protectedAssurance,
      environmentAllowed: (principal.permitted_environments ?? []).includes(environment.toLowerCase()) })
      || (principal.access_subject && principal.access_subject !== identity.subject)
      || identity.issuedAt <= (principal.session_revoked_before ? Date.parse(principal.session_revoked_before)/1000 : 0)) {
      return json({ error: 'Administrator authority unavailable or revoked.' }, 403)
    }
    const { data, error: rpcError } = await client.rpc('ops_trust_exception_action', {
      p_action: read ? 'READ' : command!.action, p_profile_id: profileId,
      p_actor_principal_id: principal.id, p_environment: environment, p_sensitive_assurance: true,
      p_reason: command?.reason ?? '', p_evidence_reference: command?.evidenceReference ?? '',
      p_idempotency_key: command?.idempotencyKey ?? '', p_correlation_id: correlationId,
      p_issue_id: command?.issueId ?? null, p_expected_record_version: command?.expectedRecordVersion ?? null,
      p_public_evidence_reviewed: body.publicEvidenceReviewed === true,
      p_video_waiver_acknowledged: body.videoWaiverAcknowledged === true,
    })
    if (rpcError) {
      log('warn','ops-trust-exception-action','rpc.failed',{
        action: read ? 'READ' : command!.action,
        code: rpcError.code,
        failure: trustExceptionFailureMessage(rpcError.code, rpcError.message),
        correlation_id: correlationId,
      })
      const conflict = ['40001','55000'].includes(rpcError.code)
      const profileRequirements = command?.action === 'APPROVE' ? await readProfileRequirements(profileId) : undefined
      return json({ error: trustExceptionFailureMessage(rpcError.code, rpcError.message), code:rpcError.code,correlationId,
        ...(profileRequirements ? { profileRequirements } : {}) },conflict ? 409 : 400)
    }
    const includeProfileRequirements = read || command?.action === 'REQUEST' || command?.action === 'REFRESH'
    const profileRequirements = includeProfileRequirements ? await readProfileRequirements(profileId) : undefined
    if (includeProfileRequirements && !profileRequirements) {
      log('warn','ops-trust-exception-action','profile.readiness.failed',{action: read ? 'READ' : command?.action,correlation_id:correlationId})
    }
    return json({ ...data, ...(includeProfileRequirements ? { profileRequirements } : {}), correlationId })
  } catch {
    log('error','ops-trust-exception-action','command.failed',{correlation_id:correlationId})
    return json({ error: 'The protected exception command could not be completed.', correlationId }, 400)
  }
})
