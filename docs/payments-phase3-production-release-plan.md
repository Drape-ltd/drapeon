# Phase 3 Production release plan — proposal only

**Status: P3-0 through P3-13, P3-TIP, and P3-23 through P3-30 SQL and source
migration-history versions are present in Production. The separately approved
forward-only refund-claim trigger repair `20261028214803` is also verified.
The broader Phase 1 guard/function parity repair remains before the Phase 3
money Edge release.** The
target is Supabase Production `wkfsrunetmgjdtcurmoj`; Dev is
`pqptfuqogvrajozfsqzi`. Reconfirm each target and recheck migration history
before every release unit. All payment routes stay `DISABLED`; this plan does
not enable or provision one.

## P3-3 refund-claim trigger repair gate

The P3-1 Production foundation restored `order_payment_refund_claims` without
the historical Phase 1 identity/status trigger attachments. P3-3 updated the
status guard body but did not attach it. The scoped Production catalog audit
found zero triggers on that table, versus both required guards in Dev. Apply
the separately reviewed, Dev-tested forward-only
`20261028214803_phase3_refund_claim_trigger_forward_repair.sql` as its own
release before P3-4. Verify both enabled trigger names and function bindings,
no client execute privileges, exact source migration version, Advisors, health,
queues, and zero enabled routes. Production application was separately approved
and verified on 2026-10-28; do not apply it again. P3-4 through P3-30 were
subsequently approved, applied and verified; do not replay them.

## Final claim-trigger parity gate before the Phase 3 Edge release

The 2026-10-28 Production-shaped local rehearsal exposed missing Phase 1
funding-position and adjustment-claim tables beneath the missing trigger
bindings. The scoped Dev/Production catalog audit found ten Dev-only tables
and 124 Dev-only function signatures; these include non-money surfaces and
must be triaged individually. The missing money dependencies are now
represented by eight forward-only Dev-tested migrations: `20261028234000`,
`20261028235000`, `20261028235500`, and `20261029000000` through
`20261029002000`. The first three (P3-F1) are applied in Production; the
remaining five (P3-F2) have also been applied and verified in Production. The
separate grant repair `20261028235900` was applied between them. The local
Production-shaped rehearsal compiled and rolled back; `plpgsql_check` found
zero SQL/type errors across the restored claim triggers and four dependency
functions. These checks do not prove provider runtime behavior. Reconfirm
exact schema and claim/RPC parity before the separate Production approvals.

Proposed new release units (not approved by this document):

| Unit | Exact versions | Scope |
| --- | --- | --- |
| P3-F1 | `20261028234000`, `20261028235000`, `20261028235500` | Funding-position and consultation/adjustment claim tables, plus payout identity fields. Verify RLS, grants, constraints, indexes and zero enabled routes. |
| P3-F1R | `20261028235900` | Applied and verified in Production: restrict service-role access on the three new claim tables to SELECT/INSERT/UPDATE. P3-F1 inherited full ACL including DELETE/TRUNCATE. Dev and local rollback rehearsal passed. |
| P3-F2 | `20261029000000`, `20261029000500`, `20261029001000`, `20261029001500`, `20261029002000` | Applied and verified in Production: dependency functions, claim guards and bindings with Production UUID/text bridges and accepted-route destinations. All 33 bindings and 34 function names checked; Advisors, health and zero enabled routes verified. |
| P3-RPC1 | `20261029002500` | Proposed one-function forward repair: restore `block_tip_payout_identity_conflict(uuid,text,jsonb)` before Phase 3 money Edge release. The scoped 96-name RPC audit found this one missing in Production; the other 95 names and callable signatures match Dev. Local apply/rollback and Dev verification passed. Requires its own Production approval. |

Do not release the money Edge until P3-RPC1 passes and the Bachs sandbox proof
gate is resolved. The schema units do not authorize an Edge deployment.

The same scoped catalog audit showed only four non-internal triggers across
Production refund/payout claims, attempts and provider operations before the
refund-claim repair; Dev has many more Phase 1 money guards. The repair adds
only the two refund-claim identity/status guards. Several later Phase 3 files
replace guard function bodies without creating their trigger attachments.
Before any Phase 3 money Edge release, inventory each Dev trigger against its
committed source and final Production schema, restore only the required
final-state guards with reviewed forward migrations, test them on the
Production-shaped local stack and Dev, and verify their bindings in Production.
With every route disabled and no Production claim rows, this is a release gate,
not a claim that a live payout was affected. Do not infer parity from function
existence or a successful migration alone.

## P3-0 history reconciliation completed before P3-1

The user approved only `20261028185215_phase3_claim_native_id_compat.sql`. Its
SQL was applied successfully, but the migration MCP recorded generated version
`20261028191928` instead of the source version `20261028185215`. After a
separate, explicit history-only approval, a conditional single-row update via
the connected Supabase SQL tool changed only that version value, preserving
the recorded migration statement and metadata. This deviated from the proposed
CLI repair procedure because the CLI had no Production connection credential.
Postflight found the source version once, generated version zero times,
`payout_claims` RLS on, and zero enabled routes. **Do not apply P3-0 SQL again.**
P3-1 was subsequently approved, applied and verified in Production. Do not
use the migration MCP for another exact-version release
without confirming how it records the supplied version.

## Preconditions before subsequent Phase 3 batches

1. **Reconcile the Phase 1 claim foundation.** The approved Production catalog
   read confirmed `payout_claims`, `payout_attempts`, and
   `order_payment_refund_claims` are absent; the approved history audit found no
   versions in the `20261022`–`20261025` range. Do not replay that historical
   directory. P3-1 restores the additive tables, P3-4 restores provider-attempt
   operations, and P3-8 restores the final claim RPCs used by the Phase 3 Edge
   call graph. P3-8 is applied and contract-verified in Dev; all three batches
   are promoted; the broader claim-trigger parity gate remains before the Edge release. The Production catalog result alone
   does not establish a current customer-facing outage.
   **New exact-replay stop, now repaired in Dev:** the approved Production catalog check also confirms
   `tip_money_operation_claims` and the scoped TIP reservation/outcome/finalizer
   RPCs are absent. P3-10 compiles only after that historical TIP-claim base is
   present. P3-1/P3-8 do not restore it. Forward-only closure `20261028210000`
   is Dev-applied, linted and contract-tested; release it as its own exact
   Production batch **after P3-9 and before P3-10**, despite its later timestamp.
   P3-10 and its dependent Edge release remain blocked until that separate
   Production approval and postflight pass.
2. **Resolve Dev migration-history drift.** Dev's canonical history records
   `20261028033130_payout_claim_ledger_transaction_link` and the three refund
   migrations as `20261028041157`, `20261028041819`, and `20261028041919`.
   Local migration and rollback filenames are aligned to those exact versions.
   The stray `20261028023420` history marker was removed with the supported
   migration-history repair command; no schema was changed by either repair.
3. **Run the full local migration replay/rollback rehearsal once before D2.**
   A fresh replay exposed a native-ID type mismatch in the restored claim
   foundation: Production-shaped core IDs are UUID while claim IDs are text.
   Forward-only compatibility migration `20261028185215` was applied to Dev and
   independently tested against a clean UUID-key PostgreSQL schema, but the
   full historical replay/rollback gate remains open. The clean replay also
   still encounters the documented historical-source blockers before reaching
   the Phase 3 versions; do not edit applied migration files to get past them.
   The isolated PostgreSQL proof did not use the Supabase migration runner, so
   it is evidence for the UUID/text FK shape only, not a full replay signoff.
   A later isolated Supabase-runner attempt advanced past the earlier
   `20260826120030` and September Ops-environment gates, then failed at the
   historical `20261022003751` migration: its unconditional `CREATE TABLE`
   declares `payout_claims.order_id text REFERENCES orders.id uuid`. This exact
   historical source cannot replay on the Production-shaped UUID schema. Do
   not alter an applied migration. Before D2, choose and verify either a
   Production-shaped schema baseline followed by every exact Phase 3
   migration/rollback, or an isolated historical replay overlay with its
   deviations documented. Neither is a clean full-history replay claim.
   The disposable overlay route has now run to the end (637 local history
   versions) with two copy-only historical adaptations: text FKs point to
   generated `id_text` keys, and a patch of an absent historical tip reconciler
   is skipped. All 19 top-level Phase 3 rollback scripts were exercised in
   rolled-back local transactions: 18 executable scripts passed (one after its
   dependent trigger was removed), and P3-0's forward-only stop raised as
   designed. Thirteen additional scripts under `supabase/migrations/rollback`
   were also exercised: ten passed and three raised their intended forward-only
   stops. This was evidence for the overlay route only. The user then
   selected the Production-shaped-baseline route. The first isolated local
   Phase 2 UUID-shaped run exposed the missing TIP table at P3-10. After the
   forward-only TIP closure was built and Dev-tested, a second disposable
   Production-shaped baseline applied all 47 exact Phase 3 SQL files in release
   order (TIP closure before P3-10), with no historical-source overlays. All
   14 Phase 3 SQL contracts and the adjacent TIP runtime contract passed;
   28 executable rollback companions passed in rolled-back transactions and
   six forward-only stops behaved as designed. This satisfies the chosen
   **local migration/rollback rehearsal** gate, not a full unmodified
   historical replay or a provider end-to-end proof.
4. **Recheck Dev and Production history before each batch.** A version already
   present, an unexpected definition, or any nonzero route status stops the
   batch. Production migration reads and writes require separate approval.
5. Run each batch through the exact named migration files only, never `db push`
   against the entire pending directory. Preserve user data; prefer a reviewed
   forward repair over dropping schema.
6. **Explicit Data API grants are part of every new public object.** Supabase
   removes implicit grants for newly created `public` tables/functions across
   existing projects on 2026-10-30. Phase 3 service-only tables must explicitly
   grant only the required privileges to `service_role`, revoke client-role
   access, and keep RLS enabled. Verify the resulting grants after each batch;
   see Supabase's [Data API grant guidance](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically).

## Candidate Phase 3 migration batches

The 44 Phase 3 Dev versions are ordered by dependency and grouped to at most
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
| P3-0 | `20261028185215` | Forward-only native-ID compatibility prerequisite for the restored claims foundation. Add unique generated text-key bridges for native UUID/text source IDs, create the service-only `payout_claims` shell, and bind its text references to those bridges without changing stored earning or payout values. This exact migration must be applied before P3-1 despite its later timestamp; it makes P3-1's `CREATE TABLE IF NOT EXISTS` safely skip its incompatible inline native-ID FKs. Verify bridge uniqueness, all three claim FKs, RLS/grants, identity trigger, and zero route changes. |
| P3-1 | `20261028014025`, `20261028014028`, `20261028014031`, `20261028014035`, `20261028014040` | Bachs provider enum; provider-neutral payout/refund foundation and operation guards; checkout/charge identity. Verify constraints, RLS, grants, triggers and existing Phase 1 repairs; no rows or routes should be created. |
| P3-2 | `20261028014044`, `20261028015810`, `20261028021731`, `20261028022550`, `20261028033130` | Single initial-checkout guard, onboarding/account claims, first-transfer review, aggregate onboarding state, payout-ledger receipt. Verify idempotent create/bind, service-only operations, and exact Dev migration history reconciliation. |
| P3-3 | `20261028035153`, `20261028041157`, `20261028041819`, `20261028041919`, `20261028053708` | Bachs staged tranche finalizer; claim-bound refund attempts and identity; provider-operation attempt tracking. Verify provider-confirmed finalization, immutable identities, and RLS/grants. |
| P3-4 | `20261028053938`, `20261028053952`, `20261028054016`, `20261028054237`, `20261028054401` | Link payout attempts to operations, exact-link historical backfill, forward-only outcomes, replacement scope, evidenced late success. `20261028053952` is a data backfill: inspect affected-row counts and exact source/target links before requesting its Production approval. |
| P3-5 | `20261028061641`, `20261028062947`, `20261028063130`, `20261028094246`, `20261028132120` | Claimed route-tranche finalization, Bachs dispute lifecycle, refundable checkout methods, snapshot destination corrections and returned-transfer Ops records. Verify no route is enabled and unsupported methods remain blocked. |
| P3-6 | `20261028132126`, `20261028132406`, `20261028132459`, `20261028132505`, `20261028132557` | Snapshot correction guards, audited apply/reserve functions and FK indexes. Verify service-only access, two-person approval, same-provider/amount/currency constraints and funds-return preconditions. |
| P3-7 | `20261028140403` | Reviewed Bachs refund retries. Verify the refund-claim attempt links, terminal-failure evidence, independent approval checks, fixed keys and service-only reservation. |
| P3-8 | `20261028150000` | Forward-only Phase 1 runtime closure: restores payout/refund claim reservation and payout-conflict RPCs absent from the historical Production migration range. Verify empty search paths, service-role-only grants, order-first refund lock, and all four callable signatures. This must precede the Phase 3 Edge release. |
| P3-9 | `20261028150721` | Forward-only fix for the Dev-verified tranche-reservation text/enum comparison that made payout reservation fail at runtime. Verify the exact function definition and that `supabase db lint --linked --schema public` reports no tranche comparison error. |
| P3-TIP | `20261028210000` | Forward-only closure for the Production-absent TIP claim table, final Dev-verified reservation/outcome/finalizer RPCs, three guards, RLS, privileges and uniqueness. Release **before P3-10** despite the later timestamp; verify zero existing TIP rows, exact function signatures, three enabled triggers, service-only grants, lint and zero enabled routes. Its rollback is intentionally forward-only. |
| P3-10 | `20261028150745` | TIP runtime binding/start/outcome RPCs and claim-backed Stripe/Bachs tip execution. Verify one-send/lookup-only retry, pending-to-paid reconciliation, evidenced late success, ledger-link separation, service-role-only grants, and empty search paths. This adds `release-order-tip` and `monitor-settlements` to the eventual Edge diff. |
| P3-11 | `20261028163119` | Service-only Bachs post-settlement fee evidence and idempotent provider-fee ledger recognition. Verify RLS, least-privilege grants, forward-only state handling, and that no customer amount or route changes. |
| P3-12 | `20261028163827` | Preserve signed `collection.succeeded` settlement net/fee evidence; require its fee to match the later Bachs payment GET before fee-ledger finalization. Verify event dedupe/identity, immutable evidence, fail-closed review behavior, and zero enabled routes. |
| P3-13 | `20261028164058` | Revoke default direct DML from `service_role` on the settlement evidence table while preserving SELECT; only the security-definer RPCs can write. Verify SELECT true, all direct writes false, and RPC service-role EXECUTE remains true. |
| P3-23 | `20261028174558` | Allow quote acceptance to snapshot BACHS only for Dev `SANDBOX_ONLY` routes; production remains Stripe-only because the environment gate is not sandbox. Verify both acceptance RPCs and zero enabled routes. |
| P3-24 | `20261028182315`, `20261028182408` | Bind reviewed snapshot destination corrections to the exact route/tailor/failed payout/returned operation, then normalize service-role grants on Phase 3 claim tables. Verify invoker-only trigger, zero client table privileges, minimum service-role privileges, and zero enabled routes. |
| P3-25 | `20261028183032` | Remove inherited PUBLIC/client/service-role EXECUTE from the trigger-only append-only settlement guard, pin its search path empty, and verify both append-only triggers remain enabled. |
| P3-26 | `20261028183437` | Remove inherited direct API-role EXECUTE from four trigger-only money guards while preserving each enabled trigger binding and body. |
| P3-27 | `20261028183633` | Pin the fully qualified payment tax snapshot trigger function to an empty search path; verify its invoker mode, no direct API-role execution, and enabled trigger. |
| P3-29 | `20261028195902` | Restore the two nullable claim-FK indexes already present in Dev but absent from replayable source and Production: payout attempt → provider operation and provider operation → reviewed correction. Verify both index definitions and that Performance Advisor no longer reports these two unindexed FKs. This is additive and does not enable a route. |
| P3-30 | `20261028201407` | Make a bound Bachs refund-attempt provider ID immutable even when status is pending or unknown; prevent lookup-only recovery from losing its provider reference. Verify the trigger guard, history, and null-clearing/retargeting regression test. Dev-applied; Production requires separate approval. |

P3-0 is a prerequisite to P3-1 and is intentionally out of timestamp order.
Do not use `db push` to reorder or batch it. Apply its exact file/version first,
verify it, then proceed to separately approved P3-1 and later batches. Its
rollback companion is a forward-only stop guard; the text-key bridges and claim
references must not be dropped or converted back to native UUID foreign keys.
Before Production application, verify `orders.id_text`,
`tailor_profiles.id_text`, and `payouts.id_text` are absent or match the
generated `text` definitions and have no conflicting indexes. Stop if a
pre-existing object differs; do not rely on `IF NOT EXISTS` to mask drift.

P3-11 through P3-13 were applied to Dev in that exact order. P3-11 first
created the service-only settlement-check table and recorder; P3-12 adds the
signed event net evidence and gates the recorder. The local migration filenames
match the exact versions recorded by Dev. P3-13 corrects Supabase's default
`service_role` table ACL. Production must apply them in order, in separate
approved batches if requested; never apply P3-12 or P3-13 without P3-11.

P3-9 and P3-10 were applied to Dev with the scoped migration tool after the
linked CLI migration runner refused the remote history because many older
remote versions are absent from this checkout. The tool recorded versions
`20261028150721` and `20261028150745`; local filenames now match those exact
versions. No history repair or bulk migration was attempted. The full linked
CLI replay remains blocked until the historical-source discrepancy is handled
in a separately reviewed scope.

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
`ready-made-order-action`, `refund-order-payments`, `release-order-tip`,
`release-settlement-tranche`, and `saved-tailor-action`.

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
- Phase 3 schema batches through P3-30, P3-F1, P3-F1R and P3-F2 were separately
  approved, applied and verified. The money Edge release and web merge still
  need separate scoped approvals.
- All Production payment routes remain `DISABLED`; route enablement belongs only
  to Phase 4 and requires the previously agreed two-person evidence gate.
