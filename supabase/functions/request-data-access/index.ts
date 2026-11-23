/**
 * request-data-access
 *
 * Lets authenticated users submit a durable in-app request for a copy of their
 * account data. V1 export handling stays request-based, but this keeps the path
 * more concrete than a generic mailto link and gives ops an audit trail.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { createOrRefreshOpsIssue, requireKnownOpsEnvironment } from '../_shared/ops-issues.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { buildCustomerExportPackage, buildTailorExportPackage } from '../_shared/data-access-export.ts'
import { optionalNote, parseBody, z } from '../_shared/validate.ts'

const FN = 'request-data-access'
const REQUEST_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

const BodySchema = z.object({
  action: z.enum(['STATUS', 'SUBMIT', 'REFRESH_EXPORT', 'DOWNLOAD']).optional(),
  note: optionalNote,
  source: z.enum(['MOBILE_APP', 'WEB_APP']).optional(),
})

function jsonResponse(body: Record<string, unknown>, status: number, headers: HeadersInit) {
  if (typeof body.error === 'string' && typeof body.message !== 'string') {
    body.message = body.error
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  })
}


Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const caller = await getAuthUser(req)
    if (!caller) {
      log('warn', FN, 'auth.unauthenticated')
      return jsonResponse({ error: 'Please sign in again before requesting your data.' }, 401, cors)
    }

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) {
      log('warn', FN, 'validation.failed', { actor_id: caller.id, error: parsed.error })
      return jsonResponse({ error: parsed.error }, 400, cors)
    }

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    await requireKnownOpsEnvironment(supabase)

    const recentThreshold = new Date(Date.now() - REQUEST_WINDOW_MS).toISOString()
    const { data: existing, error: existingError } = await supabase
      .from('audit_logs')
      .select('id, created_at, actor_role, payload')
      .eq('actor_id', caller.id)
      .eq('event', 'privacy.data_access_requested')
      .gte('created_at', recentThreshold)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingError) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: existingError.message })
      return jsonResponse({ error: 'We could not check your existing data requests right now. Please try again.' }, 500, cors)
    }

    const existingPayload = existing?.payload && typeof existing.payload === 'object' ? existing.payload as Record<string, unknown> : {}
    const existingExportId = typeof existingPayload.data_export_id === 'string'
      ? existingPayload.data_export_id
      : typeof existingPayload.tailor_export_id === 'string' ? existingPayload.tailor_export_id : null
    const { data: existingExport, error: existingExportError } = existingExportId
      ? await supabase.from('tailor_data_exports')
        .select('id,status,expires_at,metadata')
        .eq('id', existingExportId).eq('tailor_user_id', caller.id).maybeSingle()
      : { data: null, error: null }
    if (existingExportError) return jsonResponse({ error: 'We could not check your export right now.' }, 500, cors)
    const existingRequest = existing?.id
      ? {
          id: existing.id,
          status: existingExport?.status ?? 'IN_REVIEW',
          createdAt: existing.created_at,
          exportId: existingExport?.id ?? null,
          expiresAt: existingExport?.expires_at ?? null,
          generationWarnings: Array.isArray(existingExport?.metadata?.export_package?.generationWarnings)
            ? existingExport.metadata.export_package.generationWarnings.length : 0,
        }
      : null

    if (parsed.data.action === 'STATUS') {
      return jsonResponse({ ok: true, request: existingRequest }, 200, cors)
    }

    if (parsed.data.action === 'DOWNLOAD') {
      if (!existingExport || !['READY', 'DELIVERED'].includes(existingExport.status)
        || (existingExport.expires_at && Date.parse(existingExport.expires_at) <= Date.now())) {
        return jsonResponse({ error: 'Your export is not ready to download.' }, 409, cors)
      }
      const { data: delivery, error: deliveryError } = await supabase.rpc('deliver_data_access_export', {
        p_export_id: existingExport.id,
        p_user_id: caller.id,
      })
      if (deliveryError || !delivery?.exportPackage) {
        log('error', FN, 'export.delivery_failed', { actor_id: caller.id, code: deliveryError?.code })
        return jsonResponse({ error: 'We could not deliver your export right now.' }, 500, cors)
      }
      return jsonResponse({ ok: true, request: { ...existingRequest, status: 'DELIVERED' }, exportPackage: delivery.exportPackage }, 200, cors)
    }

    if (parsed.data.action === 'REFRESH_EXPORT') {
      if (!existingExport || existingExport.status !== 'IN_REVIEW') {
        return jsonResponse({ error: 'There is no export in review to refresh.' }, 409, cors)
      }
      const { data: tailor } = await supabase.from('tailor_profiles').select('id').eq('user_id', caller.id).maybeSingle()
      const packageData = tailor?.id
        ? await buildTailorExportPackage(supabase, caller.id, tailor.id)
        : await buildCustomerExportPackage(supabase, caller.id)
      const { error: refreshError } = await supabase.from('tailor_data_exports').update({
        generated_at: packageData.generatedAt,
        expires_at: packageData.expiresAt,
        metadata: { ...existingExport.metadata, package_version: packageData.version, export_package: packageData },
      }).eq('id', existingExport.id).eq('tailor_user_id', caller.id).eq('status', 'IN_REVIEW')
      if (refreshError) return jsonResponse({ error: 'We could not refresh your export right now.' }, 500, cors)
      await audit(supabase, { event: 'privacy.data_access_export_refreshed', actor_id: caller.id,
        payload: { export_id: existingExport.id, warning_count: packageData.generationWarnings.length } })
      return jsonResponse({ ok: true, request: existingRequest, generationWarnings: packageData.generationWarnings.length }, 200, cors)
    }

    if (existing?.id) {
      const { data: caseRow, error: caseError } = await supabase.from('ops_issues')
        .select('id').eq('dedupe_key', `data-access:${caller.id}`)
        .eq('issue_type', 'DATA_ACCESS_REQUEST').maybeSingle()
      if (caseError) return jsonResponse({ error: 'We could not check your privacy case right now.' }, 500, cors)
      if (!caseRow) {
        const repaired = await createOrRefreshOpsIssue(supabase, {
          issueType: 'DATA_ACCESS_REQUEST', severity: 'MEDIUM', source: FN,
          actorId: caller.id, actorRole: existing.actor_role ?? 'UNKNOWN', userId: caller.id,
          title: 'Data access request',
          description: 'Account holder requested an in-app copy of their account data.',
          recommendedAction: 'Review the complete export and release it to the requester.',
          dedupeKey: `data-access:${caller.id}`,
          metadata: { account_email: caller.email ?? null, data_export_id: existingExportId,
            tailor_export_id: existingPayload.tailor_export_id ?? null,
            export_scope: existingExport?.metadata?.export_package?.scope ?? 'ACCOUNT_ACCESS' },
          requireKnownEnvironment: true, persistWhenRoutineDisabled: true,
        })
        if (!repaired) return jsonResponse({ error: 'We could not restore your privacy case right now.' }, 500, cors)
      }
      return jsonResponse({ ok: true, alreadyPending: existingExport?.status !== 'DELIVERED', request: existingRequest }, 200, cors)
    }

    const allowed = await checkRateLimit(supabase, `request-data-access:${caller.id}`, 86400, 5)
    if (!allowed) {
      await audit(supabase, {
        event: 'rate_limit.exceeded',
        actor_id: caller.id,
        severity: 'warn',
        payload: { function: FN },
      })
      return rateLimitExceededResponse(cors)
    }

    const [{ data: tailorProfile }, { data: customerProfile }] = await Promise.all([
      supabase.from('tailor_profiles').select('id').eq('user_id', caller.id).maybeSingle(),
      supabase.from('customer_profiles').select('id').eq('user_id', caller.id).maybeSingle(),
    ])

    const actorRole = tailorProfile ? 'TAILOR' : customerProfile ? 'CUSTOMER' : 'UNKNOWN'
    const note = parsed.data.note?.trim() ? parsed.data.note.trim() : null
    const source = parsed.data.source ?? 'MOBILE_APP'
    let dataExportId: string | null = null
    let exportScope = actorRole === 'TAILOR' ? 'TAILOR_PORTABILITY' : 'ACCOUNT_ACCESS'
    let generationWarningCount = 0

    {
      const tailorProfileId = (tailorProfile as { id?: string } | null)?.id
      if (actorRole === 'TAILOR' && !tailorProfileId) {
        return jsonResponse({ error: 'We could not find your tailor profile for export. Please try again after reopening Drapeon.' }, 409, cors)
      }
      const exportPackage = actorRole === 'TAILOR'
        ? await buildTailorExportPackage(supabase, caller.id, tailorProfileId!)
        : await buildCustomerExportPackage(supabase, caller.id)
      exportScope = exportPackage.scope
      generationWarningCount = exportPackage.generationWarnings.length
      const { data: exportRow, error: exportError } = await supabase
        .from('tailor_data_exports')
        .insert({
          tailor_user_id: caller.id,
          status: 'IN_REVIEW',
          export_scope: exportPackage.scope,
          generated_at: exportPackage.generatedAt,
          expires_at: exportPackage.expiresAt,
          metadata: {
            note,
            requested_from: source,
            package_version: exportPackage.version,
            export_package: exportPackage,
            includes: [
              'profile',
              'portfolio',
              'order_history',
              'reviews',
              'payout_summary',
            ],
          },
        })
        .select('id')
        .maybeSingle()

      if (exportError) {
        log('error', FN, 'tailor_export.create_failed', { actor_id: caller.id, error: exportError.message })
        return jsonResponse({ error: 'We could not start your tailor data export right now. Please try again.' }, 500, cors)
      }
      dataExportId = exportRow?.id ?? null
    }

    await audit(supabase, {
      event: 'privacy.data_access_requested',
      actor_id: caller.id,
      actor_role: actorRole,
      payload: {
        function: FN,
        source,
        account_email: caller.email ?? null,
        note,
        reason: note,
        tailor_export_id: actorRole === 'TAILOR' ? dataExportId : null,
        data_export_id: dataExportId,
      },
    })

    const opsIssue = await createOrRefreshOpsIssue(supabase, {
      issueType: 'DATA_ACCESS_REQUEST',
      severity: 'MEDIUM',
      source: FN,
      actorId: caller.id,
      actorRole,
      userId: caller.id,
      title: 'Data access request',
      description: `${actorRole.toLowerCase()} requested an in-app copy of their account data.`,
      recommendedAction: 'Acknowledge the privacy request, verify identity if needed, and coordinate the export response.',
      dedupeKey: `data-access:${caller.id}`,
      metadata: {
        account_email: caller.email ?? null,
        note,
        source,
        tailor_export_id: actorRole === 'TAILOR' ? dataExportId : null,
        data_export_id: dataExportId,
        export_scope: exportScope,
      },
      requireKnownEnvironment: true,
    })

    log('info', FN, 'privacy.data_access_requested', {
      actor_id: caller.id,
      actor_role: actorRole,
    })

    const { data: createdAuditRequest } = await supabase
      .from('audit_logs')
      .select('id, created_at')
      .eq('actor_id', caller.id)
      .eq('event', 'privacy.data_access_requested')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    return jsonResponse({
      ok: true,
      alreadyPending: false,
      tailorExportId: actorRole === 'TAILOR' ? dataExportId : null,
      dataExportId,
      request: {
        id: createdAuditRequest?.id ?? opsIssue?.id ?? dataExportId,
        status: 'IN_REVIEW',
        createdAt: createdAuditRequest?.created_at ?? new Date().toISOString(),
        exportId: dataExportId,
        generationWarnings: generationWarningCount,
      },
    }, 200, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return jsonResponse({ error: 'We could not submit your data request right now. Please try again.' }, 500, cors)
  }
})
