# Phase 3 Production release plan — proposal only

**Status: NOT APPROVED; no Production changes are authorized here.** The target
is Supabase Production `wkfsrunetmgjdtcurmoj`; Dev is
`pqptfuqogvrajozfsqzi`. Reconfirm each target and recheck migration history
before every release unit. All payment routes stay `DISABLED`; this plan does
not enable or provision one.

## Preconditions before the first Phase 3 batch

1. **Reconcile the Phase 1 claim foundation first.** The approved Production
   catalog read confirmed `payout_claims`, `payout_attempts`, and
   `order_payment_refund_claims` are absent, and the approved history audit found
   no versions in the `20261022`–`20261025` range. Do not replay that historical
   directory. Build and Dev-verify a forward-only compatibility repair from the
   final Dev definitions, including all claim guards/RPCs used by the promoted
   Edge code. The previous Production catalog approval was limited to the three
   named tables; any wider read needed to finish that repair requires its own
   scoped approval. No Phase 3 batch should precede this dependency closure.
2. **Resolve Dev migration-history drift.** Dev has the schema objects from
   `20261028023420_payout_claim_ledger_transaction_link` (column, indexes,
   trigger and function), but no corresponding history row. Reconcile that
   exact version using the supported migration-history procedure before
   treating the Dev migration set as promotion-ready; do not rerun ad-hoc SQL.
3. **Run the full local migration replay/rollback rehearsal once before D2.**
   The prior attempt was blocked because Docker is unavailable. Record the
   limitation until a working local Supabase stack completes the rehearsal.
4. **Recheck Dev and Production history before each batch.** A version already
   present, an unexpected definition, or any nonzero route status stops the
   batch. Production migration reads and writes require separate approval.
5. Run each batch through the exact named migration files only, never `db push`
   against the entire pending directory. Preserve user data; prefer a reviewed
   forward repair over dropping schema.

## Candidate Phase 3 migration batches

The 31 Phase 3 Dev versions are ordered by dependency and grouped to at most
five files per approval. These are candidates, not proof that the same versions
are absent in Production. Verify exact history, prerequisites, impact and
definitions at execution time. The Phase 1 forward-repair prerequisite above is
separate and must land first.
If the approved Phase 1 repair consumes any of the same exact migration
versions listed below, remove those versions from the later Phase 3 batches and
reissue the batch grouping before asking for approval; never apply one version
twice or use a different history label to bypass the preflight.

| Batch | Exact Dev versions | Scope / postflight |
|---|---|---|
| P3-1 | `20261028014025`, `20261028014028`, `20261028014031`, `20261028014035`, `20261028014040` | Bachs provider enum; provider-neutral payout/refund foundation and operation guards; checkout/charge identity. Verify constraints, RLS, grants, triggers and existing Phase 1 repairs; no rows or routes should be created. |
| P3-2 | `20261028014044`, `20261028015810`, `20261028021731`, `20261028022550`, `20261028023420` | Single initial-checkout guard, onboarding/account claims, first-transfer review, aggregate onboarding state, payout-ledger receipt. Verify idempotent create/bind, service-only operations, and exact Dev migration history reconciliation. |
| P3-3 | `20261028035153`, `20261028040942`, `20261028041348`, `20261028041901`, `20261028053708` | Bachs staged tranche finalizer; claim-bound refund attempts and identity; provider-operation attempt tracking. Verify provider-confirmed finalization, immutable identities, and RLS/grants. |
| P3-4 | `20261028053938`, `20261028053952`, `20261028054016`, `20261028054237`, `20261028054401` | Link payout attempts to operations, exact-link historical backfill, forward-only outcomes, replacement scope, evidenced late success. `20261028053952` is a data backfill: inspect affected-row counts and exact source/target links before requesting its Production approval. |
| P3-5 | `20261028061641`, `20261028062947`, `20261028063130`, `20261028094246`, `20261028132120` | Claimed route-tranche finalization, Bachs dispute lifecycle, refundable checkout methods, snapshot destination corrections and returned-transfer Ops records. Verify no route is enabled and unsupported methods remain blocked. |
| P3-6 | `20261028132126`, `20261028132406`, `20261028132459`, `20261028132505`, `20261028132557` | Snapshot correction guards, audited apply/reserve functions and FK indexes. Verify service-only access, two-person approval, same-provider/amount/currency constraints and funds-return preconditions. |
| P3-7 | `20261028140403` | Reviewed Bachs refund retries. Verify the refund-claim attempt links, terminal-failure evidence, independent approval checks, fixed keys and service-only reservation. |

After each separately approved batch, verify exact history, schema and grants,
RLS, Advisors, Supabase health, queues/crons, and the batch's Dev-tested
synthetic contract. Do not call Bachs or move money during migration postflight.

## Edge and web release order

After the Phase 1 dependency repair and all approved schema batches are verified,
deploy the exact Phase 3 Edge diff as a separate Production release. The current
candidate entrypoints relative to `origin/main` are:

`bachs-webhook`, `custom-order-action`, `customer-order-action`,
`expire-pending-payments`, `monitor-settlements`, `payment-action`,
`payment-route-availability`, `payout-account-action`, `process-job-queue`,
`ready-made-order-action`, `refund-order-payments`, and
`release-settlement-tranche`.

Recompute that list and all shared dependencies from the final PR head before
asking for approval. Deploy sequentially, preserving each function's existing
JWT setting. Verify versions, webhook ingress behavior, queues, health, and zero
enabled routes; do not create or replay provider operations.

Only after the Edge release and `launch:contracts` pass on the exact final head
should the web PR be merged as its own approval gate. The merge can deploy the
Cloudflare Worker. Check the exact SHA/build and synthetic public health, while
keeping every route disabled. No mobile build is part of Phase 3.

## Proof and release gates

- Dev unit, SQL-contract and type checks are recorded in
  [`payments-phase3-progress.md`](payments-phase3-progress.md). Dev currently has
  zero payment-route rows and zero Bachs destinations.
- The current Bachs API credential is read-only. A write-capable sandbox key
  and webhook signing secret are required for signed collection/refund/transfer
  receipts and the collection-to-withdrawal journey. This is an external proof
  gate, not permission to substitute fake-provider tests for provider evidence.
- Visual QA remains deferred until after all phases, per instruction.
- No Phase 3 Production migration batch, Edge release, or web merge has been
  approved by this document. Every release unit needs its own scoped approval.
- All Production payment routes remain `DISABLED`; route enablement belongs only
  to Phase 4 and requires the previously agreed two-person evidence gate.
