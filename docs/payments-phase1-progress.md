# Phase 1 current-main reconciliation progress

Date: 2026-10-25. Candidate branch: `codex/payments-phase1-main-reconcile`.
Base: `origin/main` at `04e984a771358fc18c32d8f197ca2f2e364c8667`.

This is a running record for the re-scoped Phase 1 candidate. The original
`codex/payments-phase1-hardening` branch and its unrelated `deno.lock` change are
not modified by this work.

## Exact handoff checkpoint — 2026-10-25

- **Reconciliation checkout:** `/private/tmp/drape-phase1-reconcile-20261025`,
  branch `codex/payments-phase1-main-reconcile`, HEAD
  `6907e50e` (`docs(payments): record dev claim schema read`), based on
  `origin/main` `04e984a7`. Worktree is clean; branch is 9 documentation commits
  ahead of `origin/main`. No PR exists yet.
- **Original hardening checkout:**
  `/Users/onaopemipodimowo/Documents/Codex/2026-10-21-payments-phase1-hardening`,
  branch `codex/payments-phase1-hardening`, HEAD `4b2a148d`; it remains 793 ahead
  and 34 behind `origin/main`, with one pre-existing modified `deno.lock`. That
  unrelated change was not edited, staged, committed, stashed, or discarded.
- **Migration state:** this reconciliation checkout did not apply, roll back, or
  partially apply any migration to local Supabase or Dev. Local applied state is
  **unknown** because the Docker-compatible runtime is unavailable and
  `supabase status` cannot connect. Dev has pre-existing Phase 1 schema/migration
  state from the hardening work; this pass only read Dev catalog metadata and
  applied no migration. A previous attempt to create a local migration stub was
  immediately removed before any SQL was written or applied. Production was not
  queried or changed in this pass.
- **Next work:** continue semantic migration/runtime dependency classification
  for the retained future-order protections; do not copy the old branch wholesale.
  Phase 2 remains explicitly a redesign of the existing resolver and `orders`
  snapshot, with no second routing system. Its current reuse-based estimate is
  7–10 engineering days after Phase 1 review/landing (about 60–70% of greenfield
  effort), excluding legal/provider onboarding.
- **Reconciliation sizing check:** a fresh path-level diff of the original branch
  against `origin/main` confirms 336 added migration paths and a wide runtime
  footprint, including 179 `supabase/functions/_shared` paths, 29 shared-package
  source paths, 20 web feature paths, and 12 mobile route paths. This validates
  that "small PR" cannot mean copying the branch or selecting migrations by
  filename. The retained protections still need a semantic allowlist and a clean
  current-main implementation slice; no source or migration was copied in this
  checkpoint.
- **RPC definition lineage (source-branch static trace):** the payout state machine
  has a table/constraint foundation (`20261022003751`), reservation/start/outcome
  RPCs (`20261022003918`, `20261022004047`, `20261022004202`), and material
  corrections to late-success/retry behavior (`20261022004324`, `20261022030234`,
  `20261022033751`) plus the replay-before-insert correction
  (`20261023041814`). The order-earning and fabric-candidate reservation RPCs
  have later corrected definitions (`20261022022256`, `20261023014834`); the
  fabric funding reservation also has a later candidate-state guard
  (`20261023031200`). Refund serialization's final definitions are
  `20261023011502` and `20261023012757`, not just the initial refund-claim
  migrations; fabric charge-position reservations begin at `20261023032930`.
  These versioned redefinitions are a hard dependency, not optional historical
  backfills. This narrows the initial RPC lineage but is **not yet** the full
  migration closure: dependent table/trigger/index definitions, all money-phase
  reservation RPCs, scheduler grants, verification cases, and the corresponding
  Edge code still need review before a PR allowlist is safe.

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
  safety. `supabase status` cannot inspect local migration state because Docker is
  unavailable (`Cannot connect to the Docker daemon`); therefore local applied
  migration state is **unverified**, not assumed empty. This pass did not start a
  local stack or partially apply a migration to local or Dev.
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
- **Dependency scan:** the old branch has 263 migrations with payment/payout,
  claims, fabric, funding, refund, settlement, or residual terms in their names
  across the four hardening days. This is a deliberately broad filename count,
  not the minimum dependency set or a proposed promotion list; many are verifiers
  and later corrections. It proves the old “1–2 days” candidate estimate is too
  optimistic until semantic dependency tracing identifies a smaller forward-only
  subset. No source files were copied or deleted.
- **RPC dependency trace (source branch):** the retained claimed fabric release
  path calls `reserve_fabric_candidate_payout_row`,
  `reserve_fabric_claim_funding_positions`, and the generic payout-claim/attempt
  RPCs; the refund path calls `reserve_order_payment_refund_claim`,
  `capture_order_payment_refund_claim_context`, and
  `reserve_fabric_refund_charge_position`. Their initial definitions are in
  `20261022024828`, `20261023031011`, `20261022233900`,
  `20261023001653`, and `20261023032930` respectively, with later corrections
  (`20261023014834`, `20261023031200`, `20261023011502`,
  `20261023012757`) that are part of the final Dev-tested behavior. The generic
  claim table foundation is `20261022003751`, with reserve/start/outcome RPCs at
  `20261022003918`, `20261022004047`, and `20261022004202`, then late-success
  and replay corrections. A simple cherry-pick of the payout-policy guard is
  therefore insufficient. The TIP two-session fixture also depends on this
  claims/refund state machine. This is still a first-hop trace; deeper transitive
  review and exact verifier coverage remain open.
- **Symbol-reference pass:** a source-branch search for shared claim RPCs, claim
  tables, fabric funding positions and order-work positions finds **126** unique
  migration files referring to at least one of those symbols. This overcounts
  the retained scope because it includes consultation, adjustment, payout
  replacement and staged-residual hardening; it is not a minimal migration list.
  It confirms the candidates cannot be reduced by simply cherry-picking four
  top-level feature commits. A safe reduction needs per-reference classification
  and a final-schema comparison against current-main prerequisites.
- **Dev schema read (metadata only):** inspected the Dev catalog for the claims,
  refund-claim and funding-position tables, their columns and indexes, plus the
  matching RPC signatures. The expected claim and funding tables/RPCs exist in
  Dev; payout claims have unique business-key, source-kind/source-id,
  idempotency-key and payout-link indexes, while fabric funding has per-charge
  unique payout/refund allocation indexes. Two allocation RPCs are marked
  `SECURITY DEFINER`, so exact execute grants and body/search-path controls
  belong in the migration review. This confirms the deployed Dev end-state shape,
  but not that all 126 migrations are needed or safe to replay from current main.
  Read-only schema catalog only; no business rows or mutations.
- **Next:** Continue the transitive trace from these first-hop RPCs to every table,
  trigger, ledger finalizer, verification migration and runtime caller for the four
  retained workstreams. Compare final migration bodies with current `main` and the
  Dev-applied branch; then choose either (a) a genuinely small reconciled forward
  subset, or (b) a deliberately consolidated, newly reviewed migration sequence
  with explicit rollback and tests. Do not mechanically copy all 263 candidates.
  No migration was partially applied to local or Dev by this pass.
