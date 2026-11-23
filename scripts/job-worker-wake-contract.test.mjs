import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const worker = read('supabase/functions/process-job-queue/index.ts')
const wake = read('supabase/migrations/20261108224518_orphaned_job_worker_wakeup.sql')
const scheduled = read('supabase/migrations/20260831203000_prelaunch_cron_io_stabilization.sql')
const slack = read('supabase/migrations/20260827101000_event_driven_ops_slack_job_wakeup.sql')
const allowed = worker.match(/const ALLOWED_JOB_TYPES = new Set<JobType>\(\[([\s\S]*?)\]\)/)?.[1]
assert.ok(allowed, 'worker allowed-job declaration changed')
const jobTypes = [...allowed.matchAll(/"([A-Z_]+)"/g)].map((match) => match[1])

// The SQL fixture exercises the new trigger and recovery against PostgreSQL.
// This contract also makes a future worker job type fail the launch gate until
// someone assigns it a real wake lane or documents an explicit exemption.
const lanes = {
  notificationCron: [
    'SEND_PUSH', 'SEND_SMS', 'SEND_ACCOUNT_EVENT_EMAIL',
    'SEND_ORDER_EVENT_EMAIL', 'SEND_ORDER_CONFIRMATION_EMAILS',
    'SEND_OPS_VERIFICATION_EMAIL',
  ],
  opsCron: ['CREATE_OPS_ISSUE'],
  slackTriggerAndRecovery: ['SEND_OPS_SLACK', 'SEND_OPS_SLACK_DIGEST'],
  moneyTriggerAndRecovery: [
    'PROCESS_PAYMENT_WEBHOOK', 'RECONCILE_PAYMENT_WEBHOOK',
    'PROCESS_FABRIC_RELEASE', 'PROCESS_TIP_PAYOUT',
    'PROCESS_DISPATCH_REFUND', 'RECONCILE_DISPATCH_RUN',
    'PROCESS_DELIVERY_WEBHOOK', 'RECONCILE_DELIVERY_WEBHOOK',
    'SEND_COMMUNICATION_CAMPAIGN',
  ],
}
const explicitExemptions = []

test('every allowed worker job has a wake lane or reviewed exemption', () => {
  const covered = new Set([...Object.values(lanes).flat(), ...explicitExemptions])
  assert.deepEqual(jobTypes.filter((type) => !covered.has(type)), [])
  assert.deepEqual([...covered].filter((type) => !jobTypes.includes(type)), [])
})

test('each declared lane appears in the effective scheduled or trigger SQL', () => {
  const notificationCommand = scheduled.split("'process-notification-jobs',").at(-1)?.match(/\$job\$([^$]+)\$job\$/)?.[1]
  const opsCommand = scheduled.split("'process-ops-jobs',").at(-1)?.match(/\$job\$([^$]+)\$job\$/)?.[1]
  assert.ok(notificationCommand)
  assert.ok(opsCommand)
  for (const type of lanes.notificationCron) assert.ok(notificationCommand.includes(`"${type}"`), type)
  for (const type of lanes.opsCron) assert.ok(opsCommand.includes(`"${type}"`), type)
  for (const type of lanes.slackTriggerAndRecovery) assert.ok(slack.includes(type), type)
  for (const type of lanes.moneyTriggerAndRecovery) {
    assert.ok(wake.includes(`when new.job_type`) && wake.includes(type), `${type} immediate wake`)
    assert.ok(wake.includes(`'${type}'`) && wake.includes(`"${type}"`), `${type} recovery`)
  }
})
