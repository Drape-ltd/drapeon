# Phase 4 Production release accounting — 2026-11-12

This records what is deployed, its source match, and the remaining release
gates. It does not authorize a Production deploy, route enablement, or live
payment.

## Source provenance

- Candidate code commit: `c447285e6ea82bd9ccd396a70d83e8418a289d10`.
- At audit capture, local branch head was
  `6bb0e5e7870624753c91d4e82c0dd22378d89dcd`; `c447285e` is an ancestor. The
  two commits then present after `c447285e` only updated the progress document.
- Compared `c447285e` with remote `main` at
  `70990ea59356780c0cfa42e720e2018ba70cb8dc`: 29 branch-only commits, 48
  main-only commits, and 77 changed files in the merge-base diff. The diff
  includes 46 Supabase paths, 5 shared-package paths, 15 web/mobile paths,
  workflow files, and documentation.
- At audit capture, `c447285e` was not reachable from any fetched remote
  branch. The existing remote task branch was an ancestor. Following the
  founder's instruction to open the PR, this branch was pushed by fast-forward
  (no force-push); the remote task branch advanced 431 commits from its prior
  tip, including the two audit commits.
- At the last GitHub comparison refresh, the PR showed 34 commits and 78
  changed files; it could not automatically merge. Five documentation-only
  commits followed `c447285e` at that point. This accuracy correction adds one
  more documentation-only commit. Do not rebase or merge until the conflict
  set has been reviewed and resolved.
- Supabase's function metadata does not attest a Git SHA. To verify content,
  retrieved each live function bundle and compared every returned file's Git
  blob hash against `c447285e`: **847/847 file comparisons matched across all
  20 functions**. This proves source-content equality, not CI/build provenance.

## Production Edge functions

The approved 20-function deployment completed at the timestamps below
(UTC, 2026-11-13). All remained `ACTIVE` with `verify_jwt=false`. Every bundle
matched the source at `c447285e` exactly by the file comparison above.

| Function | Production version | Updated (UTC) |
|---|---:|---|
| `bachs-webhook` | 2 | 04:25:51.906 |
| `consultation-lifecycle-action` | 31 | 04:25:53.556 |
| `customer-order-action` | 52 | 04:25:55.469 |
| `drapeon-dispatch-action` | 29 | 04:25:57.196 |
| `expire-pending-payments` | 49 | 04:25:58.745 |
| `message-action` | 52 | 04:26:15.073 |
| `monitor-settlements` | 30 | 04:26:16.630 |
| `payment-action` | 53 | 04:26:18.667 |
| `payment-route-availability` | 4 | 04:26:20.024 |
| `payout-account-action` | 36 | 04:26:21.406 |
| `paystack-webhook` | 54 | 04:26:36.427 |
| `process-job-queue` | 59 | 04:26:38.345 |
| `ready-made-order-action` | 55 | 04:26:40.996 |
| `refund-order-payments` | 33 | 04:26:42.591 |
| `release-order-tip` | 29 | 04:26:43.993 |
| `release-settlement-tranche` | 31 | 04:26:58.097 |
| `release-tailor-adjustment` | 2 | 04:26:59.440 |
| `send-consultation-reminders` | 34 | 04:27:01.700 |
| `stripe-webhook` | 53 | 04:27:03.894 |
| `tailor-order-action` | 58 | 04:27:06.526 |

The five held Track A slugs were not in this deployment and their Production
versions did not advance: `read-gateway`, `handle-verification-decision`,
`ops-trust-action`, `ops-read-gateway`, and `tailor-profile-action`. Supabase
deploys each slug as its own bundle; the 20-function bundle comparison found
no Track A slug among the deployed functions.

## Production migrations

All 12 source versions below are present exactly once in Production history.
P4-0 contains the three Stripe readiness migrations; P4-1 and P4-2 are the
nine newer Phase 4 migrations.

| Batch | Version | Source file | Rollback |
|---|---|---|---|
| P4-0 | `20261030154721` | `20261030154721_sync_stripe_payout_readiness.sql` | **Missing** — no matching rollback file found |
| P4-0 | `20261030231747` | `20261030231747_stripe_first_release_review_readiness.sql` | `supabase/migrations/rollback/20261030231747_stripe_first_release_review_readiness.rollback.sql` |
| P4-0 | `20261102054500` | `20261102054500_stripe_first_release_block_fail_safe.sql` | `supabase/migrations/rollback/20261102054500_stripe_first_release_block_fail_safe.rollback.sql` |
| P4-1 | `20261112181838` | `20261112181838_phase4_bachs_destination_identity.sql` | `supabase/migrations/rollback/20261112181838_phase4_bachs_destination_identity.rollback.sql` |
| P4-1 | `20261112185135` | `20261112185135_phase4_bachs_checkout_definite_rejection.sql` | `supabase/migrations/rollback/20261112185135_phase4_bachs_checkout_definite_rejection.rollback.sql` |
| P4-1 | `20261112185545` | `20261112185545_phase4_bachs_checkout_claim_service_auth.sql` | `supabase/migrations/rollback/20261112185545_phase4_bachs_checkout_claim_service_auth.rollback.sql` |
| P4-1 | `20261112185931` | `20261112185931_phase4_bachs_checkout_rejection_status.sql` | `supabase/migrations/rollback/20261112185931_phase4_bachs_checkout_rejection_status.rollback.sql` |
| P4-1 | `20261112193225` | `20261112193225_make_snapshot_tranche_claim_profile_neutral.sql` | `supabase/migrations/rollback/20261112193225_make_snapshot_tranche_claim_profile_neutral.rollback.sql` |
| P4-2 | `20261112201000` | `20261112201000_phase4_lock_bachs_provider_cost.sql` | `supabase/migrations/rollback/20261112201000_phase4_lock_bachs_provider_cost.rollback.sql` |
| P4-2 | `20261112203000` | `20261112203000_phase4_lock_provider_cost_before_route_snapshot.sql` | `supabase/migrations/rollback/20261112203000_phase4_lock_provider_cost_before_route_snapshot.rollback.sql` |
| P4-2 | `20261112204000` | `20261112204000_phase4_preserve_quote_when_locking_provider_cost.sql` | `supabase/migrations/rollback/20261112204000_phase4_preserve_quote_when_locking_provider_cost.rollback.sql` |
| P4-2 | `20261113040509` | `20261113040509_phase4_seed_disabled_bachs_ngn_route_system_audit.sql` | `supabase/migrations/rollback/20261113040509_phase4_seed_disabled_bachs_ngn_route_system_audit.rollback.sql` |

The generated P4-0/P4-1/P4-2 history markers were repaired to the approved
source versions. No schema SQL was rerun during marker repair. Before relying
on rollback as a complete release procedure, add and rehearse a reviewed
rollback for `20261030154721` in a separate change; do not run any rollback on
Production as part of this audit.

## Route and payment state

Read-only Production aggregate after the release:

- Enabled payment routes: **0**.
- Disabled NGN/Bachs route rows: **1**.
- Bachs payout destinations: **0**.
- Orders pinned to Bachs routes: **0**.
- Bachs-snapshotted orders: **0**.
- Orders with Bachs payment rows: **0**.

No live Bachs calls, charges, refunds, payouts, or withdrawals were made.

## Cloudflare branch-build incident and present uncertainty

- `docs/cloudflare-branch-deploy-guard-2026-10-02.md` records that a previous
  non-main Workers Build invoked the web preview command, which at that time
  could run the production deploy. The build was cancelled before deploy; the
  active Worker remained the earlier version.
- Current `main` and `c447285e` share the web build guard. It makes a non-main
  Workers Build build-only/skip and rejects an explicit production deploy from
  a non-main branch. That protects builds using the guarded `cf:preview`
  command.
- This repository check cannot prove Cloudflare's remote Workers Builds
  configuration. In particular, it cannot rule out a dashboard override that
  directly invokes a deploy command or routes non-main branches to Production.
- Wrangler 4.148.0 is installed, but its read-only `whoami` check reports no
  authenticated session. Cloudflare's Workers Builds settings remain pending an
  administrator's read-only review.
- Public-site evidence was collected after merging PR #211 into the Phase 4
  branch and again after pushing the PR #209 conflict-resolution merge: the
  `https://drapeon.co/` response still contained build identifier
  `aP6fiVCxhq-RcspeCosfx`. The prior public-JavaScript comparison found the
  `main` fee label (`Drapeon service fee`) and did not find the branch-only
  `Payment processing` label. This is evidence that those non-`main` branch
  updates did not publish to the live web site; it is not a substitute for a
  dashboard configuration review.

## Dev `payout-account-action` provenance

The currently deployed Dev bundle is not an attested build from `main`.
Comparing its returned files showed a mixed source: the entrypoint and two
Bachs adapters match `c447285e`; `_shared/bachs.ts` matches the older
`de1d9c9b` source; other checked shared files match `main`. Redeploy it from
the merged `main` SHA only after the Production PR is merged, with its own
approved exact release and a recorded source SHA.

## Remaining actions and PR body

1. Obtain Cloudflare Workers Builds read-only access. Confirm Production branch
   is `main` and non-main builds cannot deploy Production. The public-site
   marker above is the interim active-version evidence.
2. Open a PR titled **“Phase 4 P4-2: code already live in Production”**. Include
   this accounting, all 20 deployed functions/versions, the 12 migration
   versions, and the rollback gap above. The current comparison reports merge
   conflicts; review and resolve those before merge, without rewriting history.
3. After founder merge, redeploy the exact 20-function list from merged `main`
   only after separate approval, record the `main` SHA, and verify versions.
   Redeploy Dev `payout-account-action` from that same merged SHA and record it.
4. Keep live money proof and route enablement on hold. Bachs must answer the
   live NG country question, the NGN 50 withdrawal-fee funding must be settled,
   and the controlled one-order amount/recipient/refund plan must be approved.

No Production write or deploy was performed for this accounting review.
