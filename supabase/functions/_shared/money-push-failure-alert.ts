import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createOrRefreshOpsIssue } from './ops-issues.ts'

type Row = Record<string, unknown>
type IssueWriter = typeof createOrRefreshOpsIssue

function record(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function isMoneyPushPayload(payload: unknown): boolean {
  const notification = record(record(payload).notification)
  const communication = record(notification.communication)
  const data = record(notification.data)
  const category = text(communication.category).toUpperCase()
  const preference = text(notification.preferenceKey)
  const kind = text(data.type)
  if (kind === 'payout_readiness_reminder') return false
  return category === 'PAYMENT' || category === 'PAYOUT' ||
    preference === 'paymentConfirmations' || preference === 'paymentReleased' ||
    kind === 'refund_completed' || kind === 'refund_failed' ||
    kind === 'order_cancellation_refund_completed'
}

/** Report only a durable, terminal money-push failure. Multiple device errors
 * may still leave the job ACCEPTED, so callers must never alert per attempt. */
export async function reportDeadMoneyPushOutcomes(
  supabase: SupabaseClient,
  jobIds: string[],
  source: string,
  writeIssue: IssueWriter = createOrRefreshOpsIssue,
) {
  const ids = [...new Set(jobIds.filter(Boolean))]
  if (ids.length === 0) return 0
  let reported = 0
  // The receipt worker can reconcile 500 devices in one run. Keep each
  // PostgREST filter bounded even if every device fails at once.
  for (let offset = 0; offset < ids.length; offset += 100) {
    reported += await reportChunk(supabase, ids.slice(offset, offset + 100), source, writeIssue)
  }
  return reported
}

async function reportChunk(
  supabase: SupabaseClient,
  ids: string[],
  source: string,
  writeIssue: IssueWriter,
) {
  const { data: outcomes, error: outcomeError } = await supabase
    .from('notification_delivery_outcomes')
    .select('job_id,status,channel,order_id')
    .in('job_id', ids)
  if (outcomeError) throw new Error(`money-push-outcome-read-failed:${outcomeError.code ?? 'UNKNOWN'}`)
  const dead = (outcomes ?? []).filter((row) => row.channel === 'PUSH' && row.status === 'DEAD')
  if (dead.length === 0) return 0

  const { data: jobs, error: jobError } = await supabase
    .from('job_queue')
    .select('id,job_type,payload')
    .in('id', dead.map((row) => row.job_id))
  if (jobError) throw new Error(`money-push-job-read-failed:${jobError.code ?? 'UNKNOWN'}`)
  const jobsById = new Map((jobs ?? []).map((job) => [job.id, job]))
  let reported = 0
  for (const outcome of dead) {
    const jobId = outcome.job_id
    const job = jobsById.get(jobId)
    if (job?.job_type !== 'SEND_PUSH' || !isMoneyPushPayload(job.payload)) continue

    const notification = record(record(job.payload).notification)
    const orderId = text(outcome.order_id) || text(record(job.payload).orderId) ||
      text(record(notification.data).orderId)
    const issue = await writeIssue(supabase, {
      issueType: 'SYSTEM_ALERT',
      severity: 'HIGH',
      source,
      orderId: orderId || null,
      relatedEntityType: 'NOTIFICATION_JOB',
      relatedEntityId: jobId,
      provider: 'EXPO',
      stage: 'MONEY_PUSH_DELIVERY',
      title: 'Money-event push failed',
      description: 'A payment, refund, or payout notification reached a failed delivery outcome.',
      recommendedAction: 'Inspect the linked notification job and order, correct the delivery fault, and use the reviewed resend path if needed.',
      dedupeKey: `money-push-delivery-dead:${jobId}`,
      metadata: { notification_job_id: jobId },
      queueKey: 'reliability',
      notifyOps: true,
      persistWhenRoutineDisabled: true,
      skipIfUnchanged: true,
    })
    if (!issue) throw new Error(`money-push-issue-persist-failed:${jobId}`)
    reported += 1
  }
  return reported
}
