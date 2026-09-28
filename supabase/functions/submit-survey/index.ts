import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  getSurveyDefinition,
  isNegativeSurveyResponse,
  sanitizeSurveyResponse,
  surveyIdempotencyKey,
} from '../../../packages/shared/src/lifecycle-surveys.ts'
import { enqueueDomainEvent } from '../_shared/jobs.ts'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { parseBody, z } from '../_shared/validate.ts'
import { validateSubject, hasActiveIncident, hasActiveDispute, hasUnresolvedSupportCase, scoreBucket, surveyInviteAvailability } from './policy.ts'

const FN = 'submit-survey'
const SURVEY_KINDS = [
  'CUSTOMER_POST_COMPLETION_CSAT',
  'SUPPORT_RESOLUTION_CSAT',
  'TAILOR_FIRST_ORDER_CSAT',
  'ONBOARDING_PULSE',
] as const
const SUBJECT_TYPES = ['ORDER', 'SUPPORT_CASE', 'ACCOUNT'] as const
const CHANNELS = ['WEB', 'IOS', 'ANDROID', 'EMAIL'] as const

const BodySchema = z.object({
  kind: z.enum(SURVEY_KINDS),
  subjectType: z.enum(SUBJECT_TYPES),
  subjectId: z.string().trim().min(1).max(120),
  channel: z.enum(CHANNELS).default('WEB'),
  score: z.number().int().min(1).max(5),
  tags: z.array(z.string().trim().min(1).max(50)).max(8).optional(),
  comment: z.string().trim().max(1000).nullable().optional(),
})

function jsonResponse(body: Record<string, unknown>, status: number, cors: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const caller = await getAuthUser(req)
    if (!caller)
      return jsonResponse(
        { code: 'UNAUTHORIZED', error: 'Please sign in again before sending feedback.' },
        401,
        cors
      )

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok)
      return jsonResponse({ code: 'VALIDATION_ERROR', error: parsed.error }, 400, cors)

    const body = parsed.data
    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    if (!(await checkRateLimit(supabase, `${FN}:${caller.id}`, 3600, 10))) {
      return rateLimitExceededResponse(cors)
    }

    const userResult = await supabase.from('users').select('role').eq('id', caller.id).maybeSingle()
    if (userResult.error) throw userResult.error
    const role = (userResult.data as { role: 'CUSTOMER' | 'TAILOR' } | null)?.role
    if (!role)
      return jsonResponse(
        { code: 'PROFILE_NOT_READY', error: 'Your account is not ready to receive feedback yet.' },
        409,
        cors
      )

    const definition = getSurveyDefinition(body.kind)
    if (!definition.allowedRoles.includes(role)) {
      return jsonResponse(
        { code: 'ROLE_NOT_ELIGIBLE', error: 'This survey is not available for this account.' },
        403,
        cors
      )
    }

    const subject = await validateSubject(
      supabase,
      caller.id,
      role,
      body.kind,
      body.subjectType,
      body.subjectId
    )
    if (!subject.ok)
      return jsonResponse({ code: subject.code, error: subject.message }, subject.status, cors)

    // Canonical subjects prevent aliases from creating a second response.
    body.subjectId = String(subject.order?.id ?? subject.supportCase?.id ?? caller.id)
    const idempotencyKey = surveyIdempotencyKey(caller.id, body.subjectId, body.kind)
    const existing = await supabase.from('survey_responses').select('id')
      .eq('user_id', caller.id).eq('idempotency_key', idempotencyKey).maybeSingle()
    if (existing.error) throw existing.error
    if (existing.data) {
      return jsonResponse({ ok: true, responseId: String(existing.data.id), deduplicated: true }, 200, cors)
    }
    const invite = await supabase.from('survey_invites')
      .select('status, available_at, expires_at')
      .eq('user_id', caller.id).eq('kind', body.kind).eq('version', definition.version)
      .eq('subject_type', body.subjectType).eq('subject_id', body.subjectId).maybeSingle()
    if (invite.error) throw invite.error
    const availability = surveyInviteAvailability(invite.data)
    if (!availability.ok) {
      return jsonResponse({ code: availability.code, error: availability.message }, 409, cors)
    }

    if (
      definition.suppressedWhen.includes('active_incident') &&
      (await hasActiveIncident(supabase))
    ) {
      return jsonResponse(
        {
          code: 'SURVEY_SUPPRESSED',
          reason: 'active_incident',
          error: 'Feedback is paused while Drapeon resolves an active incident.',
        },
        409,
        cors
      )
    }
    if (
      definition.suppressedWhen.includes('active_dispute') &&
      subject.order &&
      (await hasActiveDispute(supabase, subject.order.id))
    ) {
      return jsonResponse(
        {
          code: 'SURVEY_SUPPRESSED',
          reason: 'active_dispute',
          error: 'Feedback opens after the order concern is resolved.',
        },
        409,
        cors
      )
    }
    if (
      definition.suppressedWhen.includes('unresolved_support_case') &&
      (await hasUnresolvedSupportCase(supabase, caller.id))
    ) {
      return jsonResponse(
        {
          code: 'SURVEY_SUPPRESSED',
          reason: 'unresolved_support_case',
          error: 'Feedback opens after your open support request is resolved.',
        },
        409,
        cors
      )
    }

    const sanitized = sanitizeSurveyResponse(body.kind, body)
    if (!sanitized)
      return jsonResponse(
        { code: 'VALIDATION_ERROR', error: 'Choose a score from 1 to 5.' },
        400,
        cors
      )
    const insert = await supabase
      .from('survey_responses')
      .insert({
        user_id: caller.id,
        kind: body.kind,
        version: definition.version,
        subject_type: body.subjectType,
        subject_id: body.subjectId,
        role,
        channel: body.channel,
        score: sanitized.score,
        tags: sanitized.tags,
        comment: sanitized.comment,
        idempotency_key: idempotencyKey,
      })
      .select('id')
      .single()
    if (insert.error) {
      if (insert.error.code === '23505') {
        const receipt = await supabase.from('survey_responses').select('id')
          .eq('user_id', caller.id).eq('idempotency_key', idempotencyKey).maybeSingle()
        if (receipt.error) throw receipt.error
        if (receipt.data) return jsonResponse({ ok: true, responseId: String(receipt.data.id), deduplicated: true }, 200, cors)
        throw insert.error
      }
      throw insert.error
    }

    const responseId = String(insert.data.id)
    const inviteCompletion = await supabase
      .from('survey_invites')
      .update({
        status: 'COMPLETED',
        completed_at: new Date().toISOString(),
        survey_response_id: responseId,
        suppressed_at: null,
        suppressed_reason: null,
      })
      .eq('user_id', caller.id)
      .eq('kind', body.kind)
      .eq('version', definition.version)
      .eq('subject_type', body.subjectType)
      .eq('subject_id', body.subjectId)
      .in('status', ['PENDING', 'SENT'])
      .select('id')
      .maybeSingle()
    if (inviteCompletion.error) {
      log('warn', FN, 'invite.complete_failed', {
        response_id: responseId,
        error: inviteCompletion.error.message,
      })
    }

    const eventPayload = {
      survey_id: body.kind,
      survey_version: definition.version,
      subject_kind: body.subjectType,
      score_bucket: scoreBucket(sanitized.score),
      issue_tag_count: sanitized.tags.length,
    }
    try {
      await enqueueDomainEvent(supabase, {
        eventType: 'survey_submitted',
        aggregateType: 'survey_response',
        aggregateId: responseId,
        idempotencyKey: `survey-event:${idempotencyKey}`,
        actorId: caller.id,
        actorRole: 'SYSTEM',
        orderId: subject.order?.id ?? null,
        payload: eventPayload,
        metadata: { source: FN, contract_version: 1 },
        jobs: [],
      })
    } catch (error) {
      log('error', FN, 'event.enqueue_failed', {
        response_id: responseId,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    if (isNegativeSurveyResponse(body.kind, sanitized.score)) {
      const issue = await createOrRefreshOpsIssue(supabase, {
        issueType: subject.order ? 'ORDER_REVIEW' : 'SYSTEM_ALERT',
        severity: 'MEDIUM',
        source: FN,
        actorId: caller.id,
        actorRole: role,
        orderId: subject.order?.id ?? null,
        userId: caller.id,
        tailorProfileId: subject.order?.tailor_profile_id ?? null,
        relatedEntityType: 'survey_response',
        relatedEntityId: responseId,
        stage: subject.order?.stage ?? null,
        title: 'Feedback needs a follow-up',
        description: `${body.kind} received a ${sanitized.score}/5 response${sanitized.tags.length > 0 ? ` tagged ${sanitized.tags.join(', ')}` : ''}. Review the private response before replying.`,
        recommendedAction:
          'Review the private survey response and contact the respondent through Drapeon support. Do not expose survey comments to analytics.',
        dedupeKey: `survey-negative:${idempotencyKey}`,
        metadata: {
          survey_kind: body.kind,
          survey_response_id: responseId,
          score: sanitized.score,
          tags: sanitized.tags,
          subject_type: body.subjectType,
        },
        queueKey: 'support',
        persistWhenRoutineDisabled: true,
      })
      if (!issue) {
        log('error', FN, 'negative_feedback.route_failed', {
          response_id: responseId,
          survey_kind: body.kind,
        })
      } else {
        const link = await supabase
          .from('survey_responses')
          .update({ ops_issue_id: issue.id })
          .eq('id', responseId)
        if (link.error) {
          log('error', FN, 'negative_feedback.link_failed', {
            response_id: responseId,
            issue_id: issue.id,
            error: link.error.message,
          })
        }
      }
    }

    await audit(supabase, {
      event: 'survey.submitted',
      actor_id: caller.id,
      actor_role: role,
      order_id: subject.order?.id ?? null,
      payload: {
        function: FN,
        response_id: responseId,
        ...eventPayload,
        negative: isNegativeSurveyResponse(body.kind, sanitized.score),
      },
    })

    return jsonResponse({ ok: true, responseId }, 201, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return jsonResponse(
      { code: 'SERVER_ERROR', error: 'Feedback could not be saved right now. Please try again.' },
      500,
      getCorsHeaders(req)
    )
  }
})
