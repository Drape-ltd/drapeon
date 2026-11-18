# Production migration-ledger reconciliation — 2026-11-17

## Scope and method

This is a **read-only** reconciliation for Drape-PROD. The local migration
directory has 114 source versions absent from Production migration history.
The inventory checked the actual Production catalog for the relations,
columns, constraints/indexes, functions/signatures, policies, triggers,
grants, and scheduled-job names referenced by every one of those versions.
It did not read application rows, provider records, secrets, logs, or function
arguments, and it made no Production change.

"Structurally present" below means the catalog contains the corresponding
current object or a known later successor. It does **not** certify that a
historical `CREATE OR REPLACE FUNCTION` body is byte-for-byte identical to an
old source file. Historical function-body parity and data-only migration
outcomes require their own forward-repair review; no missing ledger entry may
be repaired solely from this inventory.

## Blocking result for PR #219

`20261116120000_tailor_claim_drafts_pr1` is one of the 114 unrecorded versions,
and Production does not have `public.tailor_profiles.lifecycle_state`.

That source is explicitly Development-only. Its absence is therefore expected,
but it blocks PR #219's `20261117202000`: the proposed public-profile helper
references `lifecycle_state`. Applying that source version would install a
policy helper that fails at runtime. Do not replay the full draft-claim
migration as an incidental dependency.

The forward-only replacement is now
`20261118014508_phase4_production_tailor_profile_policy_helpers`. It uses the
current Production public-tailor rule (`is_live`, `is_verified`, not
`is_test_profile`) and supports both Production UUID IDs and Dev text IDs. It
does not refer to `lifecycle_state`. It has passed Dev function/grant/behavior
checks, but no Production action is approved by this note.

## A. Structurally present in Production; history marker missing (42)

These source versions have their persistent catalog outcome present, or a
later final successor present, in Production. They are **not** authorised for
history repair. Any future reconciliation must compare function bodies and
dependency ordering before deciding whether a forward repair is needed.

| Area | Versions |
| --- | --- |
| Survey and marketing | `20260915133000`, `20260915143000`, `20260915150000`, `20260915153000`, `20260920100000`, `20260920113000` |
| Trust-exception wrapper/compatibility | `20260929160000`, `20260929161000`, `20260929162000` |
| Ops queue, recovery, and grouped-job objects | `20261015134548`, `20261015150802`, `20261015150942`, `20261015153213`, `20261015155317`, `20261015160444`, `20261015161242`, `20261015165500` |
| TIP claim foundation and finalizers | `20261022002558`, `20261022002859`, `20261022003219`, `20261022003751`, `20261022003918`, `20261022004047`, `20261022004202`, `20261022012820`, `20261022023108`, `20261022023327`, `20261022023739`, `20261022034433`, `20261022034759`, `20261022035404` |
| Order-refund / payout-identity claim guards | `20261022233900`, `20261022234256`, `20261022234942`, `20261024223431`, `20261024225931`, `20261025020517`, `20261025021016` |
| Later finalizers visible in the catalog | `20261107194113`, `20261109013000`, `20261110120000`, `20261113010000` |

## B. Dev-only, verification/cache-only, guarded no-op, or superseded (31)

These versions do not represent an independently promotable Production schema
change. Verification migrations and cache reloads leave no durable catalog
object; the listed Dev/QA migrations are intentionally excluded. The two PR
#218 grant-repair migrations are guarded repairs that are no-ops against
Production's established per-column grant baseline.

| Reason | Versions |
| --- | --- |
| Verification-only claim assertions | `20261022002604`, `20261022003551`, `20261022003554`, `20261022003557`, `20261022003811`, `20261022003952`, `20261022004111`, `20261022004233`, `20261022012827`, `20261022023331`, `20261022023742`, `20261022034452`, `20261022035048`, `20261022035500`, `20261022233922`, `20261022234319`, `20261022235023`, `20261024223443`, `20261024230021`, `20261025103949` |
| Cache-only PostgREST refresh (no durable catalog marker) | `20260929163000` |
| Explicit Dev/QA-only migrations | `20261030133137`, `20261030151320`, `20261108045200`, `20261111140000`, `20261112010000`, `20261116120000`, `20261117062555`, `20261117151806` |
| Guarded no-op in Production's healthy grant state | `20261117190000`, `20261117191500` |

## C. Missing, stale, or not provable from schema — fail closed (41)

These are not eligible for marker repair or bulk replay. Some have an older
object with the same name; some are data-only repairs whose completion cannot
be determined from the catalog. Each needs its own reviewed forward plan,
including any required row-level preflight and a current caller/dependency
audit.

| Area | Versions | Catalog result that requires a forward review |
| --- | --- | --- |
| Trust and Ops behavior | `20261002130000`, `20261015173015`, `20261015183256` | The trust wrapper is stale for the waiver-method change; the Slack trigger lacks the intended final `WHEN` filtering. |
| TIP uniqueness | `20261022003329` | The historical `payouts_tip_source_payment_unique_idx` name is absent; the current claim model has a successor business-key contract that requires semantic review rather than replay. |
| PAY-003 payment integrity | `20261030030000`, `20261030040000`, `20261030050000`, `20261030060000` | Payment transition/refund tables and their data baseline are not established by the current catalog under these source contracts. |
| C2 payout integrity | `20261030100000`, `20261030110000`, `20261030120000` | Guard/function and data-repair outcomes are not established under these source contracts. |
| Tax and fabric recovery | `20261102180324`, `20261102182653`, `20261102200000`, `20261102204053`, `20261102210052`, `20261102234537` | Address-scoped cache, fabric-attempt fields, and recovery contracts are absent or only partially represented. |
| Push, dispatch, and worker recovery | `20261108181600`, `20261108224000`, `20261108224518`, `20261110173730`, `20261112003354`, `20261112213000` | Receipt linkage/quarantine, dispatch retry, wake trigger, audit repair, or scheduled alert is absent or cannot be proved without row evidence. |
| Cancellation and Money Desk data repairs | `20261109013500`, `20261110030000`, `20261110031000`, `20261112001443` | These change data, constraints, or customer-read contracts whose final outcome is not provable from the catalog alone. |
| Tranche/refund/retry recovery | `20261110042832`, `20261110130000`, `20261110140000`, `20261110150000`, `20261111120000`, `20261111130000`, `20261111131000`, `20261111160000`, `20261111180000`, `20261111183000` | One or more required helpers, columns, triggers, schedules, or finalizers is absent; partial presence is not safe evidence. |
| Current PR #218/#219 execution path | `20261117171105`, `20261117194812`, `20261117204214`, `20261118014508` | Shared-order policy, owner RPC, B0 grants, and the Production-compatible helper are not yet present. `20261117202000` remains Dev-only and is intentionally excluded. |

## Required follow-up plan (not approved or started)

The runtime/dependency and error correlation for the 41 original stale-source
candidates plus the dependent legacy push data repair is recorded separately in
[the Production runtime exposure audit](production-runtime-exposure-audit-2026-11-18.md).
That audit identified an actively failing, forward-only push-token schema repair
that must be handled before any live-money proof. It does not authorise a
marker repair or a historical replay.

1. Keep this 114-version backlog out of #219's security promotion and out of
   any broad migration command.
2. For each C item, prepare a separate forward-only repair proposal that names
   its live callers, current object definition, data/preflight query, Dev
   rehearsal, rollback/roll-forward path, and exact Production batch.
3. For each A item, compare the live function/trigger definition to the final
   intended successor before deciding whether a marker repair is legitimate.
   A missing marker alone is never enough.
4. Keep B excluded. Dev-only and verification-only versions must not be marked
   applied in Production.
5. Keep `20261117202000` excluded from Production and use the reviewed
   `20261118014508` forward replacement when returning to PR #219's batches.
