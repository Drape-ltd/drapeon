import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const migration = read('supabase/migrations/20261117164737_schedule_tailor_draft_purge.sql')
const rollback = read('supabase/migrations/rollback/20261117164737_schedule_tailor_draft_purge.rollback.sql')
const monitoring = read('supabase/migrations/20261117172853_monitor_cron_edge_outcomes.sql')
const worker = read('supabase/functions/purge-tailor-drafts/index.ts')

const command = String.raw`select util.invoke_edge_function('purge-tailor-drafts', '{}'::jsonb, 300000);`

test('tailor draft purge is hourly and invokes the cron-authorized worker', () => {
  assert.match(migration, /cron\.schedule\(\s*'purge-tailor-drafts',\s*'17 \* \* \* \*'/u)
  assert.ok(migration.includes(command))
  assert.match(migration, /to_regprocedure\('util\.invoke_edge_function\(text,jsonb,integer\)'\)/u)
})

test('worker remains bounded and retention-aware', () => {
  assert.match(worker, /BATCH=50/u)
  assert.match(worker, /RETENTION_DAYS=30/u)
  assert.match(worker, /\.limit\(BATCH\)/u)
  assert.match(worker, /authorizeCronRequest\(request,FN,cors\)/u)
})

test('rollback refuses to remove a drifted job', () => {
  assert.match(rollback, /where jobname = 'purge-tailor-drafts'/u)
  assert.match(rollback, /v_job\.schedule <> '17 \* \* \* \*'/u)
  assert.ok(rollback.includes(command))
  assert.match(rollback, /raise exception 'Tailor draft purge cron drifted; inspect before rollback'/u)
})

test('pg_net outcomes create one durable alert and recovery path', () => {
  assert.match(monitoring, /create table public\.cron_edge_invocations/u)
  assert.match(monitoring, /left join net\._http_response r on r\.id = i\.request_id/u)
  assert.match(monitoring, /v_row\.status_code < 200 or v_row\.status_code >= 300/u)
  assert.match(monitoring, /'cron-edge:' \|\| v_row\.function_name/u)
  assert.match(monitoring, /'ISSUE_CREATED'/u)
  assert.match(monitoring, /'ISSUE_RESOLVED'/u)
  assert.match(monitoring, /'reconcile-cron-edge-outcomes'/u)
})
