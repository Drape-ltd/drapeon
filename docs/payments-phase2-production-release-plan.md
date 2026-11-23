# PR #66 Production release plan — proposal only (2026-10-27)

**Status: NOT APPROVED.** PR #66 stays draft. This document authorizes no Production SQL, Edge deployment, Worker change, route enablement, or web merge. The target is Supabase Production `wkfsrunetmgjdtcurmoj`; Dev is `pqptfuqogvrajozfsqzi`. Confirm both identities again at execution time.

## Inventory and prerequisites

- The approved read-only Production history check returned **0** rows for old guard version `20261025231356`. Its source version is now `20261026045304`; the SQL must be compared with current Production guards before treating it as pending or safe to apply.
- The 38 migration files dated October 26–27 comprise **one renamed Phase 1 mixed-payout guard** (`20261026045304`) and **37 Phase 2 migrations**. The guard is a separately reviewed prerequisite, not hidden inside the 37 count.
- Production also lacks **21 older source migration versions**. The catalog inspection in [the migration inventory](phase2-production-migration-inventory-2026-10-26.md) found some associated objects already present and others missing. Do not bulk-apply those historical files. Reconcile each needed contract with the deployed Edge source, create forward-only repairs where necessary, and obtain separate approval for that preparatory release. In particular, the marketing-preference contract is absent while newer source references it.
- Re-fetch Production and Dev histories immediately before every proposed batch. A version appearing, changing, or having an object-definition mismatch stops the batch. Run lint and an exact five-or-fewer-version dry run. Apply only the individually reviewed files, not the whole pending directory. No route is enabled by these migrations.

## Proposed order, not an executable queue

First, resolve the 21 older-version compatibility gap and the separate `20261026045304` guard. Then use these **eight** Phase 2 batches (seven of five, one of two). Each row lists exact migration versions in ascending order; its SQL, rollback/forward recovery, data impact, locks, and caller compatibility must be signed off before execution.

| Batch | Phase 2 versions | Gate |
|---|---|---|
| P2-1 | `20261026045721`, `20261026045758`, `20261026045802`, `20261026045859`, `20261026045903` | Route/delivery foundation and order snapshots; verify default-disabled state and old-web compatibility. |
| P2-2 | `20261026045906`, `20261026050209`, `20261026060247`, `20261026060718`, `20261026064034` | Two-person enablement, ready-made corrections, provisioning; `20261026050209` is forward-only. |
| P2-3 | `20261026065628`, `20261026065958`, `20261026075107`, `20261026075738`, `20261026110955` | Destination review/privileges and legacy resolver retirement; verify deployed callers first. |
| P2-4 | `20261026144229`, `20261026165822`, `20261026175146`, `20261026182919`, `20261026184350` | Exposure and account movement; `20261026165822` is forward-only. |
| P2-5 | `20261026185140`, `20261026191529`, `20261026211141`, `20261026214558`, `20261026214605` | Least privilege, movement, fabric snapshot/allocation; verify security and money invariants. |
| P2-6 | `20261026225514`, `20261027001514`, `20261027001521`, `20261027002755`, `20261027003748` | Exposure, consultation booking schema/backfill, funded refund; backfill must have a separate I/O and ambiguity review. |
| P2-7 | `20261027012510`, `20261027023909`, `20261027030000`, `20261027162205`, `20261027173818` | Refund/dispute measurements, fee-proof gate, accepted snapshot mirrors, Ops UUID compatibility. |
| P2-8 | `20261027174041`, `20261027193152` | Ops alert repair and UK tax fail-closed constraint; do not roll back the UK gate without an equivalent replacement. |

After each approved batch, verify exact migration history, schema/RLS/privileges, Advisors, queue/scheduler health, Disk I/O, and an affected synthetic path. Stop on any unexpected difference; prefer a reviewed forward fix over a destructive rollback. Keep route states `DISABLED`/`SANDBOX_ONLY` throughout. Do not turn on Bachs or create live destinations as part of this release.

## Separate Edge and web releases

Only after compatible schema is verified, review the exact Edge-function diff and deploy those functions as a separate Production release. Check function versions, provider callbacks, job queues, and payment/refund/payout synthetic paths afterward. Paystack may verify or refund historical references but must not create a new transaction. Bachs routes remain unavailable.

Then rebase/review PR #66 against current `main`, run the full launch contract on that exact head, and obtain explicit approval before merging: merging auto-deploys web. Verify old/new schema compatibility and onboarding behavior before and after merge. The postponed visual pass is a later integrated gate, not evidence claimed here. Record live versions and a scoped forward-recovery action for each release unit.

**Approval needed before execution:** the reconciled preparatory schema repairs, the renamed guard, each Phase 2 batch, each Edge release, and the web merge all require separate scoped Production approval. PR #66 must remain draft until this plan is reviewed and approved.
