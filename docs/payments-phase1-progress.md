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
- **Active fabric worker closure (verified against current `origin/main`):**
  `fabric-workflow-action` already inserts durable `PROCESS_FABRIC_RELEASE` jobs,
  and `process-job-queue` already dispatches them to the fabric release worker.
  The existing `20260826213000_event_driven_money_job_wakeup.sql` only wakes
  webhook and tip jobs, so these fabric jobs can remain inert. The source branch's
  focused fix is `20261025110952_wake_fabric_release_jobs.sql`: add a separate
  fabric-only insert trigger, include fabric in the existing five-minute bounded
  recovery function, and add an assertion-only verifier. It adds no new cron
  schedule. Its rollback removes only that trigger and restores the known
  pre-fix filters (therefore reintroducing the fabric stall); this is an emergency
  rollback, not a steady-state choice. This is a comparatively isolated future-
  order protection, but it is not copied or committed because the required local
  Supabase migration/rollback rehearsal cannot currently run without Docker.

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

## Brick — ordinary payout path uses the accepted policy snapshot

- **Changed:** `release-order-payouts` now selects and evaluates
  `orders.commercial_policy_version` before paying. The ordinary full-earning
  path proceeds only for an explicit `legacy-single-release-72h` snapshot; staged
  orders are skipped by this path, and missing/unknown policies fail closed into
  Money Desk review. Added a focused policy-classification unit test. This is the
  first runtime slice of payout-path exclusivity; the database-level claim guard
  and staged residual block are still required before the invariant is complete.
- **Tests/checks:** focused Deno test **1/1 passed**;
  `deno check --no-lock --sloppy-imports
  supabase/functions/release-order-payouts/index.ts` passed; `git diff --check`
  passed. Reviewed the diff against the recorded policy: routing uses the order's
  accepted snapshot, no fresh policy lookup, no payout amount/schedule changes.
- **Dev evidence:** none for this brick. No Dev rows, migrations, provider calls,
  or Edge deployments were changed. The `commercial_policy_version` column is
  already present on current main (foundation migration
  `20260731140000_commercial_ledger_pricing_foundation.sql`); Dev runtime behavior
  remains unverified until a compatible Phase 1 slice is rehearsed and deployed.
- **Open:** add database-enforced mutual exclusion between ordinary earning and
  staged tranche claims, block unsafe staged residuals, and exercise the worker
  with a Dev fixture. This code change is committed only after the focused test
  and typecheck pass; it is not a release-ready Phase 1 PR by itself.
- **Follow-up testability refinement:** extracted the worker's actual decision
  (`RELEASE`, `SKIP_STAGED`, or `REVIEW`) into the shared pure policy helper so
  tests cover staged orders even when a recovery request is supplied and ambiguous
  policies, not merely the policy label. Focused tests now pass **2/2** and the
  worker typecheck passes; the full Edge suite passes **220/220** after this
  refinement. No behavior beyond the original guard changed.

## Brick — repair current-main Edge test fixtures and policy assertion

- **Changed:** aligned the Ops money-policy test with the implemented least-
  privilege rule (finance prepares; admin decides/executes), and gave the refund
  unit-test Supabase double a deterministic `current_ops_environment` RPC result.
  The earlier full-suite run on this branch had **216 pass / 3 fail**; the failures
  were stale test expectations and a missing RPC on the mock, not runtime failures.
  No production behavior changed.
- **Tests/checks:** focused Ops/refund tests **11/11 passed**; full Edge suite
  `deno test --no-lock --allow-all --sloppy-imports supabase/functions`
  **219/219 passed**. The run typechecked test files; `git diff --check` passed.
- **Dev evidence:** none; no database or provider calls.
- **Review/scope:** test-only reconciliation against the existing Ops policy and
  `ops-issues` environment contract. No design deviation or user-money behavior
  changed.

## Phase 2 inventory correction — preserve account-level withdrawal model

- **Evidence:** current-main migration
  `20260818100000_provider_settlement_lifecycle.sql:1-110` already separates
  `payouts.provider_transfer_status` from bank settlement and provides
  `provider_payout_events`; its table comment explicitly says unlinked Stripe
  auto-payout events are account-level, not an order payout completion. The
  current UI/monitor/webhook readers use this event model.
- **Design update:** the Phase 2 inventory now says to extend this same event
  stream and provider-status surfaces, not create another withdrawal ledger.
  New Stripe/Bachs earnings end at the provider balance; account withdrawals
  remain per tailor account. Any per-order bank-status reader for these providers
  is retired/redirected to `NOT_APPLICABLE`; direct-to-bank Paystack status remains
  historical-only during wind-down.
- **Checks:** source and migration line inspection; `git diff --check` passed.
  Documentation only; no provider, database, or source runtime behavior changed.

## Brick — preserve payment-attempt identity on checkout retry

- **Changed:** `upsertPreparedPaymentAttempt` no longer overwrites accepted order,
  phase, currency, amount, or a terminal payment status when a provider-reference
  or idempotency-key retry collides. It reuses only an INITIATED/PENDING attempt
  with an exact identity match, reports mismatches to Money Desk, and uses a
  conditional one-way provider-reference bind so concurrent retries cannot
  replace one another's provider ID. This does not replace the required database
  forward-only status rule or harden `markPaymentAttemptStatus` yet.
- **Tests/checks:** focused attempt tests **4/4 passed**; focused file typecheck
  passed; full Edge suite **224/224 passed**; `git diff --check` passed.
- **Dev evidence:** none. No migration, Dev row, provider call, or deployment was
  changed. The local Supabase runtime is unavailable, so no migration was partly
  applied locally by this candidate.
- **Review/open:** exact payment identity is preserved and terminal retries are
  no-ops. Remaining work: database-enforced status transitions, review of all
  status writers/webhooks, and Dev verification once the migration can be
  rehearsed locally. No money amounts or payout schedule changed.
