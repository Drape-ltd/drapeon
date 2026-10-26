# Phase 1 current-main reconciliation scope

Date: 2026-10-25. Base: `origin/main` `04e984a771358fc18c32d8f197ca2f2e364c8667`.

This is a candidate scope for a reviewed Phase 1 PR, not a migration allowlist, rollout approval, or claim that the code has been ported/tested. Nothing is deleted from the source hardening branch.

## Production evidence used to re-scope

The last founder-approved production aggregate found **0 payment-attempt rows, 0 payout rows, and no recorded payment refunds**. It found two unpinned quotes. That means there is no observed money/order history to repair; it does not prove future paths are safe. Production profile inventory separately found four saved Stripe IDs (two syntactically plausible, two demo-shaped) and four Paystack recipients.

A read-only Live Dashboard recheck (2026-10-25) found three US connected accounts: two profile-bound destinations and one QA-only account. Both profile-bound accounts are Restricted, with Payouts and Transfers paused, overdue requirements, and no external bank destination. The QA-only account is also restricted and is excluded from production destination readiness. Therefore **US is the only production Stripe destination country found, but there are zero capability-ready production Stripe destinations**. Dashboard inspection is not the required API capability read; do not create a canonical destination record or enable a route until current Stripe API capabilities are rechecked. The separate US Sandbox recipient has test Transfers/Payouts enabled and a `$1` test-bank payout marked Paid; this is Sandbox-only evidence and does not make a production destination ready.

## Keep in the forward-only candidate

These protect future accepted work and stay in scope:

1. **Payout-path exclusivity:** route by the accepted order's policy snapshot; prevent ordinary earning and staged-tranche paths from both claiming the same order; block staged residual double payment until tranche-aware math exists. Candidate source commits include `aafa5973` and `25555d0f`.
2. **Active fabric release worker:** wake/process eligible fabric claims instead of leaving them inert. Candidate source commit `9f85fe4f`.
3. **Refund-side allocation/reservation:** pin the exact funding charge/position before provider calls, prevent refund and release from consuming the same value, and preserve one stable claim/key. Candidate source chain includes `079e4a4b`, `41cc00b3`, `13c6dbb6`, and `a4deb8c7`; review all dependencies before porting.
4. **Two-session race proof:** retain the Dev-tagged QA race fixture and run the competing claims in two independent sessions. Candidate fixture commit `6567369e`; fixture data must remain tagged and must not notify real recipients.
5. **Release gates:** keep Dev-first migration/rollback rehearsals, exact Edge-bundle review, web/schema compatibility checks, post-release observation, and the separate approvals for any production migration, Edge deployment, or status enforcement.

## Defer from this PR; do not delete

- **Historical backfills:** no accepted production orders or captured production payments were observed, so defer migrating old historical rows into new claim, booking-link, source-position, or destination-snapshot structures. New orders still must be snapshotted; new records still fail closed when required identity is missing.
- **Historical ambiguity remediation:** defer bulk matching/repair and one-off Ops cases for old unmatched/ambiguous payment, consultation, fabric, or payout rows. Keep runtime handling for a future unmatched or conflicting provider event: preserve the evidence and stop automatic money movement.
- **Legacy-policy compatibility for newly accepted orders:** do not add a fallback that guesses the policy when a new order lacks a snapshot. New acceptance must stamp the policy and required route/earning identity; fail closed otherwise. Existing historical orders, if any arise from QA or later discovery, remain on their recorded path rather than being rewritten.
- **No general deletion of old provider readers in Phase 1.** Phase 2 will remove Paystack from new checkout/recipient creation while retaining the explicitly inventoried historical/test readers until the wind-down condition is met.

The scope change is exclusion from the current-main PR only. The original branch and its history remain untouched. This document adds no production query or provider call; the separate count-only saved-destination query performed this turn was within the approved Phase 2 check. No production mutation, migration rollback, or deployment is implied here.

## Remaining work and estimate

The old Phase 1 branch is **not** a PR source: its current diff is 987 paths, ahead/behind history is divergent, and it contains unrelated work. This candidate still requires dependency review, clean current-main code reconciliation, focused tests, local Supabase migration/rollback rehearsal, Dev application/readback where appropriate, and a review of web code against both old and new schema.

Re-scoped planning estimate: **not yet responsibly estimable**. A first dependency scan found that current `origin/main` has no payout-claim foundation and that the old branch contains 263 broadly payment-related candidate migrations across the hardening window. That is not proof all 263 are required; it does mean the earlier 1–2 day estimate is withdrawn. First derive the minimal semantic schema/Edge dependency set for the retained future-order protections, then estimate the current-main PR from that exact set. Do not expand into historical backfills or unrelated Ops/UI bundles silently.
