import { NextResponse } from 'next/server'
import { getOpsSession, hasFreshOpsMfa } from '../../../../../web/lib/ops-auth'
import { validateOpsMutationOrigin } from '../../../../../web/lib/ops-request-security'
import { getSupabaseServiceRoleKey } from '../../../../../web/lib/supabase-config'
import { validateServiceRoleTarget } from '../../../../../web/lib/supabase-environment'
import { isRestrictedOpsPhoneHeaders } from '../../../../lib/client-surface'
import { resolveLocalWorkforcePrincipal } from '../../../../lib/local-workforce-principal'
import { deriveTrustExceptionProfileRequirements, parseTrustExceptionCommand, trustExceptionFailureMessage } from '../../../../../../supabase/functions/_shared/trust-exception-policy'

export const dynamic = 'force-dynamic'
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
export async function POST(request: Request) {
  if (!validateOpsMutationOrigin(request).ok || isRestrictedOpsPhoneHeaders(request.headers)) return json({ error: 'Protected desktop origin required.' }, 403)
  const session = await getOpsSession()
  if (!session?.allowed || session.role !== 'admin' || !hasFreshOpsMfa(session)) return json({ error: 'Fresh protected administrator session required.' }, 401)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? process.env.SUPABASE_URL?.trim()
  const key = getSupabaseServiceRoleKey()
  if (!url || !key || !validateServiceRoleTarget(url,key,process.env.SUPABASE_SERVICE_ROLE_PROJECT_REF).isValid) return json({ error: 'Exception broker unavailable.' }, 503)
  const body = await request.text()
  if (body.length > 16384) return json({ error: 'Request too large.' }, 413)
  const correlationId = crypto.randomUUID()
  // Existing signed local-workforce QA bridge, restricted to the exact dev DB.
  // Production can only use the independently signed Cloudflare broker below.
  if (session.mode === 'local-workforce') {
    if (process.env.NODE_ENV === 'production' || new URL(url).hostname !== 'pqptfuqogvrajozfsqzi.supabase.co') return json({ error:'Development-only workforce bridge.' },403)
    const local = await resolveLocalWorkforcePrincipal(session)
    if (!local || !local.principal.roles.includes('admin')) return json({error:'Development administrator unavailable.'},403)
    let value: Record<string, unknown>
    let command: ReturnType<typeof parseTrustExceptionCommand> | null
    let read: boolean
    try {
      const parsed: unknown = JSON.parse(body)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid command body.')
      value = parsed as Record<string, unknown>
      read = value.action === 'READ'
      command = read ? null : parseTrustExceptionCommand(value)
    } catch {
      return json({ error: 'Invalid development exception command.', correlationId }, 400)
    }
    try {
      const profileId = command?.profileId ?? value.profileId
      if (typeof profileId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(profileId)) return json({error:'Valid profile required.',correlationId},400)
      const {data,error}=await local.client.rpc('ops_trust_exception_action',{
        p_action:read?'READ':command!.action,p_profile_id:profileId,p_actor_principal_id:local.principal.id,
        p_environment:'DEVELOPMENT',p_sensitive_assurance:true,p_reason:command?.reason??'',
        p_evidence_reference:command?.evidenceReference??'',p_idempotency_key:command?.idempotencyKey??'',
        p_correlation_id:correlationId,p_issue_id:command?.issueId??null,
        p_expected_record_version:command?.expectedRecordVersion??null,
        p_public_evidence_reviewed:value.publicEvidenceReviewed===true,p_video_waiver_acknowledged:value.videoWaiverAcknowledged===true,
      })
      const includeProfileRequirements = read || command?.action === 'REQUEST' || command?.action === 'REFRESH' || Boolean(error && command?.action === 'APPROVE')
      let profileRequirements = null
      if (includeProfileRequirements) {
        const {data:profile,error:profileError}=await local.client.from('tailor_profiles')
          .select('user_id,display_name,avatar_url,specialty_tags,portfolio_photo_urls').eq('id',profileId).maybeSingle()
        if (!profileError && profile) {
          const {data:user,error:userError}=await local.client.from('users').select('phone').eq('id',profile.user_id).maybeSingle()
          if (!userError && user) profileRequirements=deriveTrustExceptionProfileRequirements({
            displayName:profile.display_name,phone:user.phone,avatarUrl:profile.avatar_url,
            specialtyTags:profile.specialty_tags,portfolioPhotoUrls:profile.portfolio_photo_urls,
          })
        }
      }
      if(error)return json({error:trustExceptionFailureMessage(error.code,error.message),code:error.code,correlationId,
        ...(profileRequirements ? {profileRequirements} : {})},['40001','55000'].includes(error.code)?409:400)
      return json({...data,...(includeProfileRequirements?{profileRequirements}:{}),correlationId},200)
    } catch {
      return json({ error: 'The development exception request was interrupted. Reload the case before retrying the same command.', correlationId }, 502)
    }
  }
  if (session.mode !== 'cloudflare-access' || !session.principalId) return json({error:'Named Cloudflare workforce required.'},401)
  const assertion = request.headers.get('cf-access-jwt-assertion')
  if (!assertion) return json({ error: 'Signed workforce assertion required.' }, 401)
  try {
    const response = await fetch(`${url.replace(/\/+$/u,'')}/functions/v1/ops-trust-exception-action`, {
      method:'POST', headers:{ apikey: key, Authorization: `Bearer ${key}`, 'Content-Type':'application/json',
        'x-drape-ops-access-assertion':assertion }, body, cache:'no-store', signal:AbortSignal.timeout(20000),
    })
    return json(await response.json(), response.status)
  } catch { return json({ error:'Response interrupted. Reread the case before retrying the same command.', correlationId },502) }
}
