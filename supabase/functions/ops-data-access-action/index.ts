import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log } from '../_shared/logger.ts'
import { verifyCloudflareOpsAccess } from '../_shared/ops-access.ts'

const FN = 'ops-data-access-action'
const list = (value: string | undefined) => (value ?? '').split(',').map((item) => item.trim()).filter(Boolean)
const value = (input: unknown, max = 180) => typeof input === 'string' && input.trim().length > 0 && input.trim().length <= max ? input.trim() : null
const json = (body: Record<string, unknown>, status: number, cors: HeadersInit) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
})

Deno.serve(async (request) => {
  const cors = getCorsHeaders(request)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, cors)
  const correlationId = request.headers.get('x-correlation-id')?.trim() || crypto.randomUUID()
  try {
    const assertion = request.headers.get('x-drape-ops-access-assertion')?.trim() ?? ''
    const identity = await verifyCloudflareOpsAccess(assertion, {
      teamDomain: Deno.env.get('CF_ACCESS_TEAM_DOMAIN') ?? '',
      normalAudiences: list(Deno.env.get('CF_ACCESS_AUD')),
      sensitiveAudiences: list(Deno.env.get('CF_ACCESS_SENSITIVE_AUD')),
      requireSensitive: true,
      allowedEmailDomain: Deno.env.get('OPS_ALLOWED_EMAIL_DOMAIN') ?? 'drapeon.co',
      allowedEmails: list(Deno.env.get('OPS_ALLOWED_EMAILS')),
    })
    if (!identity?.sensitiveAssurance) return json({ error: 'Fresh protected workforce access is required.', correlationId }, 401, cors)
    const raw = await request.text()
    if (raw.length > 16_384) return json({ error: 'Request is too large.', correlationId }, 413, cors)
    const body = JSON.parse(raw || '{}') as Record<string, unknown>
    const action = value(body.action, 30)?.toUpperCase()
    const issueId = value(body.issueId)
    const exportId = value(body.exportId)
    const reason = value(body.reason, 1000)
    const idempotencyKey = value(body.idempotencyKey)
    const exportFingerprint = value(body.exportFingerprint, 32)
    const expectedRecordVersion = typeof body.expectedRecordVersion === 'number' && Number.isSafeInteger(body.expectedRecordVersion)
      ? body.expectedRecordVersion : null
    if (!['INSPECT', 'RELEASE'].includes(action ?? '') || !issueId || !exportId
      || (action === 'RELEASE' && (!reason || !idempotencyKey || !expectedRecordVersion || !exportFingerprint))) {
      return json({ error: 'Case, export, and valid action are required.', correlationId }, 400, cors)
    }
    const environment = (Deno.env.get('DRAPE_OPS_ENV') ?? '').trim().toUpperCase()
    if (!['DEVELOPMENT', 'PRODUCTION'].includes(environment)) return json({ error: 'Ops environment is unavailable.', correlationId }, 503, cors)
    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: principal, error: principalError } = await supabase.from('ops_workforce_principals')
      .select('id,email,access_subject,status,roles,permitted_environments,session_revoked_before,access_review_due_at')
      .eq('email', identity.email).maybeSingle()
    if (principalError) throw principalError
    const revokedBefore = principal?.session_revoked_before ? Math.floor(Date.parse(principal.session_revoked_before) / 1000) : 0
    const dueAt = principal?.access_review_due_at ? Date.parse(principal.access_review_due_at) : Number.NaN
    if (!principal || principal.status !== 'ACTIVE' || (principal.access_subject && principal.access_subject !== identity.subject)
      || !(principal.permitted_environments ?? []).includes(environment.toLowerCase())
      || (identity.issuedAt ?? 0) <= revokedBefore || !Number.isFinite(dueAt) || dueAt <= Date.now()) {
      return json({ error: 'Workforce principal is unavailable or revoked.', correlationId }, 403, cors)
    }
    const { data, error } = action === 'INSPECT'
      ? await supabase.rpc('inspect_ops_data_access_export', {
        p_issue_id: issueId, p_export_id: exportId, p_actor_principal_id: principal.id,
        p_actor_label: identity.email, p_environment: environment,
        p_sensitive_assurance: true, p_correlation_id: correlationId,
      })
      : await supabase.rpc('perform_ops_data_access_release', {
        p_issue_id: issueId, p_export_id: exportId, p_reason: reason,
        p_expected_record_version: expectedRecordVersion,
        p_expected_export_fingerprint: exportFingerprint, p_idempotency_key: idempotencyKey,
        p_actor_principal_id: principal.id, p_actor_label: identity.email,
        p_environment: environment, p_sensitive_assurance: true, p_correlation_id: correlationId,
      })
    if (error) {
      const status = error.code === '40001' || error.code === '55000' ? 409
        : error.code === '42501' ? 403 : error.code === '22023' ? 400 : 500
      if (status === 500) log('error', FN, 'rpc.failed', { code: error.code, correlation_id: correlationId })
      return json({ error: status === 409 ? 'Case or export changed. Reload before acting.' : 'The protected privacy action could not be completed.',
        code: error.code, correlationId }, status, cors)
    }
    return json({ ok: true, receipt: data, correlationId }, 200, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { correlation_id: correlationId, error: error instanceof Error ? error.message : String(error) })
    return json({ error: 'The protected privacy action could not be completed.', correlationId }, 500, cors)
  }
})
