# Phase 1–2 Production fix-up: 21 older migration gaps

Status: **F1–F4, the survey privilege repair, the renamed Phase 1 guard and P2-1/P2-2 applied and verified in Production; P2-3…P2-8 need separate approvals.** Production is `wkfsrunetmgjdtcurmoj`; Dev is `pqptfuqogvrajozfsqzi`. The 21 source versions absent from Production history were compared with the 2026-10-27 allowlisted Production catalog/deployed-Edge audit in the [PR #66 migration inventory](https://github.com/Drape-ltd/drapeon/blob/codex/payments-phase2-routing-redesign/docs/phase2-production-migration-inventory-2026-10-26.md), then the marketing target was rechecked read-only on 2026-10-27. A missing history row is not permission to replay the original migration.

## Current user-visible risk

The current web source exposes marketing-topic switches and sends `TOPIC_PREFERENCE_SET`. F1 restored the missing table and RPC, and the separately approved `communications-action` v25 now contains the action. Its public `STATUS_LIST` synthetic returned HTTP 200; an authenticated Production topic-toggle was **not** performed, so that path lacks end-to-end live proof. F2 corrected the trust-exception snapshot function to record `ADMIN_RECRUITMENT_WAIVER` for future waivers, without rewriting any profile. No other current Production outage was established by the scoped catalog/source checks.

## Per-version reconciliation

The repair files use new versions, preserve rows, and do not claim the original migrations ran. `PRESENT` means the required final target fragment was seen in the allowlisted Production catalog; `SUPERSEDED` means a later final definition is repaired instead. The source audit is scoped, not a complete database comparison.

| Missing source version | Production finding | Forward resolution |
|---|---|---|
| `20260915133000` survey responses | table absent | `20261028000909` creates private table, RLS and indexes |
| `20260915143000` survey invites | table/functions/triggers absent | `20261028000912` creates scheduling contract without sending existing invites |
| `20260915150000` marketing preferences | table/RPC absent | **first release:** `20261028000846` creates consent-scoped table/RPC |
| `20260915153000` campaign topic binding | column/constraints/functions absent | `20261028000905` installs the final topic contract |
| `20260920100000` new-tailor audience guard | function/trigger absent | `20261028000905` installs the curated-audience guard |
| `20260920113000` recipient role hardening | final function absent | `20261028000905` uses canonical `public.users.role`, not user-editable auth metadata |
| `20260929160000` trust wrapper | PRESENT | no SQL; preserve the installed wrapper/snapshot boundary |
| `20260929161000` profile-key compatibility | PRESENT | no SQL; preserve text-compatible lookup |
| `20260929162000` trust refresh repair | PRESENT | no SQL; do not rename or replace the working wrapper |
| `20260929163000` schema-cache notification | no durable target | issue cache reload only with a separately approved schema release if needed |
| `20261002130000` waiver method | stale assignment | `20261028000916` changes future waiver method only, without editing profiles |
| `20261015134548` early Ops queue page | SUPERSEDED; final RPC absent | `20261028000927` installs final filter/pagination version |
| `20261015150802` SLA reminders | older unbounded function | `20261028001358` installs bounded final worker; does not execute it |
| `20261015150942` SLA first response | older predicate | `20261028001401` installs final automatic-escalation-safe predicate |
| `20261015153213` early source-case RPC | SUPERSEDED; final RPC absent | `20261028001410` installs final grouped-job-aware RPC |
| `20261015155317` final Ops queue page | absent | `20261028000927` |
| `20261015160444` grouped job cases | table/views/functions absent | `20261028001410` creates private table, security-invoker view and final source-case RPC |
| `20261015161242` grouped review | final view/functions absent | `20261028001416` installs final view/review functions |
| `20261015165500` job recovery | table/functions/triggers absent | `20261028001420` creates receipts and guarded recovery functions; no job is replayed |
| `20261015173015` routine Slack filter | trigger filter absent | SUPERSEDED by combined final filter in `20261028001407` |
| `20261015183256` digest Slack filter | trigger filter absent | `20261028001407` installs combined final filter |

## Dev and local proof

- The 12 historical forward repairs, one Phase 2 compatibility repair, and one canonical survey-role correction were applied to Dev in dependency order. Their filenames match the exact versions recorded in Dev migration history. Dev has 14/14 new repair history rows, 5/5 expected tables, 2/2 expected views, 10/10 expected triggers, and RLS enabled on all five tables. The survey correction removes the user-editable auth-metadata role fallback; Dev confirms canonical `public.users.role` lookup.
- Self-review found that installing the historical Ops function bodies after the already-applied Phase 2 migrations would regress UUID/text order-ID lookup and Slack `reminderMode` null-safety. `20261028001851` restores both, using the later Phase 2 source. Dev catalog verification confirms both function comparisons are text-compatible and the trigger uses `COALESCE`. The same repair runs after F4 in Production, ahead of the Phase 2 batches; their later migrations then remain idempotent.
- The scripts ran together in one rolled-back transaction against the local full-schema rehearsal database. Separate rolled-back missing-object tests restored the marketing table, campaign column/triggers, survey tables, grouped-job table/views, and recovery table. No local fixture was retained.
- Dev Advisors show no new target-table security warning beyond informational private RLS/no-policy tables and an existing marketing-policy auth-initplan warning. The Production-created marketing policy uses `(select auth.uid())`; the Dev policy pre-existed and was not replaced by the idempotent repair. Existing project-wide advisor notices are not a signoff for unrelated objects.
- These are **forward-only** repairs. Do not roll back by dropping consent, survey, Ops case, or recovery data. An unexpected post-release mismatch gets a scoped corrective migration.

## Proposed Production sequence (approval required for every batch)

1. **F1 marketing (2):** `20261028000846`, `20261028000905` — applied by exact version in individual transactions on 2026-10-27. Preflight found both prerequisite functions, consent table and all seven campaign columns; neither version was present. Postflight confirmed both history rows, RLS, own-read policy, authenticated read-only grant, service write grant, preference and Ops RPCs, two campaign triggers and topic column. Project reported `ACTIVE_HEALTHY`. Advisors had no new target security warning; one informational unused-index finding and pre-existing project-wide warnings remain. The separately approved `communications-action` Edge release advanced v24→v25 with `verify_jwt=false` preserved. Deployed source contains `PREFERENCES_GET` and `TOPIC_PREFERENCE_SET`; public `STATUS_LIST` returned HTTP 200. Authenticated Production preference reads/writes remain untested and are not claimed as proved.
2. **F2 survey/trust (4):** `20261028000909`, `20261028000912`, `20261028000916`, `20261028002223` — applied in one transaction on 2026-10-27 after a Production prerequisite/column check. All four exact history rows, both RLS-enabled tables, four triggers, canonical-role function and corrected waiver body passed verification; the new invite table had zero rows. Postflight Advisors identified three new `SECURITY DEFINER` trigger functions inheriting default public `EXECUTE`. Privilege-only `20261028002620` was then separately approved, applied and verified: both anon and authenticated have no EXECUTE on the three functions, and the corresponding Advisor warnings returned to baseline. Other Advisor findings were existing project-wide warnings or informational private-table/index notices. Project was `ACTIVE_HEALTHY`, queue/dead-letter counts were zero, recent failed-payment-webhook count was zero, and 22 cron jobs remained active.
3. **F3 Ops core (4):** `20261028000927`, `20261028001358`, `20261028001401`, `20261028001407` — separately approved and applied in one transaction. All four exact history rows, service-only queue RPC, `LIMIT 100` reminder worker, queue-policy function and Slack daily-digest filter passed definition checks. No worker was invoked. Advisors showed no new target warning. Project was `ACTIVE_HEALTHY`; queued/failed jobs, recent failed payment webhooks and failed cron runs in the checked hour were all zero; 22 cron jobs remained active.
4. **F4 grouped jobs and compatibility (4):** `20261028001410`, `20261028001416`, `20261028001420`, `20261028001851` — separately approved and applied in one transaction. All four exact history rows, RLS on both private Ops tables, security-invoker views, service-only grants, text-compatible order lookups and null-safe Slack filter passed. No job was replayed or case mutated. Advisors showed no new target security warning; project was `ACTIVE_HEALTHY`, with 22 active crons and no failed cron run in the checked hour.

## Historical dead-job finding

The first queue check used `FAILED`/`DEAD_LETTER`, which are not this queue's terminal values; its zero result was **not** a valid dead-letter count. The corrected `status='DEAD'` check found nine historical September jobs: four `SEND_ACCOUNT_EVENT_EMAIL`, four `SEND_SMS`, and one `SEND_OPS_VERIFICATION_EMAIL`. Five have a direct Ops case; four do not. There are zero active jobs. F4 groups future failures only and did not silently replay or alter historical jobs. The four without cases need separate Ops triage; this is a pre-existing Production reliability issue, not an F4 regression.

Before **each** Production batch: recheck project identity, exact pending versions, current object definitions, Dev proof, migration lint, SQL scope and recovery. Apply at most five named files; do not run `db push` over the older missing-version backlog. After each batch: exact history, Advisors, scheduler/queue health, Disk I/O, callbacks and an affected synthetic check. The renamed Phase 1 guard and P2-1…P2-8 from PR #66 follow only after F1–F4 are reviewed and verified.

## Phase 1 guard and Phase 2 promotion progress

- The renamed Phase 1 exclusivity guard `20261026045304` was separately approved and applied by exact version after confirming neither old `20261025231356` nor the new version was in Production history, no guard trigger existed, and zero orders had both `ORDER_EARNING` and `SETTLEMENT_TRANCHE` payouts. Postflight confirmed one enabled trigger, private guard function inaccessible to anon, exact history and zero mixed orders. Production remained `ACTIVE_HEALTHY`; nine historical dead jobs were unchanged.
- **P2-1** (`20261026045721`, `20261026045758`, `20261026045802`, `20261026045859`, `20261026045903`) was separately approved and applied in one transaction. All five exact history rows, three RLS-enabled route/delivery/destination tables, six snapshot/audit guards and revoked legacy quote-acceptance service access passed verification. Route, delivery-rule and destination counts were zero. Advisors had no new target security warning; project was `ACTIVE_HEALTHY`, with 22 active crons and no failed cron run in the checked hour. New paid quote acceptance is intentionally unavailable until Phase 4 route enablement; onboarding was not changed.
- **P2-2** (`20261026045906`, `20261026050209`, `20261026060247`, `20261026060718`, `20261026064034`) was separately approved and applied in one transaction. All five exact history rows, RLS-enabled two-person enablement requests, service-only approval RPC and removal of the second currency-provider check from route acceptance passed. Routes, requests and approvals remained zero. Advisors had no new target security warning; project was `ACTIVE_HEALTHY`. No route was enabled.
