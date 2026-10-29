# Phase 3 Production release plan — live status

**Status: P3-0 through P3-13, P3-TIP, and P3-23 through P3-30, P3-F1/F1R/F2,
and the approved forward migrations `20261029002500` and `20261029003000` are
present in Production with their source migration-history versions. The separately
approved refund-claim trigger repair `20261028214803` is also verified.** The
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

## Claim-trigger parity audit and remaining Production repair

The 2026-10-28 Production-shaped local rehearsal exposed missing Phase 1
funding-position and adjustment-claim tables beneath the missing trigger
bindings. The scoped Dev/Production catalog audit found ten Dev-only tables
and 124 Dev-only function signatures; these include non-money surfaces and
must be triaged individually. The missing money dependencies are represented
by the forward-only Dev-tested migrations `20261028234000`, `20261028235000`,
`20261028235500`, and `20261029000000` through `20261029002000`. P3-F1/F1R/F2
are applied and verified in Production. The local Production-shaped replay
compiled and rolled back; `plpgsql_check` found zero SQL/type errors across
the restored Phase 1 claim guards and dependency functions. The later scoped
catalog comparison confirms the 33 core refund, payout, payout-attempt,
provider-operation, and TIP trigger bindings now match Production.

The latest audit also found eight additional Dev-only bindings on
`consultation_money_operation_claims`, `consultation_refund_holds`, and
`adjustment_money_operation_claims`. Production has these tables but no
triggers on them; the eight final guard functions were read from Dev, matched
to the claim invariants, and restored in the forward-only migration
`20261029043814_phase3_consultation_adjustment_claim_guards_forward.sql`.
It is applied and verified in Dev, and a focused Production-shaped local
transaction compiled its dependencies, installed all eight bindings, checked
empty search paths and zero enabled routes, then rolled back. Its rollback
companion intentionally refuses to remove durable money guards. Its separate
Production approval and postflight are complete; see P3-G1 below for the exact
version and verification evidence.

Phase 3 release units and current state (this table records releases; it does not authorize them):

| Unit | Exact versions | Scope |
| --- | --- | --- |
| P3-F1 | `20261028234000`, `20261028235000`, `20261028235500` | Funding-position and consultation/adjustment claim tables, plus payout identity fields. Verify RLS, grants, constraints, indexes and zero enabled routes. |
| P3-F1R | `20261028235900` | Applied and verified in Production: restrict service-role access on the three new claim tables to SELECT/INSERT/UPDATE. P3-F1 inherited full ACL including DELETE/TRUNCATE. Dev and local rollback rehearsal passed. |
| P3-F2 | `20261029000000`, `20261029000500`, `20261029001000`, `20261029001500`, `20261029002000` | Applied and verified in Production: dependency functions, claim guards and bindings with Production UUID/text bridges and accepted-route destinations. All 33 bindings and 34 function names checked; Advisors, health and zero enabled routes verified. |
| P3-RPC1 | `20261029002500` | Applied and verified in Production after approval: restores `block_tip_payout_identity_conflict(uuid,text,jsonb)` with service-role-only execute. A separately approved valid synthetic call with a nonexistent UUID returned `Tip payout claim not found` without writes, verifying that failure path. |
| P3-ONB | `20261029003000` | Applied and verified in Production after approval: active Bachs destinations require recent, complete onboarding evidence; the Ops review trigger rejects requirements that remain due or pending. |
| P3-G1 | `20261029043814` | Applied and verified in Production after approval. Adds eight missing consultation/adjustment claim guards. The migration tool initially recorded `20261029044957`; the marker was reconciled to the approved source version without rerunning SQL. Postflight: source version once, generated marker absent, 8/8 enabled bindings, 8/8 invoker functions with empty search paths and no direct API-role execute, Production `ACTIVE_HEALTHY`, and zero enabled routes. Advisors show only the existing service-table RLS INFO and baseline index findings for these tables. |
| P3-ADJ | `20261029131928`, `20261029132040` | **Applied and verified in Production under the approved conditional batch.** Adds reviewed TAILOR-adjustment payout claims, accepted delivery-plus-72h release policy, customer confirmation for post-delivery alterations, and the matching FK/RLS-policy repair. Both versions are present under the exact local file-prefix IDs; generated apply timestamps are absent. Preflight confirmed prerequisites and zero route rows; postflight confirmed RLS, the party-read policy, validation triggers, supporting functions/grants, the order index, `ACTIVE_HEALTHY`, and zero route rows. No provider call or payout occurred. |

Do not release the money Edge until the remaining provider proof gates are
resolved and a separate Edge release is approved. P3-G1 is applied and
verified. The
schema units do not authorize an Edge deployment.

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
3. **Complete one local migration/rollback rehearsal before Phase 3 Edge/web
   release (completed).** An unmodified historical replay is not possible on
   the Production-shaped UUID schema: `20261022003751` declares a text-to-UUID
   foreign key, and `20261025020517` patches a historical TIP function absent
   from clean source history. No checked-in historical migration was edited.
   The user selected a Production-shaped baseline; the isolated baseline then
   applied all 47 exact Phase 3 SQL files in release order (TIP closure before
   P3-10), with no historical-source overlays. All 14 Phase 3 SQL contracts
   and the adjacent TIP runtime contract passed; 28 executable rollback
   companions passed in rolled-back transactions, and six forward-only stops
   behaved as designed. This completes the selected Phase 3 migration/rollback
   rehearsal, not an unmodified full-history replay or provider proof. It was
   completed after some separately approved Production schema batches had
   started, and before the still-unapproved money Edge/web release. The later
   guard-parity migration `20261029043814` had its own focused local apply,
   assertion and rollback rehearsal.
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
| P1-Fabric follow-up | `20261029062510` | **Released and verified in Production 2026-10-29.** Restores the separate immediate trigger for `PROCESS_FABRIC_RELEASE`, includes fabric in the existing bounded recovery path, preserves webhook/tip wakeups, and pins both worker functions to empty search paths. No new cron, route, or payout-schedule change. |
| P1-dispute ACL follow-up | `20261029063007` | **Released and verified in Production 2026-10-29.** The legacy, unused `ops_resolve_dispute(uuid,text,text)` SECURITY DEFINER function is executable only by `service_role`. Forward-only because client execution lacks an authenticated Ops-principal check. |

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

After the approved schema batches and claim trigger/RPC checks are verified,
deploy the exact Phase 3 Edge dependency diff as a separate Production release.
A static import-closure scan from PR #79's current head found 40 affected
entrypoints, including functions whose own `index.ts` is unchanged but imports
modified shared payment or currency code:

`account-profile-action`, `bachs-webhook`, `commercial-adjustment-action`,
`consultation-lifecycle-action`, `consultation-reschedule-action`,
`create-consultation-room`, `create-order-call-room`, `custom-order-action`,
`customer-order-action`, `drapeon-dispatch-action`, `expire-pending-payments`,
`fabric-workflow-action`, `identity-handoff-action`, `material-advance-action`,
`message-action`, `monitor-settlements`, `notify-ops-verification`,
`ops-money-action`, `order-call-action`, `order-tip-action`, `payment-action`,
`payment-route-availability`, `payout-account-action`, `payout-setup-request`,
`paystack-webhook`, `process-job-queue`, `ready-made-order-action`,
`refund-order-payments`, `release-consultation-earning`,
`release-order-payouts`, `release-order-tip`, `release-settlement-tranche`,
`reverse-stripe-transfer`, `saved-tailor-action`,
`send-consultation-reminders`, `service-health`, `stripe-webhook`,
`tailor-order-action`, `tailor-profile-action`, and `tailor-quote-draft-action`.

Recompute this list from the final PR head before seeking release approval.
Deploy sequentially, preserving each function's existing JWT setting. Verify
versions, webhook ingress behavior, queues, health, and zero enabled routes; do
not create or replay provider operations. Cloudflare's PR bot reports that
commit `6d1471f0` deployed successfully to the Production `drape` Worker, then
reports build `cb8db290-7a71-4c71-9f8c-080a3076cce1` for commit `76021d8c` as
successfully deployed. These branch deployments happened despite the PR
remaining a draft and without the separate Production web-release approval.
The user approved cancel/rollback, but the build had completed before the
approval arrived. The latest bot-reported successful deployment before PR #79
was commit `fd89ffc6` (build `103d36db-73c3-4a3b-8866-cfa843ec847a`, from PR
#72). This is the rollback target candidate, not a verified current/previous
Cloudflare version ID. Cloudflare MCP requires reauthentication; local Wrangler
has no `CLOUDFLARE_API_TOKEN`, and browser control is timing out. Reconnect
Cloudflare access, confirm the version that corresponds to `fd89ffc6`, and
restore it before treating the web release as approved or complete.

The repository already has a non-main branch guard in
`apps/web/scripts/cf-preview.mjs` and `cf-build-mode.mjs`; Cloudflare Workers
Builds inject `WORKERS_CI_BRANCH`. The successful Production deployment means
the connected build likely bypassed the guarded script, or the Worker production
branch is set to this feature branch. Dashboard settings and build logs are
needed to distinguish those causes. Once access is restored, verify the
production branch is `main`, the Production deploy command invokes the guarded
script, and preview builds stay disabled until isolated resources are configured.
Do not push this branch again before that check.

Only after the Edge release and `launch:contracts` pass on the exact final head
should the web PR be merged as its own approval gate. The merge can deploy the
Cloudflare Worker. Check the exact SHA/build and synthetic public health, while
keeping every route disabled. No mobile build is part of Phase 3.

## Proof and release gates

- Dev unit, SQL-contract and type checks are recorded in
  [`payments-phase3-progress.md`](payments-phase3-progress.md). The Dev Bachs
  route and delivery rule used for QA are disabled while proof waits; its
  tagged QA destination remains inactive.
- Dev has a scoped write-capable Bachs sandbox key and an account-event webhook.
  A sandbox recipient and hosted link were created through Drapeon's action;
  identity and payout-destination requirements remain. The connected-account
  webhook is disabled pending signing-secret rotation. Signed receipts and the
  collection-to-withdrawal journey remain unproven; do not substitute fake
  provider tests for that evidence.
- Visual QA remains deferred until after all phases, per instruction.
- Phase 3 schema batches through P3-30, P3-F1, P3-F1R and P3-F2 were separately
  approved, applied and verified. The missing
  `block_tip_payout_identity_conflict(uuid,text,jsonb)` RPC and Bachs onboarding
  readiness guard were restored by approved Production migrations
  `20261029002500` and `20261029003000`. History, grants, constraint, trigger,
  health and disabled routes passed postflight. An approved synthetic RPC call
  with valid synthetic identity-conflict evidence and an all-zero claim UUID
  reached claim lookup and returned `Tip payout claim not found`; no claim update
  or Ops case was written. Edge and web releases require separate approval.
- All Production payment routes remain `DISABLED`; route enablement belongs only
  to Phase 4 and requires the previously agreed two-person evidence gate.
- A separate Phase 1 reconciliation found 93 Dev history rows dated Oct 24/25
  absent from Production. They are not a replay batch: 35 are verification-only,
  some functions have been superseded by the forward Phase 3 claim/guard
  migrations, and a Dev-only legacy dispute-RPC ACL repair still needs a scoped
  Production read. The one confirmed retained-worker omission is listed above;
  do not call Phases 1–3 fully promoted until this reconciliation and its
  independent race proof close.
- Full `pnpm launch:contracts` passed on code commit `750e23e5`; later commits
  `6d1471f0` and `76021d8c` only changed release documentation. A GitHub API
  attempt to refresh PR #79's description returned 403 `Resource not accessible
  by integration`, so its hosted PR summary may remain stale.
