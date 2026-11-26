# Production-forward cron Edge outcome monitor

Scope: Production only. Development already has the final objects from `20261117172853_monitor_cron_edge_outcomes.sql` and `20261117203257_harden_tailor_draft_purge_retries.sql`; do not replay these forward files there. No Production change was made while preparing this PR.

## Read-only inventory and dependencies

On 2026-11-26, `public.reconcile_cron_edge_outcomes(integer)`, `public.cron_edge_invocations`, `util.invoke_monitored_edge_function(text,jsonb,integer)`, and the `reconcile-cron-edge-outcomes` job were absent in Production and present in Development. Production's `purge-tailor-drafts` job still runs at `17 * * * *` through `util.invoke_edge_function`. The final Development function is copied exactly into the forward migration; it reopens a resolved issue after a later failure and removes at most 500 terminal ledger rows older than 30 days per run.

The SQL directly uses `public.cron_edge_invocations`, `net._http_response`, `public.ops_issues`, `public.ops_audit_logs`, `public.current_ops_environment()`, and `util.invoke_edge_function`. Its monitored wrapper calls the existing `util.invoke_edge_function`. There are no `.from()`, `.rpc()`, or `.storage.from()` targets in these SQL functions, and no new Edge Function deploy. The existing `purge-tailor-drafts` Edge Function writes `tailor_draft_purges`, which is already present in Production.

## Scoped dry-run list

Read-only Production migration-ledger query for the two versions returned zero rows. This is a **two-migration batch**, below the five-migration limit. It is a scoped list; the repo's historic Development migration drift makes a broad `supabase db push` inappropriate.

1. `20261126175156_prod_forward_cron_edge_outcomes_objects.sql`: ledger table, index, RLS and restrictive STAFF_DRAFT policy, monitored wrapper, final reconciler.
2. `20261126175158_prod_forward_cron_edge_outcomes_schedule.sql`: preserve hourly purge at `17 * * * *` while recording its HTTP request, then reconcile at `*/5 * * * *` with a batch of 50 (function accepts 1–100).

Both migrations stop if expected Production objects or job definitions drift. Apply each separately with `psql --single-transaction -v ON_ERROR_STOP=1 -f <file>`, then repair **only these two** ledger versions after confirming the SQL succeeded. This is a plan for a later reviewed Production session, not authorization to run it.

## Rehearsal

The files were parsed and run in order inside a rolled-back transaction against the disposable Production-shaped local Postgres schema. The local-only `net._http_response` stub supplied the pg_net catalog dependency. The rehearsal created the table, both functions, and the two expected cron schedules; after rollback, none remained. The contract test checks the copied final function against the Development migration and locks the cadence, batch cap, retention, RLS policy, and grants. No Production SQL was written.

Postflight when approved: check the ledger table and policies, compare `pg_get_functiondef` for both functions, verify `cron.job` has exactly the two schedules above, invoke `public.reconcile_cron_edge_outcomes(50)` once, and confirm the next hourly purge HTTP outcome is recorded. Review Security and Performance Advisors after application.

## Production application evidence — 2026-11-26

The founder reported that Claude applied each of the two files in the Production SQL Editor, each wrapped in `begin; … commit;`; both succeeded. The founder's postflight found job 82 (`purge-tailor-drafts`, `17 * * * *`) using `util.invoke_monitored_edge_function`, job 84 (`reconcile-cron-edge-outcomes`, `*/5 * * * *`) active, RLS and `deny_staff_draft_claim_session` on the new ledger table, and no reconciler execute privilege for `anon` or `authenticated`. A manual `reconcile_cron_edge_outcomes(50)` returned `{processed:0, failed:0}` at 18:19:47 UTC. These SQL Editor and immediate postflight facts are founder-supplied evidence.

I independently confirmed the CLI link was Production project `wkfsrunetmgjdtcurmoj`, then ran `supabase migration repair --status applied 20261126175156 20261126175158 --linked` in the two-file release checkout. The command succeeded. A read-only query of `supabase_migrations.schema_migrations` returned **exactly both requested versions**. No other version was repaired. The earlier Production-forward versions are absent from Development's ledger, so the conditional Development record-only step did not apply; its ledger was left untouched.

A separate read-only Production catalog query confirmed RLS enabled, one restrictive `deny_staff_draft_claim_session` policy, and no `anon` or `authenticated` execute privilege on the reconciler. `cron.job` has job 82 active at `17 * * * *` with the monitored wrapper and job 84 active at `*/5 * * * *`. The ledger had zero invocation rows before the next `:17` run.

Read-only checks after 19:17 UTC found `cron.job_run_details` job 82 run **186308** `succeeded` at 19:17:00 UTC. Its monitored invocation was request ID **75201**, initially `PENDING`; no matching `ops_issues` failure row existed. A second read-only check after 19:20 UTC found request **75201** `SUCCEEDED` with HTTP **200** (response observed at 19:17:00 UTC) and job 84 run **186312** `succeeded` at 19:20:00–19:20:06 UTC. No matching purge failure issue was present. Only request and run IDs are recorded here; no request or response payloads were read into this document.

Production Security and Performance Advisors were checked after the 19:20 run. Neither returned a finding for `public.cron_edge_invocations`; there were no new findings tied to this batch. Other existing findings were left unchanged and are outside this evidence PR.
