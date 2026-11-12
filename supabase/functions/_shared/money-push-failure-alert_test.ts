import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  isMoneyPushPayload,
  reportDeadMoneyPushOutcomes,
} from './money-push-failure-alert.ts'

const orderId = 'd85ef468-a380-4aad-ad38-3b420c6daa60'

function client(
  outcomes: Array<Record<string, unknown>>,
  jobs: Array<Record<string, unknown>>,
) {
  const reads: Array<{ table: string; ids: string[] }> = []
  const supabase = {
    from(table: string) {
      return {
        select() {
          return {
            in(_column: string, ids: string[]) {
              reads.push({ table, ids })
              return Promise.resolve({
                data: (table === 'notification_delivery_outcomes' ? outcomes : jobs)
                  .filter((row) => ids.includes(String(table === 'notification_delivery_outcomes' ? row.job_id : row.id))),
                error: null,
              })
            },
          }
        },
      }
    },
  } as unknown as SupabaseClient
  return { supabase, reads }
}

function job(id: string, notification: Record<string, unknown>) {
  return { id, job_type: 'SEND_PUSH', payload: { orderId, notification } }
}

Deno.test('money push classification includes refund messages under orderUpdates', () => {
  assertEquals(isMoneyPushPayload({ notification: {
    preferenceKey: 'orderUpdates', data: { type: 'refund_completed' },
  } }), true)
  assertEquals(isMoneyPushPayload({ notification: {
    preferenceKey: 'orderUpdates', data: { type: 'order_cancellation_refund_completed' },
  } }), true)
  assertEquals(isMoneyPushPayload({ notification: {
    preferenceKey: 'paymentConfirmations',
  } }), true)
  assertEquals(isMoneyPushPayload({ notification: {
    communication: { category: 'PAYOUT' },
  } }), true)
  assertEquals(isMoneyPushPayload({ notification: {
    preferenceKey: 'paymentReleased', data: { type: 'payout_readiness_reminder' },
  } }), false)
  assertEquals(isMoneyPushPayload({ notification: {
    preferenceKey: 'orderUpdates', data: { type: 'out_for_delivery' },
  } }), false)
})

Deno.test('terminal money-push failure creates one linked case with the prelaunch switch bypass', async () => {
  const { supabase, reads } = client(
    [{ job_id: 'job-1', channel: 'PUSH', status: 'DEAD', order_id: orderId }],
    [job('job-1', { preferenceKey: 'orderUpdates', data: { type: 'refund_completed' } })],
  )
  const issues: Array<Record<string, unknown>> = []
  const writer = (_client: SupabaseClient, issue: Record<string, unknown>) => {
    issues.push(issue)
    return Promise.resolve({ id: 'case-1', issue_number: 1 })
  }
  assertEquals(await reportDeadMoneyPushOutcomes(supabase, ['job-1', 'job-1'], 'process-push-receipts', writer), 1)
  assertEquals(reads.map((read) => read.ids), [['job-1'], ['job-1']])
  assertEquals(issues[0].dedupeKey, 'money-push-delivery-dead:job-1')
  assertEquals(issues[0].orderId, orderId)
  assertEquals(issues[0].relatedEntityId, 'job-1')
  assertEquals(issues[0].persistWhenRoutineDisabled, true)
  assertEquals(issues[0].skipIfUnchanged, true)
})

Deno.test('one failed device with an accepted job raises no money alert', async () => {
  const { supabase } = client(
    [{ job_id: 'job-1', channel: 'PUSH', status: 'ACCEPTED', order_id: orderId }],
    [job('job-1', { preferenceKey: 'paymentReleased' })],
  )
  let writes = 0
  assertEquals(await reportDeadMoneyPushOutcomes(supabase, ['job-1'], 'process-push-receipts', () => {
    writes += 1
    return Promise.resolve({ id: 'case-1', issue_number: 1 })
  }), 0)
  assertEquals(writes, 0)
})

Deno.test('receipt replay uses the same case key and sends one initial alert', async () => {
  const { supabase } = client(
    [{ job_id: 'job-1', channel: 'PUSH', status: 'DEAD', order_id: orderId }],
    [job('job-1', { preferenceKey: 'paymentReleased' })],
  )
  const keys = new Set<string>()
  let firstAlerts = 0
  const writer = (_client: SupabaseClient, issue: Record<string, unknown>) => {
    const key = String(issue.dedupeKey)
    if (!keys.has(key)) firstAlerts += 1
    keys.add(key)
    return Promise.resolve({ id: 'case-1', issue_number: 1 })
  }
  assertEquals(await reportDeadMoneyPushOutcomes(supabase, ['job-1'], 'process-push-receipts', writer), 1)
  assertEquals(await reportDeadMoneyPushOutcomes(supabase, ['job-1'], 'process-push-receipts', writer), 1)
  assertEquals(keys.size, 1)
  assertEquals(firstAlerts, 1)
})

Deno.test('non-money and missing-job failures raise no money alert', async () => {
  const { supabase } = client(
    [
      { job_id: 'job-1', channel: 'PUSH', status: 'DEAD', order_id: orderId },
      { job_id: 'job-2', channel: 'PUSH', status: 'DEAD', order_id: orderId },
    ],
    [job('job-1', { preferenceKey: 'orderUpdates', data: { type: 'out_for_delivery' } })],
  )
  assertEquals(await reportDeadMoneyPushOutcomes(supabase, ['job-1', 'job-2'], 'process-job-queue', () => {
    throw new Error('unexpected issue')
  }), 0)
})

Deno.test('failed Ops persistence is surfaced to the caller', async () => {
  const { supabase } = client(
    [{ job_id: 'job-1', channel: 'PUSH', status: 'DEAD', order_id: orderId }],
    [job('job-1', { preferenceKey: 'paymentConfirmations' })],
  )
  await assertRejects(
    () => reportDeadMoneyPushOutcomes(supabase, ['job-1'], 'process-job-queue', () => Promise.resolve(null)),
    Error,
    'money-push-issue-persist-failed',
  )
})

Deno.test('a full failed receipt batch uses bounded database filters', async () => {
  const ids = Array.from({ length: 101 }, (_, index) => `job-${index}`)
  const { supabase, reads } = client([], [])
  assertEquals(await reportDeadMoneyPushOutcomes(supabase, ids, 'process-push-receipts'), 0)
  assertEquals(reads.length, 2)
  assertEquals(reads[0].ids.length, 100)
  assertEquals(reads[1].ids.length, 1)
})
