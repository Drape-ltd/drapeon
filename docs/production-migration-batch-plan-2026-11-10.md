# Production migration batch plan, 2026-11-10

> A planning aid, **not approval to execute**. Each batch needs the founder's separate approval, a Dev proof, a catalog-only Production preflight and a postflight, as in `docs/phase3-production-fixup.md`. **Never run `supabase db push`** against this backlog. Apply only the named files, under their exact versions.

## Evidence (read-only, 2026-11-10)
- **Production** (`Drape-PROD`): 592 history rows, newest `20261029132040`. Every Production version exists in `main`, so there are no aliases. `payouts`, `payout_claims`, `payout_provider_operations`, `payout_attempts` and `order_settlement_tranches` all have **0 rows**. No payment route is enabled.
- **`main`**: 688 migration files, **96 versions** not in Production history.
- **Dev**: every one of the 96 is on Dev, under its own version or a same-name alias, except `20261110050000` (the #135 Dev rollout is applying it). Dev also has `20261030031742 pay003_refund_failure_same_status`, which has **no file in the repo**.
- The only queries were version and name lists, plus row counts on the five payout tables. No application data, no writes.

## What is NOT in any batch (64 + 3)
| Versions | Why |
|---|---|
| 21 legacy versions, `20260915133000` → `20261015183256` (surveys, marketing topics, trust exception, Ops queue/SLA/jobs) | **Superseded.** Replaced in Production on 2026-10-28 by the `prod_forward_*` repairs F1–F4 (`20261028000846`…`20261028002620`). See `docs/phase3-production-fixup.md`. Replaying them would rename functions and restore stale definitions. |
| 43 versions, `20261022002558` → `20261025103949` (tip claims, payout claims and attempts, refund claims, identity-conflict guards, and their `verify_*` assertions) | **Superseded.** Replaced in Production by `restore_payout_claim_foundation`, `restore_refund_claim_foundation`, `restore_payout_operation_guards`, `phase1_claim_runtime_forward_repair`, `phase3_tip_claim_forward_closure` and the `phase3_*_forward` guards (Oct 28–29). The Phase 3 plan says not to replay this range. |
| `20261030133137_dev_ops_supabase_mfa_identity_receipts`, `20261030151320_repair_local_mfa_receipt_triggers`, `20261108045200_dev_third_mfa_approver` | **Dev-only by design.** Local Supabase MFA receipts are gated to the Drape-DEV project. Never apply to Production. |

**Leave these history gaps as they are.** Don't mark them applied with `migration repair`; the earlier releases chose not to claim that the originals ran. That decision is exactly why `db push` must never be used here.

## Gate 0: before any batch
1. **Resolve the Dev drift.** Dev's `pay003_refund_failure_same_status` has no file in the repo. Diff its live effect against `20261030040000`. Either it's folded into a repo file, in which case document that, or it's missing and needs a reviewed forward migration in the repo before B1.
2. **Audit Production web and Ops skew.** Web and Ops deploy from `main` on merge, so they're 12 days ahead of the Production schema. List every RPC and column that `main`'s web, Ops and mobile code reads but Production lacks, and confirm each degrades safely. Example already confirmed: `customer-refund-records.tsx` treats `PGRST202` as no records. Fix any caller that doesn't.
3. **Approval scope.** For each batch, the founder approves (a) a catalog-only preflight of that batch's target objects and (b) the apply. That's two separate yeses.
4. **Edge rule:** Edge functions that need a batch's schema are deployed **after** that batch is verified. They're a separate release unit with their own approval.

## Batches, in order (at most 5 each; data repairs and the scheduler change stand alone)
| # | Versions | Kind | What it does | Paired release after verify |
|---|---|---|---|---|
| B1 | `20261029233955`, `20261030030000`, `20261030040000` | grants, schema, functions | Ready-made route snapshot service grant; PAY-003 forward-only payment status (3 tables plus guards); refund-failure reversal | none |
| B2 | `20261030050000` | **data** | PAY-003 seed of the legacy provider-refund aggregate. Preflight: the affected-row count (expected 0 or very low; no payments yet) and the query plan | none |
| B3 | `20261030060000`, `20261030100000` | functions, guards | Refund-aggregate hardening; C2 forward-only payout transitions | none |
| B4 | `20261030110000` | **data** | C2 restore of payout destinations from claim evidence only. Preflight count (payout tables are empty, so expect 0) | none |
| B5 | `20261030120000`, `20261030154721`, `20261030231747`, `20261102054500` | functions, guards | Returned-funds forward repair (the tranche trigger #140 relies on); Stripe readiness sync; first-release review readiness; fail-safe block | `stripe-connect`/readiness Edge functions |
| B6 | `20261102180324`, `20261102182653` | schema plus cache cleanup | Address-scoped tax-rate cache. `182653` deletes rows with a null `address_key` and adds a PK. Preflight that count; it's cache data only | tax-quote Edge functions |
| B7 | `20261102200000`, `20261102204053`, `20261102210052`, `20261102234537` | schema, functions | Fabric release provider attempts; bind the claimed Stripe source charge; multiple fabric payout attempts; reviewed fabric job recovery | fabric release worker, `ops-money-action` |
| B8 | `20261107194113`, `20261108181600`, `20261108224000` | functions, schema | Cancellation-review Money Desk refund; push receipt audit; reviewed dispatch refund retry | `process-job-queue`, push receipt worker, `ops-money-action` |
| B9 | `20261108224518` | **scheduler** | Orphaned job worker wake-up: trigger plus `cron` sweep. Postflight: cron count, run cadence, queue depth and Disk I/O over the next hour | none |
| B10 | `20261109013000` | functions | Canonical cancellation-refund Ops case | none |
| B11 | `20261109013500` | **data** | Close cancellation cases proven refunded. Preflight count (Dev had 1, so don't infer Production's) | none |
| B12 | `20261110030000`, `20261110031000` | schema, function | `provider_readiness_checked_at` on Money Desk attempts; customer refund receipts RPC | `ops-money-action` and the Stripe release functions (#129/#132), then a web check of refund receipts |
| B13 | `20261110042832` | functions (809 lines) | #131 tranche refund accounting: the helper plus 6 function redefinitions. It's alone because of its size and money impact. Postflight: definition hashes against Dev | `release-settlement-tranche` |
| B14 | `20261110050000` | schema, RPC | Marketplace category (#135, corrected by #141). Apply only after the #135 Dev rollout passes | `read-gateway`, which must never go before B14 |
| B15 | `20261110120000`, `20261110130000`, `20261110140000` (+ `20261110150000` once #142 merges) | functions, schema | Tranche destination-correction guard, reviewed claimed retry, definite-rejection close-out (+ unstarted close) | `release-settlement-tranche`, `monitor-settlements`, `ops-money-action` |
| B16 | `20261110084500` (once #137 merges) | **data** | Historical push audit repair. Deploy the receipt-aware worker (B8 pairing) first, then preflight the count and plan | none |

16 batches. B15 and B16 depend on PRs that aren't merged yet. Re-plan anything merged after today into new batches; don't stretch these.

## Per-batch procedure (same as F1–F4 and P3)
1. **Confirm the target.** Check that the project is `Drape-PROD` and `ACTIVE_HEALTHY`. Re-read migration history and confirm the batch's versions are exactly the ones pending, with none already present.
2. **Dev proof.** Each version must be in Dev's history (or a documented alias), with a live definition hash matching the file. B14 needs the #135 Dev rollout pass. B15 needs the Dev rollout of #138–#140.
3. **Preflight (catalog-only, approved).** Check the target objects' presence and definitions, and the row counts for data batches. **Stop if Production already has an object in a different shape**, and write a forward repair instead.
4. **Lint and scope.** Run the migration lint, and review the exact SQL that will run.
5. **Apply** each file under its exact version, in one transaction per batch, unless a file manages its own transactions.
6. **Postflight:**
   - history rows;
   - object definitions and grants (RLS on new tables, no `anon`/`authenticated` execute on `SECURITY DEFINER` functions);
   - Advisors (no new security finding);
   - cron and queue health, and dead letters;
   - Disk I/O;
   - one affected synthetic check.
7. **Record it** in `docs/phase3-production-fixup.md` (or a new `phase4` file), with counts only and no customer data.

## Risks to watch
- **B5/B12 against the Stripe Edge releases.** The `main` Stripe release functions expect `provider_readiness_checked_at` (B12) and the readiness RPCs (B5). Don't deploy those Edge functions to Production before B12.
- **B9 is the only scheduler change.** Watch the cron cadence and I/O for an hour before B10.
- **B13 is the largest money change.** Compare definition hashes with Dev after applying, and keep routes disabled throughout.
- **Repo hygiene.** `20261108045200_dev_third_mfa_approver.sql` contains founder email addresses in this public repo. It's Dev-only, but consider moving those addresses to a Dev-only config.
