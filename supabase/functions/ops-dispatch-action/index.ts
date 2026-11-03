import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { DispatchCommandError, executeOpsDispatchCommand } from '../_shared/ops-dispatch-execution.ts'
import { verifyCloudflareOpsAccess } from '../_shared/ops-access.ts'
import { isActiveOpsReadPrincipal } from '../_shared/ops-read-policy.ts'

const list = (value: string | undefined) => (value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)
const json = (body: Record<string, unknown>, status: number, cors: HeadersInit) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } })

Deno.serve(async (request) => {
  const cors = getCorsHeaders(request)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ ok: false, error: 'method-not-allowed' }, 405, cors)
  const correlationId = request.headers.get('x-correlation-id')?.trim() || crypto.randomUUID()
  try {
    const identity = await verifyCloudflareOpsAccess(request.headers.get('x-drape-ops-access-assertion')?.trim() ?? '', {
      teamDomain: Deno.env.get('CF_ACCESS_TEAM_DOMAIN') ?? '', normalAudiences: list(Deno.env.get('CF_ACCESS_AUD')),
      sensitiveAudiences: list(Deno.env.get('CF_ACCESS_SENSITIVE_AUD')), requireSensitive: true,
      allowedEmailDomain: Deno.env.get('OPS_ALLOWED_EMAIL_DOMAIN') ?? 'drapeon.co', allowedEmails: list(Deno.env.get('OPS_ALLOWED_EMAILS')),
    })
    if (!identity?.sensitiveAssurance) return json({ ok: false, error: 'fresh-workforce-assurance-required', correlationId }, 401, cors)
    const client: SupabaseClient = createClient(getSupabaseUrl(), getServiceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } })
    const principalResult = await client.from('ops_workforce_principals').select('id,email,roles,status,permitted_environments,access_subject,session_revoked_before,access_review_due_at').eq('email', identity.email).maybeSingle()
    const principal = principalResult.data
    const environment = (Deno.env.get('DRAPE_OPS_ENV') ?? '').trim().toLowerCase()
    const roles = Array.isArray(principal?.roles) ? principal.roles.map(String) : []
    if (principalResult.error || !principal || !roles.some((role) => role === 'admin' || role === 'ops') || !isActiveOpsReadPrincipal({
      status: String(principal.status), accessSubject: typeof principal.access_subject === 'string' ? principal.access_subject : null,
      permittedEnvironments: Array.isArray(principal.permitted_environments) ? principal.permitted_environments.map(String) : [],
      sessionRevokedBefore: typeof principal.session_revoked_before === 'string' ? principal.session_revoked_before : null,
      accessReviewDueAt: typeof principal.access_review_due_at === 'string' ? principal.access_review_due_at : null,
      assertedSubject: identity.subject, assertionIssuedAt: identity.issuedAt,
      environment: environment.toUpperCase() as 'DEVELOPMENT' | 'PRODUCTION',
    })) {
      return json({ ok: false, error: 'workforce-principal-unavailable', correlationId }, 403, cors)
    }
    const result = await executeOpsDispatchCommand(client, { principalId: principal.id, label: identity.email, role: roles.includes('admin') ? 'admin' : 'ops' }, await request.formData())
    return json({ ...result, correlationId }, 200, cors)
  } catch (error) {
    if (error instanceof DispatchCommandError) return json({ ok: false, error: error.code, message: error.message, correlationId }, error.status, cors)
    return json({ ok: false, error: 'dispatch-command-failed', correlationId }, 500, cors)
  }
})
