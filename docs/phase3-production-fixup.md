# Phase 1–2 Production fix-up: 21 older migration gaps

Status: **F1 applied and verified in Production; F2–F4 require separate approvals.** Production is `wkfsrunetmgjdtcurmoj`; Dev is `pqptfuqogvrajozfsqzi`. The 21 source versions absent from Production history were compared with the 2026-10-27 allowlisted Production catalog/deployed-Edge audit in the [PR #66 migration inventory](https://github.com/Drape-ltd/drapeon/blob/codex/payments-phase2-routing-redesign/docs/phase2-production-migration-inventory-2026-10-26.md), then the marketing target was rechecked read-only on 2026-10-27. A missing history row is not permission to replay the original migration.

## Current user-visible risk

The current web source exposes marketing-topic switches and sends `TOPIC_PREFERENCE_SET`. F1 restored the missing table and RPC, but deployed Production `communications-action` v24 still lacks that action. Thus the topic-switch path remains incompatible and is expected to fail until its separately approved Edge release; a live authenticated click was **not** performed. Older preference/inbox actions remain available. The trust-exception snapshot function also still records a recruitment waiver as `CHALLENGE_VIDEO` instead of `ADMIN_RECRUITMENT_WAIVER`; that is a prospective correctness defect if Ops uses the waiver path, not evidence of an existing affected profile. No other current Production outage was established by the scoped catalog/source checks.

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

1. **F1 marketing (2):** `20261028000846`, `20261028000905` — applied by exact version in individual transactions on 2026-10-27. Preflight found both prerequisites functions, consent table and all seven campaign columns; neither version was present. Postflight confirmed both history rows, RLS, own-read policy, authenticated read-only grant, service write grant, preference and Ops RPCs, two campaign triggers and topic column. Project reported `ACTIVE_HEALTHY`. Advisors had no new target security warning; one informational unused-index finding and pre-existing project-wide warnings remain. Separately approve/deploy compatible `communications-action` and verify `PREFERENCES_GET` plus `TOPIC_PREFERENCE_SET`; without that Edge release, the current topic UI remains incompatible.
2. **F2 survey/trust (4):** `20261028000909`, `20261028000912`, `20261028000916`, `20261028002223`. The last version immediately replaces the historical invite function's auth-metadata role fallback with canonical `public.users.role`; deploy this batch together, with no Edge release between its files. Verify private RLS, four survey triggers, canonical role lookup, no unexpected invite delivery, waiver function body and no existing profile rewrite.
3. **F3 Ops core (4):** `20261028000927`, `20261028001358`, `20261028001401`, `20261028001407`. Verify queue pagination, bounded reminder definition, response-clock predicate and Slack trigger condition; no worker invocation.
4. **F4 grouped jobs and compatibility (4):** `20261028001410`, `20261028001416`, `20261028001420`, `20261028001851`. Verify security-invoker views, service-only grants, recovery guards, queue health, text-compatible order lookups and null-safe Slack filter; no job replay or case mutation.

Before **each** Production batch: recheck project identity, exact pending versions, current object definitions, Dev proof, migration lint, SQL scope and recovery. Apply at most five named files; do not run `db push` over the older missing-version backlog. After each batch: exact history, Advisors, scheduler/queue health, Disk I/O, callbacks and an affected synthetic check. The renamed Phase 1 guard and P2-1…P2-8 from PR #66 follow only after F1–F4 are reviewed and verified.
