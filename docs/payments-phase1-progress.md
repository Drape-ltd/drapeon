# Phase 1 current-main reconciliation progress

Date: 2026-10-25. Candidate branch: `codex/payments-phase1-main-reconcile`.
Base: `origin/main` at `04e984a771358fc18c32d8f197ca2f2e364c8667`.

This is a running record for the re-scoped Phase 1 candidate. The original
`codex/payments-phase1-hardening` branch and its unrelated `deno.lock` change are
not modified by this work.

## Reconciliation preflight — docs complete; implementation scope unresolved

- **Changed:** Added the Phase 1 current-main re-scope and Phase 2 existing-routing
  redesign inventory. The Phase 2 inventory classifies the shared currency resolver
  and existing `orders` payout snapshot as **extend**, the duplicate SQL resolver
  as **retire/redirect**, existing payout setup/status surfaces as **extend**, and
  Paystack new-recipient creation as **retire**. It defines one canonical resolver
  and one order snapshot; it does not create a parallel routing system.
- **Tests/checks:** `git diff --check` passed; branch status clean after commits.
  These are documentation-only commits; no application test or typecheck was
  applicable.
- **Dev evidence:** No migration, Edge deployment, provider call, or database
  mutation was performed in this reconciliation pass. Earlier Dev history had
  835 versions through `20261025211537`; that history is not proof of production
  safety. No local Supabase stack was started.
- **Production evidence:** Previously approved count-only aggregate found no
  payment attempts, payouts, or recorded payment refunds. Saved Stripe account
  country/capability verification remains unavailable; no destination records
  were created.
- **Design/scope:** Historical backfills and old ambiguous-row remediation are
  deferred; future unmatched/conflicting provider events must still fail closed.
  `deno.lock` stays out. No production release authorization is implied.
- **Blocker discovered:** Current `origin/main` has no `payout_claims` or
  `payout_attempts` foundation. The future-order protections retained by the
  re-scope (payout-path exclusivity, fabric funding reservations and race-safe
  release/refund claims) depend on that claims layer and a large sequence of
  follow-on SQL/Edge changes from the old branch. The old branch adds 335
  migrations and 987 paths overall; it is not a safe PR source. A small, reviewed
  current-main PR has not yet been established. Do not cherry-pick feature-tip
  commits without resolving their schema and Edge dependency graph.
- **Next:** Build an exact minimal dependency manifest for the approved future
  protections from the old branch, starting with the claims foundation and the
  four retained workstreams. If the minimum is not a small/reviewable release
  unit, report the measured dependency set and recommendation instead of silently
  expanding the PR. No migration was partially applied to local or Dev by this
  pass.
