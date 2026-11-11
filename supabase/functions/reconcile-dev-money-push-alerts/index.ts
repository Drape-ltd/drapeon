import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeCronRequest } from '../_shared/cron.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import {
  HISTORICAL_MONEY_PUSH_SOURCE,
  reconcileDevHistoricalMoneyPushes,
  type HistoricalRecoveryPort,
} from '../_shared/dev-historical-money-push-recovery.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { isMoneyPushPayload, reportDeadMoneyPushOutcomes } from '../_shared/money-push-failure-alert.ts'
import { sendCriticalOpsIssueNotification } from '../_shared/ops-notifications.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'

const FN = 'reconcile-dev-money-push-alerts'
const NOTICE_ACTION = 'HISTORICAL_MONEY_PUSH_NOTICE_ACCEPTED'
const TITLE = 'Money-event push failed'
const DESCRIPTION = 'A payment, refund, or payout notification reached a failed delivery outcome.'
const NEXT_ACTION =
  'Inspect the linked notification job and order, correct the delivery fault, and use the reviewed resend path if needed.'

function response(status: number, body: unknown, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

Deno.serve(async (request) => {
  const cors = getCorsHeaders(request)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const unauthorized = await authorizeCronRequest(request, FN, cors)
  if (unauthorized) return unauthorized
  if (request.method !== 'POST') return response(405, { ok: false, code: 'METHOD_NOT_ALLOWED' }, cors)

  const url = getSupabaseUrl()
  if (new URL(url).hostname !== 'pqptfuqogvrajozfsqzi.supabase.co') {
    return response(403, { ok: false, code: 'DEV_PROJECT_REQUIRED' }, cors)
  }
  if (
    !Deno.env.get('RESEND_API_KEY') ||
    (!Deno.env.get('OPS_NOTIFICATION_EMAILS') && !Deno.env.get('OPS_EMAIL'))
  ) {
    return response(503, { ok: false, code: 'OPS_NOTICE_NOT_CONFIGURED' }, cors)
  }
  const client = createClient(url, getServiceRoleKey())
  const environment = await client.rpc('current_ops_environment')
  if (environment.error || environment.data !== 'DEVELOPMENT') {
    return response(403, { ok: false, code: 'DEV_ENVIRONMENT_REQUIRED' }, cors)
  }

  const port: HistoricalRecoveryPort = {
    async targetIds() {
      const jobs = await client.from('job_queue')
        .select('id,payload')
        .eq('job_type', 'SEND_PUSH')
        .eq('status', 'SUCCEEDED')
        .gte('created_at', '2026-11-04T00:00:00Z')
        .lt('created_at', '2026-11-11T00:00:00Z')
        .limit(1000)
      if (jobs.error || !jobs.data || jobs.data.length === 1000) throw new Error('HISTORICAL_JOB_READ_FAILED')
      const candidates = jobs.data.filter((job) => isMoneyPushPayload(job.payload)).map((job) => job.id)
      if (candidates.length === 0) return []
      const outcomes = await client.from('notification_delivery_outcomes')
        .select('job_id,channel,status').in('job_id', candidates)
      if (outcomes.error) throw new Error('HISTORICAL_OUTCOME_READ_FAILED')
      const dead = new Set((outcomes.data ?? []).filter((row) =>
        row.channel === 'PUSH' && row.status === 'DEAD'
      ).map((row) => row.job_id))
      return candidates.filter((id) => dead.has(id))
    },
    async cases(ids) {
      const keys = ids.map((id) => `money-push-delivery-dead:${id}`)
      const result = await client.from('ops_issues')
        .select('id,source,related_entity_id,issue_number,order_id').in('dedupe_key', keys)
      if (result.error) throw new Error('HISTORICAL_CASE_READ_FAILED')
      return (result.data ?? []).map((issue) => ({
        id: issue.id,
        source: issue.source,
        relatedEntityId: issue.related_entity_id,
        issueNumber: issue.issue_number,
        orderId: issue.order_id,
      }))
    },
    async createMissingCases(ids) {
      const created = await reportDeadMoneyPushOutcomes(
        client,
        ids,
        HISTORICAL_MONEY_PUSH_SOURCE,
        (db, input) => createOrRefreshOpsIssue(db, { ...input, notifyOps: false }),
      )
      if (created !== 7) throw new Error('HISTORICAL_CASE_WRITE_COUNT_CHANGED')
    },
    async acceptedNotices(caseIds) {
      const result = await client.from('ops_audit_logs')
        .select('issue_id').eq('action_taken', NOTICE_ACTION).in('issue_id', caseIds)
      if (result.error) throw new Error('HISTORICAL_NOTICE_AUDIT_READ_FAILED')
      return (result.data ?? []).map((row) => row.issue_id)
    },
    async sendNotice(issue) {
      const result = await sendCriticalOpsIssueNotification({
        issueNumber: issue.issueNumber,
        issueType: 'SYSTEM_ALERT',
        severity: 'HIGH',
        title: TITLE,
        description: DESCRIPTION,
        recommendedAction: NEXT_ACTION,
        source: HISTORICAL_MONEY_PUSH_SOURCE,
        orderId: issue.orderId,
        relatedEntityType: 'NOTIFICATION_JOB',
        relatedEntityId: issue.relatedEntityId,
        provider: 'EXPO',
        stage: 'MONEY_PUSH_DELIVERY',
        idempotencyKey: `historical-money-push:${issue.relatedEntityId}`,
      })
      return {
        ok: result.ok && Boolean(result.providerReference),
        providerReference: result.ok ? result.providerReference : null,
      }
    },
    async recordNotice(notice) {
      const result = await client.from('ops_audit_logs').insert({
        issue_id: notice.caseId,
        action_taken: NOTICE_ACTION,
        performed_role: 'SYSTEM',
        reason: 'Dev historical money-push Ops email accepted by provider.',
        before_state: null,
        after_state: { provider: 'RESEND', providerReference: notice.providerReference },
      })
      if (result.error) throw new Error('HISTORICAL_NOTICE_AUDIT_WRITE_FAILED')
    },
  }

  try {
    const result = await reconcileDevHistoricalMoneyPushes(port)
    return response(200, { ok: true, ...result }, cors)
  } catch (error) {
    const code = error instanceof Error ? error.message : 'HISTORICAL_RECONCILIATION_FAILED'
    console.error(FN, code)
    return response(409, { ok: false, code }, cors)
  }
})
