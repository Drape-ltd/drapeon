import { randomUUID } from 'node:crypto'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { isLocalSupabaseMfaEnabled } from '../../../../../web/lib/local-supabase-mfa'
import { getOpsSession, hasFreshOpsMfa, type OpsSession } from '../../../../../web/lib/ops-auth'
import { validateOpsMutationOrigin } from '../../../../../web/lib/ops-request-security'
import { createServiceRoleClient } from '../../../../../web/lib/server-supabase'
import { getSupabaseServiceRoleKey } from '../../../../../web/lib/supabase-config'
import { validateServiceRoleTarget } from '../../../../../web/lib/supabase-environment'
import { isRestrictedOpsPhoneHeaders } from '../../../../lib/client-surface'
import { resolveOpsBrokerResponse } from '../../../../lib/ops-broker-response.mjs'

export const dynamic = 'force-dynamic'

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
}

type TrustDecisionBody = {
  issueId?: unknown
  profileId?: unknown
  tailorUserId?: unknown
  decision?: unknown
  reason?: unknown
  rejectionCode?: unknown
  expectedRecordVersion?: unknown
  idempotencyKey?: unknown
  correlationId?: unknown
}

function text(value: unknown, maxLength = 1_000) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null
}

async function completeLocalReceipt(input: {
  receiptId: string
  principalId: string
  outcome: 'SUCCEEDED' | 'FAILED'
  humanStatus: string
  sideEffects?: unknown[]
  blockers?: unknown[]
  nextAction?: string | null
  failureCode?: string | null
}) {
  const client = createServiceRoleClient()
  if (!client) throw new Error('Local trust client is unavailable.')
  const { data, error } = await client.rpc('complete_ops_action_receipt', {
    p_receipt_id: input.receiptId,
    p_actor_principal_id: input.principalId,
    p_outcome: input.outcome,
    p_human_status: input.humanStatus,
    p_side_effects: input.sideEffects ?? [],
    p_blockers: input.blockers ?? [],
    p_next_action: input.nextAction ?? null,
    p_failure_code: input.failureCode ?? null,
  })
  if (error) throw new Error(`Could not complete local trust receipt: ${error.message}`)
  return data
}

async function runLocalSupabaseMfaDecision(
  session: OpsSession,
  body: TrustDecisionBody,
  correlationId: string
) {
  if (
    !isLocalSupabaseMfaEnabled() ||
    session.mode !== 'local-supabase-mfa' ||
    !session.authUserId ||
    !session.principalId
  ) {
    return json({ error: 'named-cloudflare-workforce-session-required', correlationId }, 401)
  }

  const issueId = text(body.issueId, 180)
  const profileId = text(body.profileId, 180)
  const tailorUserId = text(body.tailorUserId, 180)
  const decision = text(body.decision, 20)?.toUpperCase() ?? null
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  const rejectionCode =
    typeof body.rejectionCode === 'string' ? body.rejectionCode.trim().toUpperCase() : ''
  const idempotencyKey = text(body.idempotencyKey, 180)
  const requestCorrelationId = text(body.correlationId, 180) ?? correlationId
  const expectedRecordVersion =
    typeof body.expectedRecordVersion === 'number' &&
    Number.isSafeInteger(body.expectedRecordVersion)
      ? body.expectedRecordVersion
      : null
  if (
    !issueId ||
    !profileId ||
    !tailorUserId ||
    !decision ||
    !idempotencyKey ||
    !expectedRecordVersion ||
    !['APPROVE', 'REJECT'].includes(decision)
  ) {
    return json(
      {
        error: 'Case, profile, tailor, decision, version, and idempotency key are required.',
        correlationId,
      },
      400
    )
  }

  const client = createServiceRoleClient()
  if (!client) return json({ error: 'ops-broker-unavailable', correlationId }, 503)
  const [
    { data: devEnvironment, error: environmentError },
    { data: principal, error: principalError },
  ] = await Promise.all([
    client.rpc('is_dev_ops_mfa_environment'),
    client
      .from('ops_workforce_principals')
      .select('id,email,auth_user_id,status,roles,permitted_environments,access_review_due_at')
      .eq('id', session.principalId)
      .eq('auth_user_id', session.authUserId)
      .maybeSingle(),
  ])
  const roles = Array.isArray(principal?.roles)
    ? principal.roles.map((role: unknown) => String(role).toLowerCase())
    : []
  const environments = Array.isArray(principal?.permitted_environments)
    ? principal.permitted_environments.map((environment: unknown) =>
        String(environment).toLowerCase()
      )
    : []
  if (environmentError || devEnvironment !== true) {
    return json({ error: 'local-supabase-mfa-disabled', correlationId }, 403)
  }
  if (
    principalError ||
    !principal ||
    principal.status !== 'ACTIVE' ||
    !roles.some((role: string) => role === 'admin' || role === 'trust') ||
    !environments.includes('development') ||
    !principal.access_review_due_at ||
    new Date(principal.access_review_due_at).getTime() <= Date.now()
  ) {
    return json({ error: 'workforce-principal-unavailable-or-revoked', correlationId }, 403)
  }

  const { data: prepared, error: prepareError } = await client.rpc(
    'prepare_ops_trust_verification_decision',
    {
      p_issue_id: issueId,
      p_profile_id: profileId,
      p_tailor_user_id: tailorUserId,
      p_decision: decision,
      p_reason: reason,
      p_rejection_code: rejectionCode || null,
      p_expected_record_version: expectedRecordVersion,
      p_idempotency_key: idempotencyKey,
      p_actor_principal_id: principal.id,
      p_actor_label: principal.email,
      p_environment: 'DEVELOPMENT',
      p_sensitive_assurance: true,
      p_correlation_id: requestCorrelationId,
    }
  )
  if (prepareError) {
    const conflict = prepareError.code === '40001'
    return json(
      {
        error: conflict ? 'This case changed. Reload it before deciding.' : prepareError.message,
        code: prepareError.code,
        correlationId,
      },
      conflict ? 409 : 400
    )
  }
  const preflight = prepared as {
    duplicate?: boolean
    receiptId?: string
    receiptOutcome?: string
    correlationId?: string
  }
  if (preflight.duplicate) {
    if (preflight.receiptOutcome !== 'SUCCEEDED') {
      return json(
        {
          error:
            'The prior trust-decision attempt did not complete successfully. Reload the current case before retrying.',
          receipt: preflight,
          correlationId,
        },
        409
      )
    }
    return json(
      {
        ok: true,
        duplicate: true,
        receipt: preflight,
        warning:
          'Decision was already saved. Review the current case and receipt for follow-up status.',
        correlationId,
      },
      207
    )
  }
  if (!preflight.receiptId)
    return json({ error: 'Trust preflight did not return a receipt.', correlationId }, 500)

  const { data: outcome, error: decisionError } = await client.functions.invoke(
    'handle-verification-decision',
    {
      body: {
        tailorUserId,
        decision,
        reason: reason || null,
        rejectionCode: rejectionCode || null,
        performedBy: principal.email,
        performedRole: roles.join(','),
      },
    }
  )
  const decisionOutcome =
    outcome && typeof outcome === 'object' ? (outcome as Record<string, unknown>) : {}
  if (decisionError || decisionOutcome.ok !== true) {
    const failureCode = String(
      decisionOutcome.error ?? decisionError?.message ?? 'VERIFICATION_DECISION_FAILED'
    )
    const receipt = await completeLocalReceipt({
      receiptId: preflight.receiptId,
      principalId: principal.id,
      outcome: 'FAILED',
      humanStatus: 'The protected trust decision did not reach an authoritative domain outcome.',
      sideEffects: [{ type: 'VERIFICATION_DECISION', status: 'FAILED' }],
      blockers: [{ code: failureCode }],
      nextAction: 'Reread the case and retry only after correcting the recorded failure.',
      failureCode,
    })
    return json(
      {
        error: decisionOutcome.message ?? decisionOutcome.error ?? 'Trust decision failed.',
        receipt,
        correlationId,
      },
      502
    )
  }

  const emailSent = decisionOutcome.emailSent === true
  const pushStatus =
    typeof decisionOutcome.pushStatus === 'string' ? decisionOutcome.pushStatus : null
  const caseResolved = decisionOutcome.caseResolved === true
  const completionNeedsAttention = !caseResolved || !emailSent || pushStatus === 'ERROR'
  const receipt = await completeLocalReceipt({
    receiptId: preflight.receiptId,
    principalId: principal.id,
    outcome: 'SUCCEEDED',
    humanStatus: completionNeedsAttention
      ? 'Trust decision persisted; one or more case or notification outcomes need review.'
      : 'Trust decision persisted, the case closed, and notification outcomes were recorded.',
    sideEffects: [
      { type: 'VERIFICATION_DECISION', status: 'COMPLETED', decision, profileId },
      { type: 'OPS_CASE', status: caseResolved ? 'RESOLVED' : 'FAILED' },
      { type: 'EMAIL', status: emailSent ? 'SENT' : 'FAILED' },
      { type: 'PUSH', status: pushStatus ?? 'UNKNOWN' },
    ],
    blockers: completionNeedsAttention
      ? [
          {
            code: !caseResolved
              ? 'CASE_RESOLUTION_NEEDS_ATTENTION'
              : 'COMMUNICATION_OUTCOME_NEEDS_ATTENTION',
          },
        ]
      : [],
    nextAction: completionNeedsAttention
      ? 'Reconcile the recorded side effect without repeating the trust decision.'
      : null,
    failureCode: completionNeedsAttention
      ? !caseResolved
        ? 'CASE_RESOLUTION_NEEDS_ATTENTION'
        : 'COMMUNICATION_OUTCOME_NEEDS_ATTENTION'
      : null,
  })
  return json(
    {
      ok: true,
      receipt,
      decision: decisionOutcome,
      warning: completionNeedsAttention
        ? 'Decision saved; case or notification follow-up is required.'
        : undefined,
      correlationId,
    },
    completionNeedsAttention ? 207 : 200
  )
}

export async function POST(request: Request) {
  if (!validateOpsMutationOrigin(request).ok) return json({ error: 'invalid-origin' }, 403)
  if (isRestrictedOpsPhoneHeaders(request.headers))
    return json({ error: 'desktop-only-action' }, 403)

  const session = await getOpsSession()
  if (
    !session?.allowed ||
    !session.email ||
    !session.principalId ||
    !['cloudflare-access', 'local-supabase-mfa'].includes(session.mode)
  ) {
    return json({ error: 'named-cloudflare-workforce-session-required' }, 401)
  }
  if (!hasFreshOpsMfa(session)) return json({ error: 'protected-access-required' }, 401)

  const body = (await request.json().catch(() => null)) as TrustDecisionBody | null
  const decision = typeof body?.decision === 'string' ? body.decision.trim().toUpperCase() : ''
  if (!['APPROVE', 'REJECT'].includes(decision)) return json({ error: 'invalid-decision' }, 400)

  const correlationId = request.headers.get('x-correlation-id')?.trim() || randomUUID()
  if (session.mode === 'local-supabase-mfa') {
    return runLocalSupabaseMfaDecision(session, body ?? {}, correlationId)
  }

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? process.env.SUPABASE_URL?.trim()
  const serviceRoleKey = getSupabaseServiceRoleKey()
  const serviceRoleTarget = validateServiceRoleTarget(
    supabaseUrl,
    serviceRoleKey,
    process.env.SUPABASE_SERVICE_ROLE_PROJECT_REF
  )
  if (!supabaseUrl || !serviceRoleKey || !serviceRoleTarget.isValid) {
    return json({ error: 'ops-broker-unavailable' }, 503)
  }

  const headerStore = await headers()
  const assertion = headerStore.get('cf-access-jwt-assertion')?.trim()
  if (!assertion) return json({ error: 'cloudflare-access-assertion-required' }, 401)
  const brokerCorrelationId = headerStore.get('x-correlation-id')?.trim() || correlationId

  const result = await resolveOpsBrokerResponse(
    () =>
      fetch(`${supabaseUrl.replace(/\/+$/u, '')}/functions/v1/ops-trust-action`, {
        method: 'POST',
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
          'x-correlation-id': brokerCorrelationId,
          'x-drape-ops-access-assertion': assertion,
        },
        body: JSON.stringify(body),
        cache: 'no-store',
      }),
    brokerCorrelationId
  )
  return json(result.payload as Record<string, unknown>, result.status)
}
