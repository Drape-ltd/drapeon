import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const objects = read('supabase/migrations/20261126175156_prod_forward_cron_edge_outcomes_objects.sql')
const schedule = read('supabase/migrations/20261126175158_prod_forward_cron_edge_outcomes_schedule.sql')
const finalDev = read('supabase/migrations/20261117203257_harden_tailor_draft_purge_retries.sql')

const finalFunction = (sql) => sql.match(
  /create or replace function public\.reconcile_cron_edge_outcomes\(p_limit integer default 50\)[\s\S]*?grant execute on function public\.reconcile_cron_edge_outcomes\(integer\) to service_role;/u,
)?.[0]

test('Production forward monitor uses the final Development recovery function', () => {
  assert.ok(finalFunction(objects))
  assert.equal(finalFunction(objects), finalFunction(finalDev))
  assert.match(objects, /create table public\.cron_edge_invocations/u)
  assert.match(objects, /create policy deny_staff_draft_claim_session on public\.cron_edge_invocations\s+as restrictive for all to authenticated\s+using \(not \(select public\.is_staff_draft_identity\(\)\)\)/u)
  assert.match(objects, /revoke all on public\.cron_edge_invocations from public, anon, authenticated/u)
  assert.match(objects, /grant select on public\.cron_edge_invocations to service_role/u)
})

test('Production forward scheduler preserves purge cadence and bounds monitor work', () => {
  assert.match(schedule, /jobname = 'purge-tailor-drafts'[\s\S]*schedule = '17 \* \* \* \*'/u)
  assert.match(schedule, /cron\.schedule\(\s*'purge-tailor-drafts',\s*'17 \* \* \* \*'/u)
  assert.match(schedule, /cron\.schedule\(\s*'reconcile-cron-edge-outcomes',\s*'\*\/5 \* \* \* \*'/u)
  assert.match(schedule, /select public\.reconcile_cron_edge_outcomes\(50\)/u)
  assert.match(objects, /if p_limit < 1 or p_limit > 100/u)
  assert.match(objects, /created_at < v_now - interval '30 days'[\s\S]*limit 500/u)
})
