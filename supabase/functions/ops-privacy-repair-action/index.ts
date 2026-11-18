import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log } from '../_shared/logger.ts'
import { verifyCloudflareOpsAccess } from '../_shared/ops-access.ts'

const FN = 'ops-privacy-repair-action'

type RepairBody = {
  expectedRecordVersion?: unknown
  idempotencyKey?: unknown
  correlationId?: unknown
  reason?: unknown
}

function list(value: string | undefined) {
  return (value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)
}

function stringValue(value: unknown, maxLength = 180) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength
    ? value.trim()
    : null
}

function json(body: Record<string, unknown>, status: number, cors: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store, max-age=0' },
  })
}

Deno.serve(async (request) => {
  const cors = getCorsHeaders(request)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, cors)
  const correlationId = request.headers.get('x-correlation-id')?.trim() || crypto.randomUUID()

  try {
    const accessAssertion = request.headers.get('x-drape-ops-access-assertion')?.trim() ?? ''
    const identity = await verifyCloudflareOpsAccess(accessAssertion, {
      teamDomain: Deno.env.get('CF_ACCESS_TEAM_DOMAIN') ?? '',
      normalAudiences: list(Deno.env.get('CF_ACCESS_AUD')),
      sensitiveAudiences: list(Deno.env.get('CF_ACCESS_SENSITIVE_AUD')),
      requireSensitive: true,
      allowedEmailDomain: Deno.env.get('OPS_ALLOWED_EMAIL_DOMAIN') ?? 'drapeon.co',
      allowedEmails: list(Deno.env.get('OPS_ALLOWED_EMAILS')),
    })
    if (!identity?.sensitiveAssurance) return json({ error: 'Fresh sensitive workforce assurance is required.', correlationId }, 401, cors)

    const raw = await request.text()
    if (raw.length > 4_096) return json({ error: 'Request is too large.', correlationId }, 413, cors)
    const body = JSON.parse(raw || '{}') as RepairBody
    const idempotencyKey = stringValue(body.idempotencyKey)
    const reason = stringValue(body.reason, 1_000)
    const requestCorrelationId = stringValue(body.correlationId) ?? correlationId
    const expectedRecordVersion = typeof body.expectedRecordVersion === 'number' && Number.isSafeInteger(body.expectedRecordVersion)
      ? body.expectedRecordVersion
      : null
    if (!idempotencyKey || !reason || !expectedRecordVersion) {
      return json({ error: 'A case version, bounded reason, and idempotency key are required.', correlationId }, 400, cors)
    }

    const environment = (Deno.env.get('DRAPE_OPS_ENV') ?? '').trim().toUpperCase()
    if (environment !== 'PRODUCTION') return json({ error: 'This repair is available only in Production.', correlationId }, 403, cors)

    const supabase: SupabaseClient = createClient(getSupabaseUrl(), getServiceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: principal, error: principalError } = await supabase
      .from('ops_workforce_principals')
      .select('id,access_subject,status,roles,permitted_environments,session_revoked_before,access_review_due_at')
      .eq('email', identity.email)
      .maybeSingle()
    if (principalError) throw principalError
    const issuedAt = identity.issuedAt ?? 0
    const revokedBefore = principal?.session_revoked_before ? Math.floor(Date.parse(principal.session_revoked_before) / 1000) : 0
    const accessReviewDueAt = principal?.access_review_due_at ? Date.parse(principal.access_review_due_at) : Number.NaN
    if (!principal
      || principal.status !== 'ACTIVE'
      || (principal.access_subject && principal.access_subject !== identity.subject)
      || !principal.roles?.includes('admin')
      || !principal.permitted_environments?.includes('production')
      || issuedAt <= revokedBefore
      || !Number.isFinite(accessReviewDueAt)
      || accessReviewDueAt <= Date.now()) {
      return json({ error: 'An active Production admin is required for this repair.', correlationId }, 403, cors)
    }

    const { data, error } = await supabase.rpc('repair_legacy_unknown_privacy_case', {
      p_expected_record_version: expectedRecordVersion,
      p_idempotency_key: idempotencyKey,
      p_actor_principal_id: principal.id,
      p_actor_label: identity.email,
      p_environment: environment,
      p_correlation_id: requestCorrelationId,
      p_reason: reason,
    })
    if (error) {
      const conflict = error.code === '40001'
      const forbidden = error.code === '42501'
      const invalid = error.code === '22023'
      if (!conflict && !forbidden && !invalid) log('error', FN, 'rpc.failed', { correlation_id: correlationId, code: error.code })
      return json({
        error: conflict
          ? 'The legacy case changed. Reload before retrying.'
          : forbidden
            ? 'This case is not eligible for the forward repair.'
            : invalid
              ? 'The repair details are invalid.'
              : 'The privacy repair could not be persisted.',
        correlationId,
      }, conflict ? 409 : forbidden ? 403 : invalid ? 400 : 500, cors)
    }
    return json({ ok: true, receipt: data, correlationId }, 200, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { correlation_id: correlationId, error: error instanceof Error ? error.message : String(error) })
    return json({ error: 'The privacy repair could not be completed.', correlationId }, 500, cors)
  }
})
