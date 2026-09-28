import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getSurveyDefinition, type SurveyKind, type SurveySubjectType } from '../../../packages/shared/src/lifecycle-surveys.ts'
type CallerRole = 'CUSTOMER' | 'TAILOR'

type UserRow = {
  role: CallerRole
}

type OrderRow = {
  id: string
  reference: string | null
  stage: string
  customer_id: string
  tailor_id: string
  tailor_profile_id: string | null
}

type SupportCaseRow = {
  id: string
  case_number: string
  user_id: string | null
  status: string
  canonical_status: string | null
}

export function scoreBucket(score: number) {
  if (score <= 2) return '1-2'
  if (score === 3) return '3'
  return '4-5'
}

export function surveyInviteAvailability(
  invite: { status: string; available_at: string; expires_at: string } | null,
  now = Date.now(),
) {
  if (!invite || !['PENDING', 'SENT'].includes(invite.status)) {
    return { ok: false as const, code: 'SURVEY_NOT_AVAILABLE', message: 'This feedback invitation is not available.' }
  }
  const available = Date.parse(invite.available_at)
  const expires = Date.parse(invite.expires_at)
  if (!Number.isFinite(available) || !Number.isFinite(expires) || expires <= available || now >= expires) {
    return { ok: false as const, code: 'SURVEY_EXPIRED', message: 'This feedback invitation has expired.' }
  }
  if (now < available) {
    return { ok: false as const, code: 'SURVEY_NOT_READY', message: 'Feedback will open after the invitation waiting period. Please return later.' }
  }
  return { ok: true as const }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
}

type ServiceSupabaseClient = SupabaseClient<any>

export async function hasActiveIncident(supabase: ServiceSupabaseClient) {
  const result = await supabase
    .from('service_incidents')
    .select('id')
    .neq('status', 'RESOLVED')
    .limit(1)
    .maybeSingle()
  if (result.error) throw result.error
  return Boolean(result.data?.id)
}

export async function hasActiveDispute(supabase: ServiceSupabaseClient, orderId: string) {
  const result = await supabase
    .from('disputes')
    .select('id')
    .eq('order_id', orderId)
    .in('status', ['OPEN', 'UNDER_REVIEW'])
    .limit(1)
    .maybeSingle()
  if (result.error) throw result.error
  return Boolean(result.data?.id)
}

export async function hasUnresolvedSupportCase(supabase: ServiceSupabaseClient, userId: string) {
  const result = await supabase
    .from('ops_issues')
    .select('id')
    .eq('user_id', userId)
    .in('status', ['OPEN', 'IN_REVIEW', 'ESCALATED'])
    .limit(1)
    .maybeSingle()
  if (result.error) throw result.error
  return Boolean(result.data?.id)
}

async function findSupportCase(
  supabase: ServiceSupabaseClient,
  subjectId: string
): Promise<SupportCaseRow | null> {
  const query = supabase
    .from('ops_issues')
    .select('id, case_number, user_id, status, canonical_status')

  const result = isUuid(subjectId)
    ? await query.eq('id', subjectId).maybeSingle()
    : await query.eq('case_number', subjectId).maybeSingle()
  if (result.error) throw result.error
  return (result.data as SupportCaseRow | null) ?? null
}

async function hasProviderConfirmedPayout(supabase: ServiceSupabaseClient, orderId: string) {
  const tranches = await supabase
    .from('order_settlement_tranches')
    .select('payout_id')
    .eq('order_id', orderId)
    .eq('status', 'RELEASED')
    .not('payout_id', 'is', null)
    .limit(5)
  if (tranches.error) throw tranches.error

  const payoutIds = (tranches.data ?? [])
    .map((row) => (typeof row.payout_id === 'string' ? row.payout_id : null))
    .filter((value): value is string => Boolean(value))
  if (payoutIds.length === 0) return false

  const payouts = await supabase
    .from('payouts')
    .select('id_text, status, provider_transfer_status, bank_settlement_status')
    .in('id_text', payoutIds)
  if (payouts.error) throw payouts.error

  return (payouts.data ?? []).some((payout) => {
    if (payout.status === 'FAILED' || payout.status === 'REVERSED' || payout.status === 'BLOCKED')
      return false
    if (
      payout.provider_transfer_status === 'FAILED' ||
      payout.provider_transfer_status === 'REVERSED'
    )
      return false
    return (
      payout.status === 'PAID' ||
      payout.provider_transfer_status === 'AVAILABLE_IN_PROVIDER_BALANCE' ||
      payout.provider_transfer_status === 'PAID_TO_BANK' ||
      payout.bank_settlement_status === 'PAID'
    )
  })
}

export async function validateSubject(
  supabase: ServiceSupabaseClient,
  callerId: string,
  role: CallerRole,
  kind: SurveyKind,
  subjectType: SurveySubjectType,
  subjectId: string
) {
  const definition = getSurveyDefinition(kind)
  if (definition.subjectType !== subjectType) {
    return {
      ok: false as const,
      status: 400,
      code: 'SUBJECT_TYPE_MISMATCH',
      message: 'This survey does not apply to that subject.',
    }
  }

  if (subjectType === 'ACCOUNT') {
    if (subjectId !== callerId) {
      return {
        ok: false as const,
        status: 403,
        code: 'FORBIDDEN',
        message: 'You can only give feedback on your own account.',
      }
    }
    return { ok: true as const, order: null, supportCase: null }
  }

  if (subjectType === 'SUPPORT_CASE') {
    const supportCase = await findSupportCase(supabase, subjectId)
    if (!supportCase) {
      return {
        ok: false as const,
        status: 404,
        code: 'SUPPORT_CASE_NOT_FOUND',
        message: 'That support case is not available.',
      }
    }
    if (supportCase.user_id !== callerId) {
      return {
        ok: false as const,
        status: 403,
        code: 'FORBIDDEN',
        message: 'You do not have access to this support case.',
      }
    }
    if (
      !['RESOLVED', 'CLOSED'].includes(supportCase.canonical_status ?? '') &&
      supportCase.status !== 'RESOLVED'
    ) {
      return {
        ok: false as const,
        status: 409,
        code: 'SUPPORT_CASE_NOT_CLOSED',
        message: 'Feedback opens after the support case is resolved.',
      }
    }
    return { ok: true as const, order: null, supportCase }
  }

  const orderResult = await supabase
    .from('orders')
    .select('id, reference, stage, customer_id, tailor_id, tailor_profile_id')
    .eq('id', subjectId)
    .maybeSingle()
  if (orderResult.error) throw orderResult.error
  const order = (orderResult.data as OrderRow | null) ?? null
  if (!order) {
    return {
      ok: false as const,
      status: 404,
      code: 'ORDER_NOT_FOUND',
      message: 'That order is not available.',
    }
  }

  const ownsOrder =
    kind === 'CUSTOMER_POST_COMPLETION_CSAT'
      ? role === 'CUSTOMER' && order.customer_id === callerId
      : role === 'TAILOR' && order.tailor_id === callerId
  if (!ownsOrder) {
    return {
      ok: false as const,
      status: 403,
      code: 'FORBIDDEN',
      message: 'You do not have access to this order survey.',
    }
  }
  if (order.stage !== 'COMPLETE') {
    return {
      ok: false as const,
      status: 409,
      code: 'ORDER_NOT_COMPLETE',
      message: 'Feedback opens after the order is complete.',
    }
  }

  if (kind === 'TAILOR_FIRST_ORDER_CSAT') {
    const firstOrder = await supabase
      .from('orders')
      .select('id')
      .eq('tailor_id', callerId)
      .eq('stage', 'COMPLETE')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (firstOrder.error) throw firstOrder.error
    const firstCompletedId = (firstOrder.data as { id?: string } | null)?.id
    if (
      firstCompletedId !== order.id ||
      !(await hasProviderConfirmedPayout(supabase, order.id))
    ) {
      return {
        ok: false as const,
        status: 409,
        code: 'PAYOUT_NOT_CONFIRMED',
        message: 'Feedback opens after the first completed order and provider-confirmed payout.',
      }
    }
  }

  return { ok: true as const, order, supportCase: null }
}
