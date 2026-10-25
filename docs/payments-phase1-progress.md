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

## Brick — map payment-status mutation surface before DB guard

- **Evidence:** `markPaymentAttemptStatus` in
  `supabase/functions/_shared/payment-ledger.ts:472-516` updates by provider and
  provider reference without a current-status predicate. It is shared by direct
  confirmations and both provider webhooks. Successful customer refunds also
  write `PARTIAL_REFUND`/`REFUNDED` directly in
  `supabase/functions/_shared/payment-refunds.ts:295-308`; that path then records
  the refund ledger separately. Paystack charge-reversal handling redundantly
  writes `REFUNDED` in `supabase/functions/paystack-webhook/index.ts:878-890`.
  Other order-payment writes found in webhook/refund code update provider
  response or reference metadata, not payment status.
- **Required transition coverage:** ordinary pending attempts need terminal
  success/failure/cancel; the approved late-provider-success exception permits
  `FAILED`/`CANCELED` → `SUCCEEDED`; successful charges may progress through
  `PARTIAL_REFUND` → `REFUNDED` (and may reach `REFUNDED` directly). The future
  database guard must cover all writers, preserve these valid paths, and reject
  stale failure/pending events after success.
- **Tests/evidence:** static call-site and migration inspection only; no behavior
  changed. This does not prove production event history is clean.
- **Gate:** transition enforcement remains an explicit hard stop (Brick 9), and
  local Supabase is unavailable: `supabase status` cannot reach Docker; there is
  no Docker/Podman/Colima runtime installed. No guard migration was created or
  applied. Continue independent code/audit work; do not enforce or apply to Dev
  until the gate and local rehearsal are satisfied.

## Phase 2 preflight — production Stripe country aggregate

- **Scope/evidence:** executed a read-only aggregate against Supabase project
  `wkfsrunetmgjdtcurmoj` (`Drape-PROD`), grouping distinct values from the saved
  legacy Stripe account fields by stored `tailor_profiles.payout_country_code`.
  It found **two distinct account-shaped IDs with profile country `US`** (four
  repeated field references across the two old columns) and **two distinct
  placeholder-shaped values with `UNKNOWN` country**. No account IDs, user IDs,
  emails, or other profile details are recorded here.
- **Route disposition:** US is the only profile-indicated candidate Stripe
  destination country; its route is provisionally `SANDBOX_ONLY`, and all other
  destination countries stay `DISABLED`. No route is enabled for checkout.
  Stored profile country is not proof of the connected account's true country or
  transfer/payout capability. No destination rows, provider settings, or route
  state were changed.
- **Blocked verification:** local Stripe CLI startup was blocked while it tried
  to change permissions on its protected config; the browser-control surface
  timed out twice. No current API capabilities were fetched, so this
  check remains open. Do not copy these profile IDs into destination records.
- **Estimate:** Phase 2 remains about **7–10 engineering days after Phase 1
  review/landing** (about 60–70% of greenfield) because existing resolver,
  snapshot, payout setup and status surfaces are to be extended, not duplicated.

## Current-main candidate validation — test reliability and launch gate, 2026-10-25

- **Exact stop state:** current-main reconciliation candidate is
  `/private/tmp/drape-phase1-reconcile-20261025`, branch
  `codex/payments-phase1-main-reconcile`, at `399c95ed0aac22d3722042555892feed403529cd`.
  It was clean before this validation follow-up, 21 commits ahead of recorded
  `origin/main` `04e984a771358fc18c32d8f197ca2f2e364c8667`, with 10 changed paths
  and no migration or web-app file. No PR exists. The unrelated broader hardening
  worktree and its `deno.lock` edit were not modified.
- **Test finding/fix:** the first full Edge run hit the existing reauthentication
  tamper test's last-character Base64URL ambiguity (a different final character
  can decode to the same HMAC bytes). The assertion now changes a significant
  signature character. This is test-only; no runtime behavior changed.
- **Verification:** full Edge suite **224 passed / 0 failed** after the fix;
  focused Deno check and `git diff --check` passed. The required
  `scripts/launch-contract-check.mjs` was attempted with bundled Node **24.19.0**.
  It stopped at `@drape/studio` because this isolated worktree has no installed
  dependencies (`esbuild` missing). Two frozen offline installs were attempted;
  pnpm 11 could not resolve offline registry metadata for `@dotenvx/primitives`,
  and repository-pinned pnpm 10 could not obtain the locked
  `wrangler@4.126.0` tarball. No lockfile change was made. Do not push/open the
  PR until the launch-contract gate passes.
- **Schema state:** this candidate adds no migration, and none was applied
  locally or to Dev on its behalf. Local Supabase remains unavailable at
  `127.0.0.1:54322`. A read-only Dev migration listing reports 835 history
  entries through `20261025211537`; compared with the separate broad hardening
  checkout, 16 Dev versions have no matching local file and 2 local files are
  absent from Dev. This mismatch is not repaired here; no new Dev migration is
  safe to apply until the history is reconciled and local rehearsal is available.
- **Next:** restore a lockfile-matched dependency install / run launch contracts,
  then review and open the small Phase 1 PR. Phase 2 implementation still waits
  for that PR to be reviewed and landed. No production query, write, deployment,
  route change or provider operation occurred in this validation follow-up.

## Clean stop checkpoint — 2026-10-25

- **Branch/commit:** `codex/payments-phase1-main-reconcile`,
  `16e27fbf9ece53ed7ff1d2864f518c058871e669`, 22 commits ahead of the recorded
  `origin/main` `04e984a771358fc18c32d8f197ca2f2e364c8667`.
- **Worktree:** clean after this checkpoint commit; no `deno.lock` change. The
  separate broad hardening worktree still has its unrelated `deno.lock` edit and
  was not touched. No PR is open.
- **Migrations:** this current-main candidate contains no migration and applied
  none locally or to Dev. Local DB is unreachable at `127.0.0.1:54322`. Dev's
  read-only history has 835 entries through `20261025211537`; the separate broad
  hardening checkout has 16 Dev-only versions and 2 local-only migration files.
  No migration was found partly applied by this candidate; the cross-branch
  history discrepancy remains unresolved and blocks any new Dev migration.
- **Verification:** full Edge suite 224/224; focused tamper test 4/4; focused
  Deno check and diff check pass. Launch-contract remains blocked on offline
  package availability (`wrangler@4.126.0`); no push or PR yet.
- **Phase 2:** current-main inventory classifies the existing shared resolver
  and `orders` snapshot as EXTEND; duplicate SQL resolver as RETIRE/REDIRECT;
  current payout setup/status and account-withdrawal surfaces as EXTEND. Exactly
  one resolver and one snapshot remain the target. Estimate remains 7–10
  engineering days (60–70% of greenfield) after Phase 1 is reviewed and lands.

## Launch-contract unblock — payment recovery status type, 2026-10-25

- **Finding/fix:** the full Edge typecheck exposed that `payment-recovery.ts`
  omitted `PARTIAL_REFUND` from its accepted payment status union, even though
  `payment-action` passes the persisted `PaymentStatus`. Added that member and a
  regression assertion. The helper still replaces only `FAILED`/`CANCELED`; a
  partially refunded attempt stays non-replaceable. No money or order behavior
  changed.
- **Verification:** focused test **4/4** and focused Deno typecheck passed. The
  full launch-contract gate passed under Node **24.19.0** / pnpm **10.32.1**:
  studio build, release contract, mobile/web/ops checks, shared Jest
  **744/744**, and all Edge entrypoint typechecks. Existing lint reported
  warnings but zero errors. Full Edge unit suite remains **224/224**.
- **Lockfile hygiene:** frozen dependency install did not change package lock;
  Deno check generated one `deno.lock` package-manifest line, which was removed
  because lockfile changes are outside this candidate. Verify clean lock status
  before commit.
- **Next:** review the final source diff, commit this type-compatibility brick,
  then open the small Phase 1 PR. No migration, Dev or production write, Edge
  deployment, provider call, route change, or live customer-facing behavior
  changed in this step.

## Superseding checkpoint and duplicate-path guard gap — 2026-10-25

- **Exact candidate stop:** isolated candidate
  `/private/tmp/drape-phase1-reconcile-20261025`, branch
  `codex/payments-phase1-main-reconcile`, HEAD
  `a09986d59cc6178f25639c89c4a0f179e39c6fa1`, 23 commits ahead of recorded
  `origin/main` `04e984a771358fc18c32d8f197ca2f2e364c8667`. No PR exists.
- **Uncommitted files at checkpoint:** recovery-status type + regression test,
  this progress-log correction, the amended Phase 2 routing inventory, and a
  new draft guard migration plus rollback. No unrelated `deno.lock` edit. The
  separate broad hardening checkout and main checkout were not changed.
- **Migration state:** `20261025231356_prevent_mixed_order_earning_and_tranche_payouts.sql`
  and its rollback are drafts only. No migration from this candidate has been
  applied to local Supabase or Dev; none is partially applied. Local rehearsal
  is blocked because Docker daemon is unavailable and local Postgres on
  `127.0.0.1:54322` refuses connections. Dev migration history was not modified.
- **Why the migration is needed:** source review confirmed the existing
  `payouts_settlement_tranche_unique` only prevents duplicate active rows for a
  single tranche; it does not prevent a same-order `ORDER_EARNING` row alongside
  one or more `SETTLEMENT_TRANCHE` rows. The shared release decision routes by
  policy, but the previously approved database backstop is absent. No history
  backfill or payout mutation is included in this draft.
- **Verification at checkpoint:** recovery helper test 4/4; focused Deno check
  for `payment-action` passed; `git diff --check` passed. Full launch-contract
  passed earlier in this work session after dependency install; full Edge suite
  224/224. The new database guard has not been behavior-tested.
- **Phase 2 amendment:** routing inventory now makes the retire/redirect list
  explicit and re-estimates reuse at 7–10 engineering days (about 60–70% of
  greenfield), after Phase 1 review/merge. Exactly one shared route resolver and
  the existing `orders` snapshot remain the target; no second route/snapshot is
  to be introduced.
- **Additional resolver audit:** a second currency-to-provider switch was found
  inside `packages/shared/src/payout-gating.ts:19-28`. The initial inventory
  mentioned only the exported `currency-config` resolver and SQL function; this
  private duplicate must be removed/redirected with the other resolver callers
  so Phase 2 ends with exactly one route resolver. The inventory now lists all
  20 source files for migration review.
- **Next safe work:** commit the independently verified TypeScript/test brick;
  keep the unverified migration draft uncommitted until a local DB is available.
  Continue independent Phase 2 design/audit work only; Phase 2 code waits for the
  Phase 1 PR to be reviewed and merged. No Dev/production migration, deployment,
  provider setting or route state changed.

## Post-amendment working checkpoint — 2026-10-25

- **Committed bricks:** `fc7b0171` (partial-refund attempt type compatibility
  and regression coverage), `e2045eaf` (explicit Phase 2 retirement/estimate
  map), and `7914dee4` (resolver duplicate and 20-caller inventory). Current
  branch tip is `7914dee4`, 26 commits ahead of recorded `origin/main`; no PR.
- **Current dirty state:** only the new duplicate payout-path migration and its
  rollback are untracked drafts. No staged files or other tracked edits. They
  are intentionally not committed because this machine has no Docker runtime,
  `supabase start` cannot connect to the Docker socket, and local Postgres
  refuses `127.0.0.1:54322`.
- **Database certainty:** no migration from this candidate has been applied to
  local or Dev; none is partly applied. Dev history was not changed in this
  continuation. Production was not accessed.
- **Verification:** the partial-refund regression test passed **4/4**, focused
  `payment-action` Deno typecheck passed, and `git diff --check` passed. Earlier
  in this session the full Edge suite passed **224/224** and the full
  launch-contract gate passed. The drafted SQL guard itself remains untested.
- **Phase 2 audit:** the 20 call-site list is verified by source search and now
  includes the private duplicate switch in `payout-gating.ts`. Phase 2 estimate
  is **7–10 engineering days (60–70% of greenfield)** after Phase 1 review and
  merge. No Phase 2 code branch has been created, as required by the sequencing.
- **Remaining Phase 1 closure:** the DB-enforced order payout-path exclusion is
  missing from current main and awaits local migration rehearsal. The broader
  claim/RPC dependency closure, active fabric worker wakeup, refund-side charge
  allocation and two-session race proof remain unreconciled into this 13-path
  current-main candidate; this checkpoint does not claim Phase 1 complete or
  signoff-ready. Continue their static dependency review without copying the
  old hardening branch wholesale. No production release approval is implied.

## Exact stop and amended Phase 2 estimate — 2026-10-25

- **Checkout:** `/private/tmp/drape-phase1-reconcile-20261025`; branch
  `codex/payments-phase1-main-reconcile`; HEAD
  `10ada0a10a10823ecf421f91215ceb398e3689fd` (`10ada0a1`), 27 commits ahead of
  recorded `origin/main` `04e984a771358fc18c32d8f197ca2f2e364c8667`. No PR.
- **Uncommitted state:** no staged files. The routing inventory and this
  progress log and the two provider webhook entrypoints have tracked edits for
  the revised estimate/checkpoint and attempt-authoritative classification;
  there is no remaining `deno.lock` diff after removing the Deno-generated
  `knip` entry. Six untracked files remain:
  `packages/shared/src/money-units.ts`, its test,
  `supabase/functions/_shared/payment-webhook-attempt.ts`, its test, and the
  `20261025231356_prevent_mixed_order_earning_and_tranche_payouts` migration and
  rollback drafts. The helper is now wired into the Stripe and Paystack signed
  charge event paths, including the non-initial ADJUSTMENT path; the SQL guard
  is untested. The webhook brick still needs integrated database/provider
  evidence and is not claimed as finished.
- **Migration state:** no migration from this candidate has been applied to
  local Supabase or Dev, and none is partly applied. Local Supabase is not
  available: Docker's daemon socket is unreachable, so there is no local DB to
  apply to. The read-only Dev migration inventory reports 835 entries, latest
  `20261025211537` (`20261025211441_restrict_legacy_ops_resolve_dispute`); the
  candidate guard version `20261025231356` is absent. No production database was
  accessed or changed.
- **Checkpoint verification:** webhook entrypoints pass `deno check --no-lock`;
  the money-unit and webhook-identity tests pass **9/9** after adding coverage
  that an unreconciled later Stripe dispute event preserves known linkage and
  cannot unblock money. A broader Edge unit
  subset passed **216/216** with explicit environment permissions and two
  unrelated env/read-dependent test files excluded. The all-files exploratory
  run reported 226 passed / 4 permission-related failures before those
  constraints were isolated. No Dev/provider integration proof is claimed.
  `supabase status` confirms local Docker unavailability.
- **Phase 2 amendment:** this is a redesign of the existing currency resolver,
  payment-currency foundation, `orders` snapshot, payout setup, provider status,
  and Ops money surfaces—not a parallel route/snapshot build. The inventory
  classifies them as extend, replace/redirect, or retire and explicitly requires
  exactly one resolver plus the existing `orders` snapshot. Estimate revised
  from 7–10 to **6–8 engineering days (about 45–55% of greenfield)** after Phase
  1 review/merge; exclusions and work split are in the inventory document.
- **Unchanged release boundary:** Phase 1 still needs the payout-path migration
  rehearsed locally and a reviewed PR before Phase 2 code branches from updated
  main. No Dev or production migration, Edge deployment, provider setting, or
  route enablement occurred here.

## Attempt-authoritative webhook work — in progress, 2026-10-25

- **Changed:** added exact currency/minor-unit helpers; Stripe and Paystack
  signed charge events now classify order and phase exclusively from the linked
  `order_payments` attempt. Optional provider metadata is only checked for
  consistency; unknown/mismatched attempts and missing linked orders create a
  Money Desk review case and never advance an order. `ADJUSTMENT` outcomes sync
  against the attempt but do not advance the base order. Paystack reversals no
  longer clear escrow markers for adjustments. Stripe disputes now associate
  only through a matching attempt with the same currency and a dispute amount no
  greater than capture; unmatched/mismatched disputes are recorded and routed
  to review instead of trusting dispute/charge metadata. A later unreconciled
  Stripe dispute update preserves its prior known association and remains
  money-blocked rather than nulling linkage or reopening settlement.
- **Verification:** Stripe and Paystack Edge entrypoints pass `deno check
  --no-lock`; targeted money-unit, webhook-identity, and dispute-link tests pass
  **9/9**. A broader Edge unit subset passed **216/216** after this final
  dispute-association refinement (two env/read-dependent
  suites excluded; environment permissions explicitly scoped and Sentry DSNs
  unset). `git diff --check` passes. No webhook was invoked against Dev and no
  provider call was made.
- **Launch contract:** one run on system Node 18 stopped at the repository's
  Node-22-only `--experimental-strip-types` option. A rerun with bundled Node
  24.19.0 was aborted at pnpm's dependency preflight because it wanted to remove
  the existing modules directory without a TTY; no purge/install occurred. The
  full launch gate is therefore not re-verified for this working diff.
- **Not finished:** webhook changes are uncommitted and need cross-event
  integration evidence plus review. Database transition enforcement, duplicate
  payout-path migration rehearsal, active fabric worker, refund-side allocation,
  and real two-session race evidence remain open. The Dev and production
  database states described above are unchanged.

- **Additional full-edge check:** the exploratory all-entrypoint `deno check`
  still fails only at the unrelated, unmodified
  `supabase/functions/saved-tailor-action/index.ts:210` payload-union type
  error. Excluding that file, the remaining entrypoints typecheck; the two
  payment webhooks were checked directly after the latest patch. The full
  launch contract remains unverified for this diff.
- **Commit attempt:** no files are staged and no commit was created. Git cannot
  write its external managed-worktree metadata at
  `/Users/onaopemipodimowo/drape/.git/worktrees/drape-phase1-reconcile-20261025/index.lock`
  in this sandbox (`Operation not permitted`). No history was rewritten and no
  other worktree was touched.
