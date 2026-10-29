# Phase 3 payment integration progress

Phase 3 branches from main merge `7de90b8f` (PR #66). This log does not
authorize a Production release or route enablement. All payment routes remain
`DISABLED`; Phase 4 owns live proof and enablement.

## Step A — Phase 1–2 closeout

- PR #68 merged as `33ba45ec` after green static-contract and Cloudflare checks.
  Its forward-only repair migrations were applied and verified separately in
  Production. The docs-only merge produced a successful Production Workers build
  and a new 100% Worker deployment.
- PR #66 rebased onto that main without touching the unrelated `deno.lock`
  worktree change. `pnpm launch:contracts` passed on Node 22: 90 shared Jest
  suites, 807 tests, all Edge entrypoints type-checked; PR static-contract and
  Cloudflare build passed.
- PR #66 merged as `7de90b8f` after separate approval. Its Production migration
  batches and 24 Edge functions had already been approved, applied and verified
  separately. Main's static-contract and Workers Build both passed; Cloudflare
  reports build outcome `success` for that exact commit and a new 100% `drape`
  Worker deployment at 2026-10-28 01:13:52 UTC.
- Production route read after the merge returned zero `payment_routes` rows,
  hence zero enabled routes. No route was enabled by either PR.
- Pre-existing Production observations remain open: nine historical DEAD jobs
  (not replayed), and intermittent `service-health` 503s predating the Edge
  release. See [Phase 3 production fix-up](phase3-production-fixup.md).
- Source gap found before Bachs money movement: current main has no migrations
  defining `payout_claims`, `payout_attempts`, or `order_payment_refund_claims`,
  though Dev has them. The approved, read-only Production catalog check
  confirmed all three tables are absent there. Phase 3 must restore a
  replayable, reviewed claims foundation before it can wire transfers or
  refunds. No Production data rows were read or changed.
- A read-only Dev catalog recheck found all three claim tables with RLS enabled.
  Their key columns match the restored source shape; the Dev-only
  `payout_attempts.claim_operation_id` and refund `refund_context` extensions
  are covered by later source migrations. This recheck read table metadata, not
  customer or money rows.
- The branch carries additive Bachs source migrations `20261028014025`, `14028`,
  `14031`, `14035`, `14040`, and `14044`; these are applied in Dev only and
  remain unapplied in Production. An isolated local Postgres rehearsal
  applied/reapplied the claims foundation and operation guards with assertions
  for the BACHS enum, RLS tables, unique claim constraints, and identity
  trigger. The new account-setup claim migration `20261028015810` is also
  applied and verified in Dev only. Production remains untouched; the full
  project migration/rollback replay is reserved for the D2 gate.

## B1 — Server-only Bachs adapter foundation

- Commit `d5d057ba` adds a Bachs client that selects sandbox versus live by the
  exact Supabase environment and rejects a mismatched key prefix. It requires a
  fixed idempotency key for every write, never automatically retries an
  uncertain write, converts amounts through the shared minor-unit helper, and
  redacts provider error details from thrown errors.
- Tests: `deno test supabase/functions/_shared/bachs_test.ts` — 6 passed, 0
  failed. `git diff --cached --check` passed before commit.
- Bachs sources:
  [API conventions](https://docs.bachs.io/api-reference/api-standards),
  [idempotency and uncertain-write recovery](https://docs.bachs.io/guides/idempotency),
  [separate transfers](https://docs.bachs.io/connect/split-payments/separate-transfers).
- The initial-order checkout now persists its returned provider ID before
  read-after-write verification and reconciles an uncertain create without
  re-POSTing. Account creation/onboarding is wired; transfer and refund writes
  still need to be connected to their durable claim flows. No Bachs route is
  enabled and no checkout was created in Dev.

### B1 typed operations in progress

- Added recipient-account, hosted-onboarding-link, checkout, and
  separate-transfer request wrappers. They validate returned IDs and the exact
  currency/amount/destination/group against inputs before a caller may persist
  them. Checkout uses raw order-time pricing, the route's currency,
  `customer_bears_fee: false`, and an explicit expiry; no NGN constant is
  embedded in the adapter.
- Tests: both Bachs test files — 9 passed, 0 failed. Source:
  [account creation](https://docs.bachs.io/connect/guides/create-an-account),
  [hosted onboarding](https://docs.bachs.io/connect/guides/hosted-onboarding),
  [checkout options](https://docs.bachs.io/guides/checkout/checkout-sessions).
- Still needed: wire these wrappers to the existing claims and route snapshot,
  persist provider IDs immediately, and reconcile uncertain writes. These
  wrappers alone do not authorize or initiate a provider operation.
- Added read-only charge and webhook-event retrieval wrappers for post-timeout
  reconciliation; both require the returned provider ID to match the requested
  ID. This uses Bachs'
  [payment retrieval](https://docs.bachs.io/api-reference/payments/get-payment)
  and
  [event retrieval](https://docs.bachs.io/api-reference/webhooks/retrieve-a-webhook-event)
  endpoints. The B1/B4 operation orchestration is still open.

## B4 — Webhook security foundation

- Added a raw-byte HMAC-SHA256 verifier for Bachs' V2 signature, accepting any
  valid `v1` during rotation, with a five-minute replay window. The legacy
  headers are accepted only when V2 is absent. No event handler is deployed yet.
- Tests: `deno test supabase/functions/_shared/bachs-webhook-signature_test.ts`
  — 4 passed, 0 failed. Source:
  [Bachs webhook signature and rotation contract](https://docs.bachs.io/guides/webhooks/overview).
- Added separate checkout-ID and charge-ID storage to `order_payments`, with a
  unique charge reference. A pure collection matcher accepts
  `collection.succeeded` only when the platform account, saved Bachs checkout,
  reference, currency and exact minor-unit amount all match; missing charge or
  cross-account evidence fails closed. This is not wired to order advancement
  yet. The additive migration applied and reapplied in the isolated local
  Postgres fixture.
- Tests: `deno test supabase/functions/_shared/bachs-collection_test.ts` — 3
  passed, 0 failed. Source:
  [Bachs collection succeeded event](https://docs.bachs.io/guides/webhooks/events/collection-succeeded).
- Added the Bachs initial-order checkout request guard (Dev source version
  `20261028014044`): one initial checkout attempt per order, service-only atomic
  `RESERVED → SENT` claim before a provider POST, and idempotent binding of the
  returned `chk_` identity. A `SENT` attempt remains blocking even if another
  path marks it failed; an unknown outcome requires provider reconciliation,
  never a fresh checkout. The guard is initial-order-only so later distinct tips
  can coexist. Local isolated Postgres: migration applied, first claim/bind
  returned true, repeated claim/bind returned false, a duplicate initial attempt
  hit the unique index, and two separate TIP attempts remained allowed (6 checks
  passed, 0 failed). It is applied in Dev only; Production is untouched.
- Added the server checkout-attempt orchestrator and Supabase RPC adapter. It
  claims before posting, immediately binds the provider checkout ID, retrieves
  an already-bound checkout rather than posting again, and returns `UNCERTAIN`
  after a crash/timeout or failed bind so the caller can open a Money Desk case.
  Tests: 5 passed, 0 failed, covering create/reuse, Bachs' documented create
  response shape followed by GET verification, crash before provider call,
  failed bind, and simultaneous calls. It is now wired only into the Dev-flagged
  initial-order `payment-action`; webhook confirmation and the remaining Bachs
  phases are still open.

## External gates (not Phase 3 blockers)

See [Launch gates](launch-gates.md) for Bachs written answers, legal sign-off,
and Phase 4 live route evidence. Visual QA remains deferred as requested.

## C1 — Card-issuer gate

- The single shared route resolver now takes an explicit
  `enforceCardIssuerCountryGate` flag, default OFF. Quote acceptance has no
  issuer signal and therefore no longer fails solely because an enabled Bachs
  route lacks one. An explicit true flag still fails closed against the route's
  written-confirmation list; no live route is enabled.
- Tests: `deno test supabase/functions/_shared/payment-routes_test.ts` — 10
  passed, 0 failed. The checkout-stage issuer signal and operational flag wiring
  remain for the Bachs answer; this brick does not assert that foreign cards are
  supported.

## B3 — Dev-only initial Bachs checkout path (partial)

- Extended the existing shared route resolver and acceptance snapshots; no
  second resolver or order routing system was introduced. Bachs is executable
  only for an explicitly configured `SANDBOX_ONLY` route when
  `BACHS_SANDBOX_CHECKOUT_ENABLED=true` and the Supabase host is exactly the Dev
  project. Unknown/local/Production hosts fail closed. The setting is not
  enabled in Dev or Production, and all payment routes remain disabled.
- Wired only `INITIAL_ORDER` checkout preparation/return verification. The
  provider attempt is reserved before the POST with one stable business
  idempotency key. The checkout ID and URL are bound before the follow-up GET;
  the returned session amount, currency, reference, and ID are checked before
  its URL is returned. A return from hosted checkout is not payment proof; only
  a verified webhook may confirm it. All other phases remain unavailable on
  Bachs.
- Bachs create responses omit amount/currency in the documented response shape,
  so the implementation retrieves the newly created checkout by its returned ID
  before exposing it. The public expiry worker uses the same 30-minute window
  and, because Bachs has no cancel endpoint, preserves the payment attempt/order
  references and keeps the order pending for late bank-transfer reconciliation;
  lookup failures or non-open states create Money Desk cases.
- Dev schema brick applied: provider enum, payout/refund claims,
  provider-operation guard, charge identity, and single initial-checkout guard.
  The Supabase migration tool generated Dev history versions `20261028014025`,
  `20261028014028`, `20261028014031`, `20261028014035`, `20261028014040`,
  `20261028014044`; the six source migration filenames now use those exact
  versions so `db push` will not replay them. No Production migrations were run.
  Dev catalog verification: all five payment/claim tables have RLS enabled;
  Bachs checkout/charge indexes and claim-only live-operation index exist;
  checkout claim/bind RPCs are executable by `service_role` only. The security
  advisor shows pre-existing project-wide findings; none of the four new Bachs
  RPC/trigger functions appeared in mutable-search-path or public-execution
  findings. The service-only claims tables produce expected informational “RLS
  enabled/no policy” findings.
- Tests: focused Deno tests — 17 passed, 0 failed (checkout-attempt, route
  resolver, route acceptance); `deno check` passed for `payment-action`,
  `expire-pending-payments`, `payment-route-availability`,
  `custom-order-action`, `ready-made-order-action`, and `customer-order-action`.
- Dev evidence limits: no Bachs checkout was created and no provider write was
  attempted; the available sandbox credential is read-only. No app/web visual QA
  was done, per the explicit deferral. This is not full Bachs collection proof:
  signed webhook ingestion/processing, refunds, non-initial phases, payout
  destination onboarding, transfers, withdrawal tracking, Ops reconciliation,
  and Bachs-tailor/customer UI remain open.

### B4 — Signed Bachs collection event processing (code brick; Dev deployment pending)

- Added environment-scoped sandbox/live webhook-secret selection with overlap
  rotation support, raw-body HMAC verification, five-minute replay protection,
  and the existing durable/deduplicated webhook inbox + queue replay path. The
  shared queue now routes Bachs events to `bachs-webhook`; post-processing
  reconciliation retrieves the event from Bachs and compares the stored signed
  fields.
- Implemented initial `collection.succeeded` with exact platform-account,
  checkout ID, charge ID, fixed reference, currency, minor-unit amount and
  accepted order snapshot matching. Captured money is recorded through the
  shared status/ledger helper first; only a matching initial-order attempt on
  its current payable order can advance the order. A late terminal-attempt
  success or unexpected phase is recorded and sent to Ops, not discarded or used
  to advance the order. `collection.failed` is nonterminal: it leaves checkout
  open because Bachs permits retrying a payment method. Unknown event types are
  durably queued to Ops rather than silently accepted as fulfillment.
- Tests: signature + collection test files — 9 passed, 0 failed; Deno typecheck
  passed for Bachs webhook, shared queue, Stripe webhook and Paystack webhook;
  `git diff --check` passed.
- Dev evidence: no webhook secret was available to deploy/replay a signed
  sandbox event, so no Dev Edge deployment or signed receipt has yet been
  claimed. The Production catalog query approved for this turn returned no
  `payout_claims`, `payout_attempts`, or `order_payment_refund_claims`
  tables/views. This confirms a Production schema promotion gap; no Production
  write or deployment was performed. Phase 3 transfer/refund releases remain
  gated until a replayable claims foundation is restored and separately approved
  for Production.
- Still open: Bachs account/capability webhooks, transfer-created evidence,
  refunds, disputes, payout notifications and withdrawal reconciliation. The
  initial collection handler intentionally opens Ops review for unsupported
  events/phases. No Bachs route is enabled.

### B2 — Bachs destination persistence and account-creation reservation (foundation only)

- Added `syncBachsPayoutDestination`, which persists/refreshes the existing
  provider-neutral `payout_destinations` row from the exact route ID and
  version. It copies the route's immutable fee collector, checks the provider
  account country against that route, preserves first-withdrawal review state,
  and leaves the destination inactive until both Bachs transfer/payout
  capabilities are active and Ops review is cleared. A capability loss
  deactivates it immediately. It does not add a parallel provider-specific
  destination table.
- Added migration `20261028015810` for service-only Bachs account-setup claims.
  A unique profile/route/version claim freezes one deterministic provider
  idempotency key; the returned Bachs account ID can be bound once, and an
  uncertain `RESERVED` claim cannot be mistaken for permission to create another
  account. Rollback is recorded separately. Dev migration was applied through
  Supabase MCP and appears in Dev migration history as `20261028015810`; Dev
  verification: table exists with RLS enabled, zero rows, service role has
  access, authenticated has none, both RPCs are `SECURITY DEFINER` with empty
  `search_path`, executable only by service role.
- Focused tests: Bachs destination + adapter suites — 10 passed, 0 failed on
  final run; helper `deno check` and `git diff --check` passed. One test
  assertion failed during development due to a fake-query defaulting bug; the
  test harness was corrected and the full focused set then passed.
- No Bachs recipient was created and no provider write was attempted: Dev
  currently has zero configured payment routes, and the available Bachs sandbox
  key is read-only. The claim table is empty. Local Supabase rehearsal could not
  run because the Docker socket is inaccessible in this environment; the Dev
  schema application/verification is the evidence available so far.
- Important provider boundary from
  [Bachs payout documentation](https://docs.bachs.io/connect/payouts):
  recipient-only accounts are not held for Bachs' first-payout review. Drapeon's
  `first_withdrawal_review_status` is therefore an internal pre-transfer Ops
  gate; it cannot delay a tailor's bank withdrawal after Drapeon transfers
  funds. Do not promise Drapeon control over Bachs withdrawal timing.
- Still open in B2: authenticated Edge actions to reserve/create/bind accounts
  and mint hosted onboarding links, account/capability webhook refresh, payout
  setup options/status and web/mobile UI. No route is enabled.

### B2 — Hosted onboarding and Drapeon first-transfer review (code brick; Dev schema only)

- Added the authenticated `start-bachs-connect` / `refresh-bachs-connect-status`
  actions. Account creation is reserved once per tailor + route snapshot, the
  returned provider ID is committed before retrieval or link creation, and an
  uncertain creation stays blocked for reconciliation instead of issuing another
  account POST. Hosted links are account-bound HTTPS Bachs URLs. Setup options
  derive only from explicitly enabled Dev `SANDBOX_ONLY` Bachs route rows; no
  route is currently configured.
- Wired tailor payout setup on web and mobile to the shared route-derived
  provider options, hosted onboarding, return/resume flow, capability refresh,
  and Bachs destination status. Customer/document KYC remains with Bachs. UI
  copy correctly distinguishes Drapeon's pre-transfer first-release review from
  a later bank withdrawal, which Bachs does not hold for Drapeon.
- Added the Ops-reviewed first-transfer release gate using the existing
  provider-neutral `payout_destination_review_events` and `payout_destinations`.
  Migration source now matches the exact Dev history version `20261028021731`;
  the function requires an active reviewed Ops admin, provider BACHS, a
  capability refresh within 15 minutes, and both transfer/payout capabilities
  before clearing. It is service-role-only with empty `search_path`; Dev catalog
  check confirmed no authenticated/anon execute. Bachs status review does not
  enable a payment route.
- Dev migration applied as `20261028021731` and verified in history. Dev catalog
  check: 0 payment route rows, 0 Bachs account-setup claims; the review RPC
  exists with `SECURITY DEFINER`, empty search path, and service-role-only
  execution. Security Advisor had no finding for the new function; its only
  matching INFO was the pre-existing service-only
  `payout_destination_review_events` table with RLS and no client policies.
- Tests: focused Bachs onboarding/destination/operations/route tests — 29
  passed, 0 failed;
  `deno check supabase/functions/payout-account-action/index.ts` passed; mobile
  typecheck passed. Web typecheck remains blocked by the unrelated missing
  `apps/web/features/account/studio-workspace/studio-document.json` import from
  `apps/web/app/studio/editor/route.ts`; it reported no touched-file errors.
  `git diff --check` passed.
- No Bachs account was created and no provider write was attempted; Dev's Bachs
  credential remains read-only. `deno.lock` is a pre-existing user change and is
  intentionally excluded. Production schema, functions, secrets, and routes
  remain untouched; visual QA remains deferred.
- Next: Bachs account/capability webhook synchronization and account-level
  withdrawal events, then transfer/refund/dispute processing and remaining
  payment phases. Full signed sandbox end-to-end evidence and Phase 3 Production
  release still remain outstanding.

### B2 — Connect onboarding progress and account-level withdrawal events (Dev)

- Added aggregate-only onboarding progress counters to the provider-neutral
  `payout_destinations` row; no KYC field names, values, or documents are
  persisted. Tailor web/mobile now distinguish “action needed in Bachs” from
  “Bachs is reviewing your information.” The account-updated webhook is only a
  trigger to re-fetch the authoritative account; capability readiness comes from
  the provider account read, not the event's requirements payload.
- Added signed `account.updated` / `capability.updated` refresh handling and
  account-level `payout.created` / `payout.paid` / `payout.failed` events.
  Withdrawal records use the existing `provider_payout_events` /
  `payout_account_movement_summary` model, with `payout_id = null`; they are
  never attributed to an individual earning. Failed withdrawals create an Ops
  case. Event processing is marked complete only after persistence, audit, and
  required case creation succeed.
- Dev migration `20261028022550` applied and verified in migration history. The
  onboarding counter columns and validated non-Bachs-zero constraint are
  present; Dev still has 0 payment routes. The local migration and rollback
  filenames match the generated Dev version. No Production schema change.
- Dev Edge deployments: `bachs-webhook` version 2 and `payout-account-action`
  version 78 are ACTIVE, both with `verify_jwt=false` so Bachs webhook HMAC
  verification is the endpoint's ingress control. No route, secret, or provider
  setting was changed. No connected account or payout event was created; signed
  webhook delivery still needs a configured sandbox webhook secret/endpoint for
  proof.
- Tests: focused Bachs event, destination, onboarding, and operation suites — 20
  passed, 0 failed; Deno checks passed for `bachs-webhook` and
  `payout-account-action`; mobile typecheck passed; `git diff --check` passed.
  Web typecheck still fails only on the pre-existing missing
  `studio-document.json` import in `apps/web/app/studio/editor/route.ts`.
- Still open: no real Dev Bachs account (read-only credential and no configured
  SANDBOX_ONLY route), so no signed account update or withdrawal receipt has
  been replayed. Transfer creation/status reconciliation, refunds/disputes, Ops
  balance reconciliation/watchdog, and the remaining customer/tailor money UI
  remain open. Production remains untouched by this brick; visual QA remains
  deferred.

### B5 — Bachs transfer balance preflight primitive (code/test brick)

- Added a typed `GET /v1/balances` reader and a fail-closed transfer preflight
  using currency-aware minor units. It checks the platform’s available balance
  for the exact transfer currency (pending settlement is excluded) and blocks
  all outbound transfers if any platform currency is negative.
- Tightened transfer create/retrieve parsing to accept only Bachs’ documented
  `pending` / `paid` states. No transfer is issued by this helper; callers still
  need claims, immediate transfer-ID persistence, reconciliation, and
  release-ledger finalization.
- Evidence: [Bachs balance docs](https://docs.bachs.io/connect/balances)
  document `available_balance` as movable and pending funds as unavailable;
  [transfer docs](https://docs.bachs.io/connect/transfers) require sufficient
  available balance, say a negative balance blocks outbound transfers, and say a
  transfer is `pending` or `paid`;
  [Get Transfer](https://docs.bachs.io/api-reference/transfers/get-a-transfer)
  supports exact-ID reconciliation.
- Tests: Bachs operations suite — 7 passed, 0 failed; combined
  onboarding/destination/events/operations suites — 22 passed, 0 failed.
  `deno check` passed for `bachs-webhook`, `payout-account-action`, and shared
  operations; mobile typecheck passed; `git diff --check` passed.
- No Bachs transfer or other provider write was attempted; the available sandbox
  credential is read-only. No Production changes; all routes remain disabled.
  Remaining B5 work: integrate this preflight into claim-backed payout
  releasers, persist transfer evidence before ledger finalization, and poll
  pending transfers to `paid`.

### B5 — Claim execution and Bachs transfer adapter (code/test brick; releaser wiring open)

- Restored the generic `payout-claims.ts` and `claimed-payout-execution.ts`
  engine plus their focused tests from the Phase 1 implementation. It reserves
  the immutable claim/key, persists each operation outcome before finalization,
  reconciles uncertain or previously confirmed transfers by lookup, and refuses
  to resend when no transfer can be found. The corresponding
  claim-attempt/identity-conflict migration source and rollback files were
  restored at the exact versions already recorded in Dev; a read-only Dev
  history query confirmed all 11 versions are present.
- Added `bachs-claimed-payout.ts`, a provider adapter for that engine. It checks
  available balance before creating a transfer, carries the claim's idempotency
  key/group/destination/amount, maps only `pending` to pending and `paid` to
  confirmed, verifies the full transfer identity, and reconciles only by a
  previously saved `tr_` ID. If an uncertain create has no saved ID, it returns
  UNKNOWN and never posts again. This adapter is not yet called by a payout
  releaser, so no transfer is active.
- Fixed a provider-boundary defect found by the adapter tests: the balance
  endpoint may return negative balances, but the ordinary transaction parser
  rejected signed values before the existing negative-balance guard could see
  them. Added a signed balance-only conversion (transaction amounts remain
  non-negative) and changed the regression test to exercise the actual balance
  API parser then assert the transfer block.
- Tests: claim wrappers + execution — 27 passed, 0 failed; Bachs claimed-payout
  adapter — 6 passed, 0 failed; Bachs operations including
  balance/reconciliation — 9 passed, 0 failed. `deno check` passed for the claim
  and Bachs adapter modules; `git diff --check` passed. No provider write, Dev
  migration, or Production change was made in this brick; routes remain
  disabled.
- Still open: connect the adapter to every supported Bachs earning path, persist
  provider transfer IDs in the durable claim before journal finalization, poll
  pending transfers until Bachs confirms `paid`, and prove the integrated flow
  in the sandbox. Production's missing claim schema remains a separately
  approval-gated Phase 1 fix-up.

### B6 — Bachs refund API adapter (code/test brick)

- Added the server-side create-refund and by-charge recovery wrappers. They use
  Bachs decimal-string money, a claim-stable idempotency key and unique
  reference, explicitly set `fee_bearer: org` so a fee cannot reduce the
  customer's refund, and validate that the returned
  charge/reference/amount/status match the reserved request. By-charge lookup
  supports recovery after an uncertain create; it never retries the write.
- Provider constraint recorded:
  [Bachs refund guide](https://docs.bachs.io/guides/refunds) and
  [refund object/API](https://docs.bachs.io/api-reference/refunds/create-refund)
  say a charge can have only one non-failed refund; a failed refund returns the
  balance and permits a new one, while `processing` reserves balance and
  `success`/`failed` are terminal. Thus the full integration must bind a single
  durable refund claim to the charge and send insufficient-balance refusal to
  Ops; partial-then-later-refund against the same charge is not supported by
  Bachs.
- Tests: Bachs operations suite — 9 passed, 0 failed; shared operations
  `deno check` and `git diff --check` passed. No provider write or Production
  change; routes remain disabled.
- Still open: wire this adapter into claim-backed generic/refund workflows and
  signed `refund.created` / `refund.paid` / `refund.failed` processing, ensure
  incomplete refund reservations stay blocked until provider-confirmed outcome,
  and test the insufficient-balance Ops queue. No customer refund behavior is
  enabled by this wrapper alone.

### B5 — Tip capture/payout receipt and claim-source reconciliation (in progress)

- Correction to the earlier entry: TIP payouts are coordinated by
  `tip_money_operation_claims`, not the generic `payout_claims` table. The
  TIP-specific receipt migration `20261025020517` stores
  `payout_ledger_transaction_id` on the TIP payout claim, while
  `order_tips.ledger_transaction_id` remains the capture receipt. Do not use the
  generic claim link for TIP finalization.
- Selectively restored the TIP claim migration source already applied in Dev
  (reservation/provider-neutral outcomes, identity-conflict handling,
  claim-backed Stripe payout/refund finalizers, capture-versus-payout ledger
  separation, and verification files). No source from unrelated Phase 1 work was
  cherry-picked. Focused tests: `tip-money-claims_test.ts` and
  `tip-payout_test.ts` — 8 passed, 0 failed; `deno check` passed for the touched
  shared modules; `git diff --check` passed.
- A separate additive migration
  `20261028023420_payout_claim_ledger_transaction_link` was applied to Dev and
  its DDL verified, but its migration-history row was absent. It is not a
  substitute for the TIP-specific field, and must be reconciled before migration
  promotion. Production catalog read found none of `payout_claims`,
  `payout_attempts`, or `order_payment_refund_claims`; Phase 1 claim
  schema/source must be reconciled before dependent Phase 3 promotion. No
  Production changes; all routes remain disabled. `deno.lock` remains unrelated
  and unstaged.

### B5 — Staged-tranche Bachs claim execution and reconciliation (Dev)

- Wired the existing staged-tranche releaser to the provider-neutral payout
  claim and attempt engine. A reservation is created before any provider call;
  retries reconcile only a persisted Bachs transfer ID, and an uncertain create
  without that ID is never resent. Provider-pending or ambiguous results remain
  pending for reconciliation rather than being marked paid or failed.
- Added migration `20261028035153_enable_bachs_staged_tranche_claims` in Dev. It
  extends the existing reservation RPC with strict immutable
  route/destination/capability checks and adds a Bachs-only finalizer that
  requires provider-confirmed `paid`, posts one release ledger entry, and marks
  the tranche released. The claim records the payout-ledger link separately;
  account withdrawals remain distinct from individual earnings. Both RPCs are
  service-role-only with empty search paths. The rollback removes the Bachs
  finalizer while retaining the additive reserve RPC for safe fallback to the
  rejecting Edge version.
- Updated `monitor-settlements` to reconcile saved transfer IDs, finalize
  confirmed-paid claims, keep pending/unknown claims open, and create Ops
  follow-up for mismatches. Dev Edge versions verified ACTIVE:
  `release-settlement-tranche` v48 and `monitor-settlements` v36. No provider
  transfer was created or attempted.
- Dev verification: migration version present; both function grants/search paths
  and order-before-tranche lock order verified; focused Deno tests — 30 passed,
  0 failed; `deno check` passed for both Edge functions and new helpers;
  `git diff --check` passed. Route/claim aggregate: 0 enabled routes, 0 Bachs
  routes configured, 0 Bachs tranche claims. No new relevant Advisor findings;
  existing project-level service-only table INFO findings remain.
- Limits/open items: local Supabase rehearsal was unavailable because Docker
  access is denied. No Production schema or Edge changes; no route, secret, or
  provider setting changed. This proves the Dev claim/reconciliation code path
  only, not an end-to-end provider transfer or withdrawal. Visual QA remains
  deferred.

### B3/B6 — Refund-safe Bachs checkout methods (code brick; migration rehearsal pending)

- Bachs documentation review found a route-safety constraint that was not
  represented in the original route snapshot: NGN bank-transfer charges are not
  refundable through Bachs, while card charges in NGN are refundable. Hosted
  checkout otherwise offers every payment corridor enabled on the Bachs account
  unless `payment_method_types` is explicitly restricted. Sources:
  [refund support and limits](https://docs.bachs.io/guides/refunds#what-can-be-refunded)
  and
  [restrict payment methods](https://docs.bachs.io/guides/checkout/checkout-sessions#restrict-payment-methods).
- Added immutable `payment_method_types` to the route configuration via additive
  migration `20261028040132_bachs_refund_payment_method_routes.sql`. For this
  release, Bachs route creation freezes the refundable `NGN_CARD` corridor only;
  bank transfer and unsupported future corridors cannot slip in via
  account-level checkout defaults. The rollback refuses to remove the guard if a
  Bachs route is not `DISABLED`.
- Bachs checkout now requires the immutable route's method list and sends it
  explicitly to hosted checkout. `payment-action` reads it from the route
  ID/version pinned on the order and fails closed on a missing/mismatched
  configuration; the adapter rejects unsupported methods. No currency or method
  is inferred from the browser or current account defaults.
- Tests/checks: Bachs operations tests **9 passed, 0 failed**;
  `deno check --no-lock supabase/functions/payment-action/index.ts` passed;
  `git diff --check` passed.
- Dev/Production evidence: no migration applied, Edge deployed, checkout
  created, provider write made, or route enabled. Local PostgreSQL/Supabase
  rehearsal remains unavailable because Docker is denied; under the local-first
  gate, the new migration must not be applied to shared Dev until that rehearsal
  is available. Production is unchanged and all routes remain disabled.
- Release gate: Bachs route enablement must remain blocked unless the frozen
  route method configuration has a tested refund path. Any future
  method/currency corridor requires its own route version and refund-capability
  evidence; this brick does not add GH/KE or enable any route.

### B6 — Strict Bachs refund lifecycle parser (superseded by claims-backed integration below)

- Added a strict parser for the documented `refund.created`, `refund.paid`, and
  `refund.failed` payloads, plus exact matching against a durable refund claim
  by provider, charge, reference, refund ID, and reserved amount in the claim
  currency. It never trusts a currency supplied by the webhook.
- Source checked: [Bachs refund guide](https://docs.bachs.io/guides/refunds)
  documents the event payload, `processing`/`success`/`failed` meanings,
  asynchronous completion, unique refund references, and the by-charge recovery
  path. `refund.paid` must match the exact reserved refund amount; otherwise it
  cannot finalize.
- Tests: focused parser/matcher suite — **4 passed, 0 failed**; `deno check`
  passed for the parser; `git diff --check` passed.
- At this point it was parser-only; the claims-backed integration below
  supersedes that status. No Production changes; all routes remain disabled.

### B6 — Claim-backed Bachs refund processing and signed lifecycle (Dev schema; code deployment pending)

- Wired Bachs full and partial refunds through the existing immutable business
  refund claim plus a separate Bachs operation-attempt table. The payment’s
  checkout-session ID remains the business claim identity; each provider attempt
  separately snapshots the settled `ch_` charge ID. A provider attempt uses one
  generated reference and idempotency key, persisted before the POST. Before any
  retry/recovery, the code queries Bachs by charge and requires an exact
  reference/charge/amount match; unknown results stay blocked and create a Money
  Desk case. A terminal Bachs `failed` result is not automatically retried; a
  reviewed retry action remains an explicit later item.
- Connected `refund.created`, `refund.paid`, and `refund.failed` to the existing
  signed/deduplicated Bachs webhook inbox. Events must match the configured
  platform account, immutable claim, operation reference, settled charge,
  provider refund ID, exact requested amount, and exact paid amount.
  `refund.paid` applies the real refund and commercial journal idempotently;
  late real success is applied and sent to Ops; conflicting/unknown attempts and
  second successes become Ops cases without an inferred ledger entry.
- If Bachs returns a refund result but the attempt-outcome write fails, the
  request is reported for Ops review and the attempt remains unknown; recovery
  must query the same settled charge and fixed reference before any further
  provider write. A focused regression test covers this persistence-failure
  boundary.
- New Dev schema migrations applied:
  `20261028040942_bachs_refund_operation_attempts`,
  `20261028041348_bachs_refund_attempt_charge_identity`, and
  `20261028041901_bachs_refund_claim_identity_guard`. Dev verification confirms
  the attempt table has RLS enabled with service-role-only grants, the
  reserve/outcome RPCs are invoker-security and service-role-only, the
  active-attempt unique index is present, and provider charge ID is pinned.
  There are zero refund attempts in Dev; no provider refund or other Bachs write
  was made. The SQL verification DO block passed. The Dev Advisor reports
  expected existing project-wide findings; the new service-only claims table
  appears only in the existing informational RLS-without-client-policy category.
- Tests/checks: Bachs refund parser/claim matching + claim execution + shared
  refund + webhook-signature tests — **25 passed, 0 failed**; `deno check`
  passed for `bachs-webhook`, `payment-refunds`, and `bachs-refund-claims`;
  `git diff --check` passed. Docker/Local Supabase remains unavailable, so the
  SQL was applied and verified on Dev under the user's standing Dev approval;
  the local migration replay/rollback suite is still outstanding.
- Still open: Bachs failed-refund reviewed retry flow, signed sandbox refund
  event/replay evidence (no webhook secret available), UI/receipt handling for
  pending/refund-review states, and end-to-end sandbox
  collection/refund/transfer/withdrawal proof. No Edge deployment, Production
  migration/deployment, route enablement, or visual QA occurred. `deno.lock`
  remains a pre-existing change and is excluded.

### B8 — Bachs dispute lifecycle ingestion (code; schema rehearsal pending)

- Added a strict parser for signed `dispute.created` / `dispute.updated` events.
  It retains the disputed amount separately from the full charge, permits a
  partial dispute only when it matches the exact saved Bachs charge and accepted
  route snapshot, and maps only documented response states. `closed` and
  `prevented` remain `UNKNOWN` and block settlement until reviewed.
- Wired the lifecycle into the existing `provider_disputes` table and Ops Money
  Desk queue. Unmatched events never infer an order from metadata; they are
  recorded unlinked and reviewed. A dispute can unblock staged settlement only
  after an exact payment/order match and provider status `won`. Lost, unknown,
  malformed, connected-account-scoped, or conflicting events keep funds blocked.
- Added `record_bachs_provider_dispute_event`, a service-role-only database
  function that serializes changes per dispute, ignores stale events, treats
  equal-timestamp conflicts as blocked `UNKNOWN`, and refuses to retarget an
  existing dispute to another charge/payment. Added its rollback file.
- Tests/checks: dispute parser + matching + chronology, shared dispute
  association rules, and webhook signature suites — **18 passed, 0 failed**;
  `deno check supabase/functions/bachs-webhook/index.ts` passed;
  `git diff --check` passed.
- Correction to the earlier deployment status: current Dev migration history
  contains `20261028062947 bachs_provider_dispute_lifecycle`. Re-ran the SQL
  contract against Dev; it passed the exact RPC signature/history, service-role-
  only execution, empty search path, row lock, stale-event handling,
  chronology/identity conflict guards, and zero-route assertion. The local
  migration replay/rollback rehearsal remains unavailable because Docker is
  inaccessible. No Edge deployment, provider write, signed sandbox receipt,
  Production schema/function change, or route enablement occurred here. The
  Bachs webhook subscription must include `event_source=connect` or `all`; that
  provider-side configuration and signed proof remain in
  [launch gates](launch-gates.md). Visual QA remains deferred.

### B5 — Recover an uncertain Bachs transfer by exact claim metadata

- Bachs successful idempotency responses are cached for 24 hours, after which
  the same POST key is not a safe duplicate-prevention mechanism. The transfer
  adapter now sends a stable `drapeon_claim_key` in provider-owned transfer
  metadata and, when the local transfer ID is missing, searches the pinned
  connected account's paginated transfer list for exactly one matching claim.
  It then retrieves that exact transfer before the normal amount, currency,
  destination, group, status, and claim-metadata verification runs.
- It never re-POSTs an uncertain transfer. Zero matches, multiple matches,
  pagination changes, malformed pages, or a search exceeding 5,000 rows remain
  UNKNOWN and therefore blocked for Ops reconciliation. The list filter is
  limited to the pinned connected account; it intentionally does not filter by
  `kind`, because Bachs documents both `manual` and `payout` transfer kinds.
- Sources: [Bachs idempotency window and uncertain-write guidance](https://docs.bachs.io/guides/idempotency), [transfer metadata](https://docs.bachs.io/api-reference/transfers/create-a-transfer), and [connected-account transfer listing](https://docs.bachs.io/api-reference/transfers/list-transfers).
- Tests: Bachs claim recovery + operations + staged-tranche identity suites —
  **23 passed, 0 failed**; `deno check --no-lock` passed for
  `release-settlement-tranche` and `monitor-settlements`; `git diff --check`
  passed. No migration, Dev/Production deployment, provider write, signed
  sandbox receipt, or route change occurred. This closes the missing-provider-ID
  lookup branch only; it does not prove a real sandbox transfer/withdrawal.

### C2 — Snapshot destination correction audit (implementation prerequisite)

- Traced the existing Ops path from Money Desk preparation through
  `apply_reviewed_payout_destination_correction` to the retry call. The existing
  correction updates only legacy locked Stripe/Paystack profile fields; it does
  not supersede `orders.payout_destination_id` for an accepted route snapshot.
- The retry cannot safely be added as a simple order-field update. The generic
  payout claim freezes `provider_destination_id` and
  `provider_idempotency_key`; `payout_attempts` currently records neither a
  per-operation destination nor a per-operation key. `start_payout_attempt`
  returns the claim's original key, while Ops retries through
  `release-order-payouts`. Bachs staged-tranche finalization also checks the
  claim's pinned destination. Updating the order alone would either fail the
  identity check or retry with the original operation identity.
- No implementation was retained from the first draft; it was backed out before
  tests or commit. No schema, Dev, Production, Edge, or provider state changed.
- The prerequisite gap is now closed in Dev: each provider attempt is durably
  linked to its numbered operation; the RPC returns the operation's frozen
  provider, destination, currency, amount, key, and correction references; and
  transfer IDs and terminal outcomes are recorded on both the operation and the
  attempt. The claim remains the single immutable earning.
- Destination correction itself is still open. It must create a numbered,
  audited replacement only after final provider failure plus funds returned,
  require the reviewed correction and Money Desk request, keep one live
  operation per claim, and preserve same-provider/amount/currency. It still needs
  the correct Ops/releaser integration for every claim source before that action
  is usable on snapshot orders.

### C2 prerequisite — Provider-operation attempt lifecycle (Dev verified)

- Added six replayable migrations for operation/attempt identity, the narrowly
  permitted one-time historical link, exact Dev backfill, provider-operation
  forward transitions, replacement-attempt guard scope, and evidence-backed
  late-success handling. Their source filenames match the versions recorded by
  the Dev migration service: `20261028053708`, `20261028053938`,
  `20261028053952`, `20261028054016`, `20261028054237`, and `20261028054401`.
- The preflight found three successful historical attempts with one exact
  operation each. The backfill linked all three and preserved their transfer
  references; there were no ambiguous candidates. Post-backfill verification:
  **3 linked, 0 unlinked, 0 mismatches**. All 25 provider-operation rows remain;
  no confirmed operation lacks a transfer ID.
- The first Dev rollback-only test run exposed two old trigger assumptions: a
  replacement-only attempt guard rejected operation 1 after it was linked, and
  the operation outcome guard rejected a distinct late success after a transfer
  had already succeeded. Both were repaired narrowly: operation 1 uses the
  shared attempt outcome RPC, while operations 2–3 retain the stricter reviewed
  replacement check; late success requires a linked successful attempt and a
  returned/conflicting/other-confirmed operation, remains blocked for automatic
  payout, and raises the existing deduplicated Ops case.
- Dev SQL proof: **PASS**, transaction rolled back. It covered the initial
  provider call identity and attempt link, success persistence, same-transfer
  replay, a second distinct transfer becoming blocked/late-success, rejection of
  a reverse state transition, pending-state preservation on lookup timeout,
  and late success after final returned-funds evidence. Cleanup verification:
  **0 QA users, 0 QA orders, 0 QA claims, 0 QA Ops issues**. The three existing
  historical payout attempts/operations are the only rows changed by the
  separately reviewed exact-link backfill.
- Final focused Deno verification passed **54 tests, 0 failed** across the
  claimed payout executor, claim RPC adapter, Bachs claimed-payout adapter, and
  Bachs operations suites. `deno check --no-lock` passed for both releasers;
  `git diff --check` passed. The rollback
  SQL test passed in Dev after the trigger-scope repairs. Security Advisor review
  found no new findings naming the changed payout functions; existing
  RLS-enabled/no-policy notices for private service-only tables remain expected.
  No provider call, Production change, Edge deployment, or route enablement was
  made. Local Supabase migration replay remains unavailable because Docker is
  not running; this is recorded as a rehearsal limitation, not production proof.

### B9 — Mobile Bachs initial-order hosted checkout return (client brick)

- Replaced the mobile Paystack-only checkout modal with a provider-neutral hosted
  checkout wrapper. It still admits only HTTPS provider domains, and completion is
  only a navigation hint; the signed Bachs webhook remains the payment authority.
- Added Bachs `checkout_id` handling across the app return route, authenticated
  order lookup, and web return wrapper. A pending Bachs confirmation is presented
  as “Payment confirmation pending”; it never claims payment succeeded or
  instructs the customer to start another charge. Material advances and commercial
  adjustments remain explicitly restricted to their existing Stripe/Paystack path.
- Checks: shared hosted-checkout suite **3 passed, 0 failed**; mobile typecheck
  passed; `git diff --check` passed. Web typecheck remains blocked only by the
  pre-existing missing `apps/web/features/account/studio-workspace/studio-document.json`
  import in `apps/web/app/studio/editor/route.ts`. Targeted Playwright was blocked
  by sandbox `listen EPERM` on `127.0.0.1:3004`; visual QA is intentionally deferred.
- No schema, Dev/Production deployment, provider write, route change, or app build
  occurred. `deno.lock` is a pre-existing unrelated edit and remains excluded.
- Committed independently as `6c07f3b2` after focused tests and mobile typecheck;
  no web typecheck/E2E or visual QA claim is made.
- Remaining proof: signed Bachs sandbox checkout/webhook correlation, Dev route
  journey through transfer and withdrawal, and separately approved Production
  promotion. This client brick alone does not complete B9 or Phase 3.

### B8 — Bachs pending-transfer watchdog escalation (code/test brick)

- The existing settlement monitor already re-reads the exact Bachs transfer and
  creates a deduplicated Ops issue while it remains pending. It now measures age
  from the immutable operation-row `created_at`, rather than the claim's
  `updated_at` (which changes during polling), and escalates at 24 hours and 72
  hours. The 24-hour case pages Ops; the 72-hour case becomes critical. Missing,
  invalid, or future operation timestamps fail closed to an immediate Ops case.
- Escalation resolves the prior-level issue before opening the next one, keeping
  one active watchdog case per tranche. A confirmed transfer resolves all
  watchdog levels. The monitor continues to retrieve the same provider transfer
  and never creates a replacement transfer from an alert.
- This reuses the existing `payout_provider_operations` record and Ops issue
  queue; no schema, provider, payout, or route behavior changed. The timing aligns
  with the existing Stripe settlement monitor's 24-hour stale and 72-hour
  critical thresholds; it is alerting policy only, not a payout or withdrawal
  hold.
- Tests/checks: watchdog unit tests **4 passed, 0 failed**; focused watchdog +
  tranche reconciliation + claimed-tranche suites **10 passed, 0 failed**;
  `deno check supabase/functions/monitor-settlements/index.ts` and
  `git diff --check` passed. Deployed only `monitor-settlements` to Dev using
  server-side bundling after the default Docker bundler could not access the
  local entrypoint. Supabase metadata confirms ACTIVE version 37 and preserves
  `verify_jwt=false`. No migration, provider API call, Production release, or
  route change occurred. Stuck-transfer monitoring is more complete, but
  provider-balance-to-ledger reconciliation remains open.
- Self-review follow-up: Ops notification suppression now distinguishes an
  active deduplicated issue from a previously resolved/closed one. Reopened
  overdue and critical cases page Ops again; active cases do not page on every
  poll. Focused watchdog + tranche reconciliation suites: **10 passed, 0
  failed**; Edge typecheck passed. The shared hosted-checkout return suite also
  passed under the repository-supported Node 22 runtime (**3 passed, 0
  failed**); mobile typecheck passed. The default shell Node 18 is below the
  repository engine and Jest's runtime requirement, so the focused Jest run was
  executed directly with the bundled Node 22 runtime instead. `monitor-settlements`
  was later deployed to Dev as ACTIVE version 37 with `verify_jwt=false` preserved.
- Committed independently as `3cd47367`; no Dev or Production deployment was
  part of that commit. No Production deployment was made.

### C1 — Shared issuer-gate contract test alignment

- The launch-contract run exposed one stale shared test that still expected
  issuer checks to run by default. Updated it to assert the approved behavior:
  quote acceptance stays available without an issuer signal; explicit checkout
  enforcement blocks a missing or unconfirmed issuer and permits a confirmed one.
- Focused shared currency-route tests: **37 passed, 0 failed**. Full
  `pnpm launch:contracts` on Node 24: **passed** (shared Jest: **810 passed,
  0 failed**; all remaining contract checks and Edge entrypoint typechecks passed).
  The first run stopped only on this stale assertion; the corrected full run passed.
- No runtime code, migration, provider state, route, or Production change. The
  change is a test alignment for the existing Phase 3 default-off issuer gate.

### C2 — Stripe claimed-transfer adapter foundation

- Added exact Stripe transfer retrieval and paginated listing filtered by the
  frozen destination and transfer group. A claim-aware provider adapter sends
  each numbered operation with its immutable key and claim metadata; recovery
  retrieves a stored transfer ID or searches for exactly one metadata match.
  It never creates a transfer during lookup, and ambiguous, missing, reversed,
  or identity-mismatched transfers do not finalize as successful payouts.
- Checks: focused Stripe API + claimed-payout tests **9 passed, 0 failed**;
  `deno check --no-lock` passed for the changed Stripe API, adapter, and tests;
  `git diff --check` passed. This is adapter groundwork only; it is not yet
  wired into accepted-route tranche release or the Ops destination-correction
  flow.
- No database, Dev/Production deployment, provider API write, or route change.
  Stripe list/retrieve behavior follows the official
  [transfer-list API](https://docs.stripe.com/api/transfers/list) and
  [retrieve API](https://docs.stripe.com/api/transfers/retrieve). The provider
  integration remains unproven end-to-end in Dev.

### B5 — Provider-neutral claimed staged-tranche release

- Wired accepted-route Stripe and Bachs tranche transfers through the same
  immutable payout-claim/operation executor, provider lookup recovery, and
  database finalizer. Legacy pre-snapshot tranche processing remains on its
  existing path. The monitor now retrieves and reconciles both providers, but
  skips claims whose order lacks an accepted route snapshot; it will not turn
  old Dev test claims into new transfers.
- Added the provider-neutral `finalize_claimed_route_tranche_release` RPC and
  the strict terminal-order staged escrow marker writer in migration
  `20261028061641_phase3_claimed_route_tranche_finalize`. It verifies the
  accepted plan, provider-confirmed tranche claims, transfer operations,
  payout rows and release ledger before setting the final marker. Phase 1's
  existing legacy marker writer and destination-correction exception remain
  intact. The migration is applied in Dev; its SQL contract test passed.
- Checks: targeted payout/watchdog suites **50 passed, 0 failed**;
  `deno check --no-lock` passed for `release-settlement-tranche` and
  `monitor-settlements`; `git diff --check` passed. Deployed those two Edge
  functions to Dev via API bundling: `release-settlement-tranche` ACTIVE
  version 49 and `monitor-settlements` ACTIVE version 38, both retaining
  `verify_jwt=false`.
- Dev post-deploy aggregate: no payment-route rows; five open Stripe tranche
  claims remain from earlier Dev testing, all five have no accepted route
  snapshot (two RESERVED, three TRANSFERRED before this brick). The monitor
  excludes them. No monitor invocation, provider API write, Production change,
  route enablement, or visual QA was performed.
- Open: prove an accepted-route tranche through the signed Dev provider
  journey; verify Bachs balance/reconciliation and bank withdrawal as sandbox
  permits; complete the remaining Bachs adapter/onboarding/checkout/refund and
  Ops/UI work; integrate reviewed snapshot destination correction. Production
  releases remain gated by the release approvals in the goal.

### B8 — Bachs dispute lifecycle Dev schema and webhook release

- Applied the dispute lifecycle migration to Dev after checking the exact RPC
  was absent and the existing `provider_disputes` table had the required
  identity, amount, currency, status, and event columns. Supabase assigned
  history version `20261028062947`; the source and rollback filenames were
  reconciled to that generated version.
- The service-only RPC serializes by provider dispute ID, pins the first charge
  identity, ignores stale signed timestamps, marks equal-time conflicts
  `UNKNOWN`/blocked, and only allows an exact matched `WON` dispute to unblock
  settlement. Dev SQL contract assertions passed for migration history,
  security-definer status, empty search path, chronology/identity guards, and
  service-role-only grants. No new Security Advisor finding names the RPC;
  existing project-wide findings remain unchanged.
- Deployed `bachs-webhook` to Dev as ACTIVE version 3 with `verify_jwt=false`
  preserved. Focused dispute + signature tests: **11 passed, 0 failed**;
  webhook `deno check --no-lock` and `git diff --check` passed.
- No signed dispute event was replayed: a write-capable sandbox/webhook signing
  credential is still an external gate. There are no configured payment routes;
  no provider write, route enablement, Production change, or visual QA occurred.
  Local Supabase/Docker rehearsal remains unavailable, so this brick has Dev
  application and assertions, not a local replay claim.
- Remaining: signed sandbox event proof, account/withdrawal and dispute Ops
  reconciliation end-to-end, plus the rest of Bachs checkout/refund/transfer
  and UI integration. Production Phase 3 promotion remains separately gated.

### B3/B6 — Refund-capable Bachs collection methods in Dev

- Applied the route-level collection-method migration to Dev. Because the
  migration tool generated version `20261028063130`, the checked-in migration
  and rollback filenames now match Dev history exactly. The route invariant
  restricts Bachs to the refundable `NGN_CARD` corridor and makes the method
  list immutable within a route version; it does not configure or enable a
  route.
- Deployed `payment-action` to Dev as ACTIVE version 110, preserving
  `verify_jwt=false`. The sandbox checkout flag remains off, Dev has zero route
  rows, and the `NGN_CARD` restriction means no non-refundable bank-transfer
  checkout can be created through Bachs.
- Checks: SQL contract test passed for history, non-null default, constraint,
  active triggers, client execute grants, and zero routes. Bachs operations,
  checkout-attempt, and route suites: **29 passed, 0 failed**;
  `deno check --no-lock` for `payment-action` and `git diff --check` passed.
  Security Advisor added no finding for the new trigger functions; the existing
  payment-routes RLS/no-policy INFO and unindexed `created_by` FK INFO remain.
- No checkout or provider write was attempted; all routes remain absent/disabled.
  Local Docker rehearsal is still unavailable, and this is not a signed
  collection/refund proof. Production is untouched; visual QA remains deferred.
- Remaining: write-capable Bachs sandbox credentials and webhook secret for
  signed collection/refund evidence, complete claim-backed refunds and Ops
  review/retry, and integrated collection-to-withdrawal proof.

### B8 — Bachs account-to-Drapeon ledger reconciliation

- The scheduled `monitor-settlements` now reconciles each connected account's
  provider balance against Drapeon's confirmed payout claims and payout-ledger
  links, then subtracts Bachs `total_debited` withdrawals. Every provider
  transfer must match an exact Drapeon operation/claim by transfer ID, account,
  currency and amount. Account-level withdrawal rows must match the signed
  payout webhook observations; withdrawals are not attributed to individual
  earnings.
- Missing, extra, duplicated, unresolved, returned, unsupported-kind,
  over-limit, or identity-mismatched movements fail closed into a deduplicated
  Money Desk issue. The monitor does not mutate balances, claims, or payouts.
  Bachs `failed` withdrawals remain incomplete because the public docs do not
  establish when funds and fees are returned to the connected-account balance.
- Checks: reconciliation + Bachs operation tests **23 passed, 0 failed**;
  `deno check --no-lock supabase/functions/monitor-settlements/index.ts`
  passed; `git diff --check` passed. Dev reports **0 Bachs payout destinations**;
  `monitor-settlements` deployed to Dev as ACTIVE version **39**, preserving
  `verify_jwt=false`. No scheduled invocation or provider-account read was
  triggered, no provider write occurred, and Production/routes remain unchanged.
- Remaining proof: add a Bachs destination only when the onboarding/sandbox
  path is ready, then verify transfer + withdrawal webhook reconciliation
  against a write-capable sandbox. The external funds-return semantics remain a
  launch gate; visual QA remains deferred.

### C2 — Snapshot destination correction (Dev schema applied; provider proof pending)

- Extended the reviewed two-person payout-destination correction path for
  accepted-route settlement tranches. The accepted earning and base claim key
  remain unchanged; a replacement operation gets its own numbered key and
  destination, and is allowed only after provider-final failure plus confirmed
  funds return. The destination must still match the order's pinned provider,
  entity, route, currency, tailor, capabilities, and first-transfer review.
- Added durable reconciliation for returned snapshot-tranche transfers so the
  failed payout is visible in Ops, plus the Ops preparation/execution path and
  replacement-destination selector. The legacy correction route now fails closed
  for accepted snapshots; unsupported snapshot payout sources get an explicit
  Ops message instead of falling through to legacy recovery. Phase 3's
  accepted-route disbursement path is staged tranches only; any later snapshot
  claim source must receive its own reviewed recovery adapter before it can pay.
- Final review found B8 balance reconciliation still treated a valid replacement
  transfer as orphaned because it compared the operation's corrected destination
  against the immutable original claim destination. Reconciliation now joins the
  operation to its reviewed correction, verifies the full prior/replacement
  destination chain and Money Desk request, and omits a failed original transfer
  only when final failure plus funds-return evidence is present. Missing or
  inconsistent correction evidence remains incomplete/fail-closed.
- Applied and reconciled these exact Dev migration versions: `20261028094246`,
  `20261028132120`, `20261028132126`, `20261028132406`, `20261028132459`,
  `20261028132505`, and `20261028132557`. The schema change preserves the
  pre-existing `operation_number` column and legacy corrections. The migration
  tool's first combined request timed out; the retry was split into smaller
  forward migrations, with no duplicate provider operation or partial DDL.
- Dev verification: all seven versions appear once in migration history; the
  correction, claims and provider-operation tables have RLS enabled; the
  correction table is granted only to `service_role`; apply is a `SECURITY
DEFINER` RPC with empty search path and service-role-only execution, while
  reservation is `SECURITY INVOKER` and service-role-only. The route count is
  zero. No correction row or provider call was created. The two new destination
  foreign keys are indexed; their specific unindexed-FK Advisor findings are
  absent. The project still reports pre-existing broad Advisor findings.
- Checks: account reconciliation + claim reservation/execution suites **52
  passed, 0 failed**; Edge
  `deno check --no-lock` passed for `release-settlement-tranche`,
  `monitor-settlements`, and `ops-money-execution`; web typecheck passed
  (with the environment's Node 18 engine warning; the full release contract
  remains gated on the repository-supported Node 22 runtime);
  `git diff --check` passed. A `deno fmt --check` probe was not a valid project
  format check (the repo uses Prettier's single-quote/no-semicolon config, not
  Deno's default formatter); changed TypeScript is checked with Prettier. Local
  Supabase migration replay is still unavailable
  because Docker is inaccessible. The actual two-person payout-return journey
  cannot be exercised without a seeded accepted-route fixture and provider-side
  terminal-failure/returned-funds evidence; no such synthetic fixture was
  created. Visual inspection remains deferred per instruction.
- Rollbacks are separated by migration and must be run in reverse version order;
  the schema rollback refuses to proceed if C2 correction rows exist and keeps
  the legacy `operation_number` column. C2 was committed as `4c9e8146` on the
  isolated `codex/phase3-bachs-integration` branch. Dev Edge functions deployed
  and verified ACTIVE: `monitor-settlements` v40 (`verify_jwt=false`),
  `release-settlement-tranche` v49 (`verify_jwt=false`), and `ops-money-action`
  v28 (`verify_jwt=true`). A count-only Dev check found 0 payment routes, 0 C2
  corrections, and 0 Bachs destinations. No provider write, Production
  migration/deploy, or route change occurred; the unrelated `deno.lock` change
  remains excluded.

### B6 — Reviewed retry for terminally failed Bachs refunds (Dev)

- Added a reviewed retry under the original immutable refund claim. Each retry is
  a distinct provider attempt with a fixed claim/attempt idempotency key, linked
  to the exact Money Desk request and the terminally failed prior attempt.
  Reservation requires independent approval and provider evidence for an actual
  Bachs refund object whose terminal status is `failed`; rejected creates without
  a Bachs refund ID are not eligible. The Ops amount is fixed, and the request
  requires a recorded provider failure and balance check. A replay looks up the
  provider refund by the original charge/reference and finalizes the same refund;
  it does not post again after success or an uncertain outcome.
- Bachs terminal webhook outcomes now complete the linked Money Desk execution
  attempt, preserve pending outcomes, open/refresh the failed-refund issue with
  retry eligibility only when provider evidence exists, and resolve the issue
  after a reconciled success. The shared cancellation/refund path treats
  provider `PENDING`/`PROCESSING` as asynchronous rather than financially final.
- Applied and verified Dev migration `20261028140403`:
  `order_payment_refund_attempts` stores the reviewed request/prior-attempt link,
  with unique request identity, immutable attempt identity and a service-role-
  only reservation RPC. The contract SQL passed. Dev migration count is 1;
  retry-request and reviewed-attempt row counts are both 0 (no QA money rows or
  provider calls were created).
- Deployed only `refund-order-payments` v67 and `bachs-webhook` v4 to Dev;
  both remain ACTIVE with the prior `verify_jwt=false` setting. No other Edge
  function, secret, provider setting, route, or Production resource changed.
- Checks: focused Bachs refund-claim and shared refund tests **18 passed, 0
  failed**; `deno check` passed for both changed Edge entrypoints; web TypeScript
  typecheck passed; changed files passed their applicable formatter checks and
  `git diff --check`. Full `pnpm launch:contracts` passed with Node 24, including
  existing repository contract suites (web lint reported pre-existing warnings).
  The Dev Security Advisor showed the existing broad project findings; it added
  no finding for the new reservation RPC. The existing `order_payment_refund_attempts`
  RLS-enabled/no-policy INFO remains service-role-only by grants/RPC use.
- No signed Bachs refund failure was injected because the available sandbox
  credential is read-only; refund recovery is verified with fake-provider tests,
  not a provider-side failure receipt. Local Supabase replay is unavailable
  because the Docker socket is inaccessible. Visual QA remains deferred per
  instruction. Production remains untouched; every payment route remains
  disabled. The unrelated pre-existing `deno.lock` change is excluded.

### D2 — Phase 3 Production release queue drafted (not approved)

- Added [`payments-phase3-production-release-plan.md`](payments-phase3-production-release-plan.md)
  with seven candidate Phase 3 batches of at most five migrations, the exact
  current Edge-entrypoint candidate list, dependency order, postflight checks,
  and separate Edge/web approval gates. It authorizes no Production read or
  write and does not enable routes.
- The previously approved Production catalog/history reads confirmed the Phase
  1 claim tables and `20261022`–`20261025` history range are absent. A forward-
  only Phase 1 dependency repair must be completed before any Phase 3 batch; do
  not replay that historical migration directory wholesale. A new broader
  Production catalog scope needs separate approval.
- Rechecked Dev only: migration history contains no `20261028023420` row, while
  its payout-ledger column, two unique indexes, immutable trigger and trigger
  function are present. The mismatch was reconciled using the supported CLI
  `supabase migration repair 20261028023420 --status applied --linked`, after
  explicitly linking this worktree to Dev (`pqptfuqogvrajozfsqzi`). Follow-up
  catalog assertions confirmed the history row, UUID column, both unique
  indexes, immutable trigger and function are present. No schema was applied
  or reverted by the repair. The CLI initially could not resolve Supabase due
  to sandbox network restrictions; turn-scoped network access was granted for
  the Dev-only command.
- The local full migration/rollback replay is still blocked by unavailable
  Docker. The Bachs sandbox credential is read-only and no webhook signing
  secret is configured, so signed collection/refund/transfer/withdrawal proof
  remains an external gate. Production remains untouched and all routes remain
  disabled.

### C3 — Bachs payout setup reads currency from the route snapshot (code/test brick)

- Removed the mobile payout setup screen's hard-coded `NGN` from Bachs onboarding
  return and status-refresh summaries. The authenticated Edge response now
  includes the selected route's country and payout currency, and mobile displays
  that route-derived currency. If the route currency cannot be confirmed, the
  screen stays in setup rather than showing a guessed currency.
- This is a targeted hardcoding cleanup, not a claim that additional Bachs
  currencies or GH/KE routes are supported. The launch payment-method guard
  still accepts only the approved refundable `NGN_CARD` method.
- Checks: mobile TypeScript typecheck passed under Node 24; `deno check --no-lock`
  passed for `payout-account-action`; Prettier and `git diff --check` passed.
  Dev `payout-account-action` was deployed and verified at version 79 with
  `verify_jwt=false`; deployed source includes the route-derived country and
  currency. No provider operation occurred. Routes remain absent/disabled;
  Production and visual QA remain unchanged.

### C3 — Dev migration-history and filename reconciliation (correction)

- A full linked Dev history check showed the canonical payout-ledger migration
  is `20261028033130`, not `20261028023420`; the refund migrations are recorded
  as `20261028041157`, `20261028041819`, and `20261028041919` (same canonical
  migration names as the local files). The first history-only repair had added
  a duplicate `20261028023420` marker because the earlier check was too narrow.
- Removed only that duplicate history marker with
  `supabase migration repair 20261028023420 --status reverted --linked`.
  This command changes Supabase migration history only; it did not execute SQL
  or reverse schema. Renamed the four local migration files and three matching
  rollback files to Dev's canonical versions. Updated the Production release
  plan and the reviewed-retry rollback comment to match.
- Schema remains intact: the payout-claim ledger UUID column, both unique
  indexes, immutable trigger, and trigger function were verified after the
  history correction. No Production access/change or provider operation.
- Verification: linked history showed the duplicate `20261028023420` row
  removed and canonical `20261028033130`, `20261028041157`, `20261028041819`,
  and `20261028041919` present; migration filenames now match those versions.
  Full local replay remains unavailable because Docker is unavailable.

### Production claim-foundation catalog check (approved read-only scope)

- Queried Production catalog definitions only for `payout_claims`,
  `payout_attempts`, and `order_payment_refund_claims`. All three tables are
  absent. The query read no application rows and made no changes.
- This confirms Phase 3 cannot be released against Production until its
  forward-only claim-foundation migrations are applied in an approved batch.
  The catalog result alone does not establish a current customer-facing outage;
  no Phase 3 claim-dependent Edge release was made as part of this check.
- Production remains unchanged; route state was not read or modified in this
  narrowly scoped catalog query.

### Phase 1 claim-runtime forward repair (Dev)

- The Production catalog result showed that the planned table restorations alone
  would not be sufficient: the Phase 3 call graph also invokes
  `reserve_payout_claim`, `reserve_order_payment_refund_claim`, and two payout
  identity-conflict handlers, none of which was defined in the Phase 3 migration
  set. Added forward-only migration `20261028150000` with the final Dev function
  contracts, empty `search_path`, service-role-only grants, and order-first
  refund locking. Its guarded rollback refuses to drop payment APIs.
- Applied the migration to Dev once and reconciled its history row using the
  supported CLI repair command. The SQL contract test passed: all four function
  signatures exist, clients cannot execute them, `service_role` can, and each
  function pins an empty search path. No provider operation or money row was
  created or changed.
- A second remote-only Dev history row (`20261028144604`) had the same migration
  name but no local source file. Compared with canonical `20261028150000`, it
  represented the duplicate application marker created during the migration
  tooling handoff; removed only that history marker with the supported CLI
  repair command. The DDL/schema was not rolled back. Local and remote history
  now agree on `20261028150000`.
- Focused payout/refund claim tests: **15 passed, 0 failed** (the first run was
  permission-blocked; rerun with the relevant notification environment
  variables explicitly blank, network still denied). Production remains
  unchanged; every payment route remains disabled. Local Supabase replay is
  still unavailable because Docker is unavailable.
- Broader claimed-payout unit/type validation: **37 passed, 0 failed**;
  `deno check` passed for the claim execution modules and `git diff --check`
  passed. This does not close the separate TIP claim-runtime gap identified in
  the follow-up call-graph audit.

### P3-9 — Tranche reservation runtime type repair (Dev)

- Dev's `supabase db lint --linked --schema public` exposed a runtime error in
  `reserve_settlement_tranche_payout_row`: it compared destination `currency`
  text to the order's `public.currency` enum. Added the forward-only repair at
  `20261028150721`; the function now compares the canonical enum text value.
- The linked CLI migration runner refused to proceed because the Dev database
  contains many historical remote migration versions absent from this checkout.
  No suggested history repair was run. Applied only the reviewed migration SQL
  through the scoped Dev migration tool, which recorded `20261028150721`; source
  and rollback filenames were aligned to that recorded version.
- Verification: Dev SQL contract passed; post-migration schema lint has no
  tranche comparison error. Remaining lint messages are pre-existing warnings
  in unrelated functions. Routes remain disabled; no provider calls or money
  rows were created.

### P3-10 — TIP payout claim runtime and releaser wiring (Dev)

- Added service-only `bind_tip_payout_claim` and
  `start_tip_money_operation_provider_call` database gates plus a forward-only
  outcome transition that blocks downgrades and permits only exact,
  provider-evidenced late success after a reconciled failure. Late success opens
  an Ops case. Dev recorded the exact migration as `20261028150745`; local
  source/rollback filenames match. The contract verifies client roles cannot
  execute the RPCs, `service_role` can, all three pin empty search paths, and the
  late-success path exists.
- Wired the accepted-snapshot Stripe/Bachs TIP path to one immutable claim and
  one payout row. The database start gate permits one provider send; every
  re-entry is lookup-only. Provider success is persisted before ledger
  finalization, the payout ledger reference stays on the claim (not the tip's
  capture field), and Bachs pending transfers are revisited by the bounded
  settlements monitor. Legacy provider handling remains on its existing path.
  A started claim reconciles using its exact snapshotted provider/destination
  identity even if current destination capabilities later change; strict
  capability checks remain mandatory before a first send.
- Verification: focused TIP suites — **18 passed, 0 failed**; `deno check`
  passed for `release-order-tip` and `monitor-settlements`; both Dev SQL
  contracts passed; final `supabase db lint --linked --schema public` removed
  the tranche runtime error and reported only unrelated existing warnings.
  The shared order-payout-route contract suite passed (**13 tests**). Dev
  aggregate remains at zero enabled payment routes. No Bachs provider write,
  Production migration, web release, or visual QA was done. Dev Edge deployment
  completed for only `release-order-tip` v44 and `monitor-settlements` v41,
  preserving `verify_jwt=false` for both; their deployed source hashes were
  verified from the Edge-function inventory after deployment.
- Migration replay limitation: `supabase migration up --linked` remains
  blocked by the existing missing historical source set in the checkout. It
  listed those versions but did not apply anything; no history rows were
  rewritten. The separate full local replay gate remains open because Docker is
  unavailable.

### P3-11 — Bachs follow-up collection safety (Dev)

- Extended Bachs checkout preparation to persist phase-specific checkout IDs
  for follow-up delivery charges and to keep the consultation booking link on
  the payment attempt. Bachs checkout is explicitly limited to phases whose
  remaining money path is ready: `INITIAL_ORDER` and `FULFILLMENT`. Consultation,
  material advance, tip capture, and adjustment charges remain unavailable on
  Bachs until their matching payout/release path is complete. This prevents a
  successful collection from creating an earning with no supported release.
- The signed collection handler validates follow-up charges against the exact
  accepted route snapshot, current checkout reference, saved amount, fulfillment
  request, delivery mode, and current order stage. It finalizes delivery charges
  with a compare-and-set, then runs the existing idempotent dispatch funding
  finalizer. A successful consultation event is recorded as real money but
  routed to Money Desk without confirming the booking while the Bachs
  consultation payout path remains unavailable. Unrecognized phases and late
  successes remain recorded and reviewed rather than advancing another stage.
- `collection.failed` is matched to the exact saved follow-up attempt and
  acknowledged as a nonterminal event; it does not mark the attempt terminal or
  locally close its checkout. This follows the event contract documented in the
  [Bachs webhook overview](https://docs.bachs.io/guides/webhooks/overview).
- Verification: Bachs collection and payment-attempt suites — **11 passed, 0
  failed**; `deno check --no-lock` passed for `payment-action` and
  `bachs-webhook`; `git diff --check` passed. Optional `deno fmt --check` was not
  used as a gate because it reports repository-wide formatting differences in
  the existing large payment files; no mass-formatting was applied.
- Deployed only to Dev: `payment-action` v111 and `bachs-webhook` v5, both
  retaining `verify_jwt=false` (custom auth / webhook signature validation).
  No Bachs checkout, provider transfer, recipient, refund, or sandbox write was
  performed. No Production change; all routes remain disabled. Visual QA remains
  deferred.

### P3-12 — Bachs transfer vs. bank-withdrawal presentation

- Corrected the shared payout-state mapper: a Bachs `paid` transfer means the
  money is in the tailor's Bachs balance, not in their bank. Account-level bank
  withdrawal evidence stays separate from the per-earning state, matching the
  existing Stripe model; historical Paystack direct-to-bank semantics are
  unchanged.
- Mobile earnings now reads the provider-neutral Bachs destination returned by
  the authenticated payout-status action, displays its country/currency and
  distinguishes onboarding, first-payout review, blocked, and ready states.
  Account-withdrawal rows name Bachs rather than showing the Stripe-only
  fallback. No visual QA was run, per the deferred-visual instruction.
- Verification: provider-settlement tests **8 passed, 0 failed** (Jest runtime;
  `ts-jest` diagnostics disabled because this isolated workspace does not expose
  the Jest globals to its test-file typecheck); equivalent Deno assertions passed;
  mobile `tsc --noEmit`, shared `deno check`, and `git diff --check` passed.
  No Dev/Production deployment, schema change, provider call, route change, or
  app build was performed; `deno.lock` remains unstaged.

### P3-13 — Bachs payment-phase boundary audit

- Re-audited every Bachs money-in entrypoint after the checkout and webhook
  changes. Only `INITIAL_ORDER` and `FULFILLMENT` may prepare Bachs checkout.
  Consultation is refused at checkout; an unexpected signed success is recorded
  as real money and sent to Money Desk without confirming the booking. Bachs
  `MATERIAL_ADVANCE`, fabric-shortfall, `TIP`, and `ADJUSTMENT` charges remain
  server-blocked, and Bachs destinations cannot fall through to Stripe in the
  material release resolver.
- Recorded the boundary in `docs/launch-gates.md`: before any Phase 4 route is
  enabled, its evidence must account for every phase it can accept. Unsupported
  phases must remain server-blocked and clearly unavailable in the user flow;
  no payment may fall through to a different provider/destination.
- Verification: all Bachs-focused Deno suites — **99 passed, 0 failed**. The
  first unscoped run hit Deno's environment permission guard in the Ops-notice
  test; rerun with notification credentials explicitly blank and only the
  required environment names allowlisted passed. No email/push credentials were
  present, no provider write or Dev/Production operation occurred, and no route
  changed. This is a boundary audit, not an end-to-end provider proof. Visual QA
  remains deferred.
- Still open: a complete Bachs `MATERIAL_ADVANCE` / fabric-shortfall path,
  consultation refund/release, TIP collection/refund, and adjustment release are
  not implemented; these remain unavailable rather than being represented as
  supported. The write-capable sandbox key and webhook signing secret are also
  still needed for signed provider proof.

### P3-14 — Block unsupported Bachs TIP payout start

- Closed a payout escape hatch in the unsupported-phase boundary: a signed
  Bachs TIP success is recorded as real money and sent to review, but its
  `PAYOUT_PENDING` tip state could also be picked up by the automatic tip payout
  worker. `release-order-tip` now refuses to start a new Bachs TIP transfer
  while the shared phase-readiness gate says TIP is unsupported, opens a
  deduplicated Money Desk case, and records an audit event. Existing claims that
  already advanced past `RESERVED` still take the lookup/finalization path, so a
  real in-flight transfer cannot be stranded by the new gate.
- Verification: TIP payout and Bachs collection tests **12 passed, 0 failed**;
  `deno check --no-lock supabase/functions/release-order-tip/index.ts` passed;
  `git diff --check` passed. Deployed only `release-order-tip` to Dev as
  version 45, preserving `verify_jwt=false` and its function-level cron
  authorization. Deployment emitted only unrelated optional secret-unset
  warnings. No provider call, money movement, Production change, or visual QA
  occurred. The Bachs TIP customer checkout remains blocked pending its
  complete refund path.

### P3-15 — Bachs checkout fee disclosure gate

- Reviewed Bachs' current [processing-fee documentation](https://docs.bachs.io/connect/processing-fees)
  against the required customer checkout disclosure. Bachs separates who bears
  the fee (`customer_bears_fee`) from who collects it (`fees_collector`); the
  actual fee and `fee_paid_by` are only known after settlement, and an
  insufficient platform balance can silently move collection back to the
  charge. The account-specific fee is not safe to estimate from a generic rate.
- Recorded the exact written-confirmation and evidence gate in
  `docs/launch-gates.md`: before route enablement, confirm fee semantics for
  platform-owned checkout plus separate transfers, disclose only a substantiated
  customer total, and reconcile settled net to the actual provider fee outcome.
  This changes no route, checkout amount, customer copy, or fee setting; all
  routes remain disabled.
- Verification: source documentation reviewed; `git diff --check` passed. No
  provider call, secret access, deployment, route change, or visual QA occurred.

### P3-16 — Bachs settlement fee and net evidence

- Added a service-only settlement-check record for succeeded Bachs attempts.
  The signed
  [collection.succeeded event](https://docs.bachs.io/guides/webhooks/events/collection-succeeded)
  supplies exact settlement net and processing fee, retained in minor units; a
  later read-only [payment GET](https://docs.bachs.io/api-reference/payments/get-payment)
  confirms
  gross identity, final actual fee, fee currency, fee payer, and provider
  timestamps. The exact event fee must match the GET receipt before the
  idempotent `PROVIDER_FEE_RECOGNITION` ledger adjustment can finalize. Missing
  or conflicting evidence becomes a Money Desk review; repeated non-final or
  failed reads alert after bounded backoff. Accepted customer totals are never
  rewritten and no provider write is made.
- The payment-status recorder is no longer directly executable by `service_role`;
  the evidence-checking wrapper is the only callable finalization route. The
  table has RLS enabled, no anon/authenticated table grants, service-role SELECT
  only, and no policies by design (direct client access remains denied). RPCs
  are service-role-only with empty search paths. Supabase's RLS/no-policy
  informational finding is therefore expected, not a client-access gap.
- Dev migration versions `20261028163119`, `20261028163827`, and `20261028164058`
  are applied and source filenames match the recorded versions. Dev catalog checks confirmed
  the table/columns, RLS, role grants, empty function search paths, and that the
  old direct recorder is not executable by service role. The first catalog
  check found Supabase's default ACL had also granted service-role DML on the
  table; P3-17 corrects it with a forward migration. There are zero
  settlement-check rows, zero payment routes, and zero Bachs routes. Deployed
  only `monitor-settlements` v42 and `bachs-webhook` v6 to Dev, preserving
  `verify_jwt=false`; neither function was invoked for a provider operation.
- Verification: focused Bachs settlement, collection, and operations tests —
  **25 passed, 0 failed**; `deno check --no-lock` passed for both changed Edge
  entrypoints; linked Dev `supabase db lint --schema public --fail-on error`
  exited 0 with no errors (five existing PL/pgSQL warnings, none in the new
  functions); `git diff --check` passed. Routes stayed disabled.
- Evidence limits: Dev had no Bachs settlement checks, so the full webhook→GET
  reconciliation did not run against a real payment. The sandbox credential is
  read-only and no webhook signing secret is configured; signed provider proof
  remains an external gate. The new migrations/functions are not deployed to
  Production. Visual QA remains deferred.

### P3-17 — Restrict direct service-role writes to settlement RPCs

- The initial postflight found that the project’s default privileges had
  granted `service_role` direct INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER
  on the new evidence table, despite the intended RPC-only write boundary.
  Added the forward-only ACL repair `20261028164058`: `service_role` retains
  SELECT for the monitor; all direct DML is revoked. The security-definer
  register/claim/evidence/finalize RPCs remain callable by service role and own
  all state transitions/ledger writes.
- Dev verification: SELECT=true; INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/
  TRIGGER=false; evidence finalizer EXECUTE=true. No rows or routes changed.
  The Dev migration history and source/rollback filenames match exact version
  `20261028164058`. The RLS/no-policy advisor item remains intentional: direct
  client access is denied, and only the service role can read through its
  explicit grant.
- The final retry-alert patch was redeployed to Dev as `monitor-settlements`
  v43, preserving `verify_jwt=false`; `bachs-webhook` remains v6 with the same
  setting. No monitor invocation/provider operation was made.
- The separately approved, read-only Production catalog recheck confirmed
  `payout_claims`, `payout_attempts`, and `order_payment_refund_claims` are
  still absent from `public`. It read only definitions/catalog for those three
  objects, no business rows or other Production objects, and made no changes.
  The missing-claims Production fix-up remains a release prerequisite; this
  does not authorize deploying the Dev-only Bachs changes to Production.

### P3-18 — Clarify Bachs fee-collector scope from provider docs

- Re-read the current Bachs [processing-fees documentation](https://docs.bachs.io/connect/processing-fees).
  It distinguishes the per-checkout `customer_bears_fee` instruction from the
  account-level `fees_collector`; it describes platform-paid fees as applying to
  direct charges, while destination-charge fees come from the charge regardless
  of `fees_collector`. The docs do not say whether a recipient-only connected
  account's collector setting affects Drapeon's platform-owned checkout followed
  by separate transfers.
- Updated `docs/launch-gates.md` to ask Bachs to confirm the platform account's
  `fee_handling`, the collector setting's relevance for recipient-only accounts,
  and the insufficient-platform-balance fallback for this exact flow. No code,
  fee setting, accepted amount, route, or provider operation changed.
- Verification: provider documentation reviewed; `git diff --check` passed.
  This is an external Phase 4 launch gate, not a blocker to continuing the
  fail-closed Phase 3 implementation. All Production routes remain disabled;
  visual QA remains deferred.

### P3-19 — Make the Bachs issuer gate a checkout-only runtime switch

- The shared resolver already had an opt-in issuer-country check, but no
  checkout caller supplied an issuer country and quote acceptance occurs
  before a card exists. Extracted the issuer predicate into the shared currency
  contract and wired `BACHS_CARD_ISSUER_GATE_ENABLED` only at the actual Bachs
  hosted-card handoff. When explicitly `true`, the missing issuer signal fails
  closed; unset/false preserves current behavior. Quote acceptance never reads
  this flag and is not blocked by it.
- The flag is not enabled in Dev or Production. Bachs routes remain disabled in
  Production; Phase 4 still requires written corridor confirmation and either
  a trustworthy issuer signal or Bachs confirmation that no issuer restriction
  is needed. Visual QA remains deferred.
- Verification: Bachs collection suite **8 passed, 0 failed**; shared
  currency-route suite **38 passed, 0 failed** under Node 24; `deno check
  --no-lock supabase/functions/payment-action/index.ts` passed; `git diff
  --check` passed. No provider calls, Dev deploy, database write, Production
  change, route change, or visual QA occurred.

### Migration rehearsal and deployed-schema lint reconciliation

- Docker is available again. A dedicated isolated Supabase stack completed
  migration application through the current Dev head, `20261028150745`, after
  temporary local-only compatibility adjustments for three source-chain issues:
  a historical repair expected the alternate function-body spelling, the local
  UUID-key schema did not satisfy text foreign keys used by deployed Dev, and a
  text-replacement migration expected a Dev-only prior function definition.
  Those temporary edits were reverted because the affected migrations are
  already applied in Dev; applied migration files remain immutable. Therefore
  this is useful diagnosis, not an accepted clean-replay signoff. A repeatable
  replay against the deployed schema shape remains open.
- Local `supabase db lint --fail-on error` found 11 SQL type/column errors in
  functions whose local replay schema uses UUID keys or lacks the Dev
  `refund_context` column. A narrow Dev catalog check confirmed the deployed
  core order, tailor-profile, and payout keys are text and the refund claim has
  `refund_context`. The corresponding remote check,
  `supabase db lint --linked --schema public --fail-on error`, exited 0 with
  **0 errors** and warnings in five existing PL/pgSQL functions. It used the linked Dev
  project only; no rows, schema, functions, or migration history were changed.
- No Production access or changes, provider operations, route changes, or visual
  QA occurred. The full replay/rollback release gate remains open until it can
  be repeated without modifying already-applied migration files.
- Follow-up exact-source replay: after rebuilding the dedicated local DB through
  `20260731150000` and seeding a synthetic non-terminal two-party order, the
  replay passed the rollback verification migrations through `20260826120020`
  and stopped at `20260826120030`. That repair expects the older call spelling
  `initialize_order_settlement_plan(v_advance.order_id)`, while its defining
  source migration `20260801160000` already writes the corrected
  `v_advance.order_id::text` spelling; the repair raises instead of treating an
  already-correct function as complete. No applied migration was edited to
  bypass this. The local DB is isolated, synthetic-only, and left at the last
  successful version `20260826120020`; this does not change the prior replay
  limitation or qualify as the required full clean replay.

### P3-20 — Order-independent account-withdrawal Ops state

- Bachs documents that webhook events may arrive out of order and should be
  checked against `created_at` before stored state is changed:
  [webhook delivery ordering](https://docs.bachs.io/guides/webhooks/overview).
  The withdrawal ledger already retains immutable observations per event, but
  the webhook opened a failure case for every `payout.failed` delivery and did
  not resolve it when a later, matching `payout.paid` arrived.
- Added a bounded, identity- and amount-checked history projection. A case is
  resolved only when the latest uniquely-timed withdrawal observation is
  `PAID`; a latest `FAILED` remains in the queue, and incomplete, conflicting,
  or oversized history stays in review. A delayed older failure cannot reopen
  a resolved case. This only changes the Ops case state; no payout, earning,
  withdrawal ledger, or provider balance is changed.
- Verification: Bachs Connect event tests — **8 passed, 0 failed**;
  `deno check --no-lock supabase/functions/bachs-webhook/index.ts` passed;
  `git diff --check` passed. `deno fmt --check` reports the repository's
  existing formatting differences in the three touched files; no broad
  reformat was applied.
- Dev evidence: deployed `bachs-webhook` to the approved Dev project as
  version 7, preserving `verify_jwt = false`; Supabase function metadata
  confirmed the active version. The normal CLI/Docker bundler could not resolve
  the existing entrypoint, so deployment used Supabase's server-side `--use-api`
  bundler. No signed provider event was replayed because the sandbox webhook
  signing secret remains unavailable. No Dev database mutation, provider call,
  Production access/change, route change, or visual QA occurred. Signed sandbox
  delivery and end-to-end withdrawal proof remain external/integrated QA gates.

### P3-21 — Name Bachs in shared refund status copy

- The shared web/mobile refund timing copy previously normalized `BACHS` as an
  unknown provider, so a Bachs refund was labeled only “Refund processing.” It
  now says “Refund via Bachs” and explains that Bachs and the bank control when
  it appears. It makes no unsupported timing promise and keeps customer refund
  language separate from tailor payout status.
- Verification: shared `refund-outcomes` Jest suite — **3 passed, 0 failed**;
  focused TypeScript check for `financial-cases.ts` passed; `git diff --check`
  passed. No visual QA, Dev/Production deployment, database/provider operation,
  or route change occurred.
- Separate C2 follow-up: a database identity invariant was found missing from
  the accepted-route destination correction writer. A narrow migration, rollback,
  and SQL contract were drafted, but the Supabase migration tool returned
  `Invalid or expired requestState`; read-only verification confirms it did not
  apply. That migration remains uncommitted and unverified, and is not included
  in this brick's commit.

### P3-22 — Keep unsupported Bachs tips unavailable before checkout

- Moved the Bachs payment-phase availability rule into `packages/shared` and
  made the Edge collection gate delegate to that shared rule. Web and iOS now
  read the accepted `charge_provider_snapshot`; for a Bachs order, the tip form
  is replaced by clear unavailable copy and a failed tip cannot be retried from
  the customer surface. The server remains authoritative and unchanged in its
  decision: Bachs TIP collection and payout are still blocked until the complete
  refund/release path is implemented and proven.
- Verification: shared Jest — **1 passed, 0 failed**; Bachs collection Deno
  tests — **8 passed, 0 failed**; `deno check` for the collection test passed;
  web and mobile TypeScript checks passed; `git diff --check` passed. No Dev or
  Production deployment, database/provider operation, route change, or visual
  QA occurred.
- Open: Bachs TIP remains server-blocked and will stay so until its matching
  full-only refund and payout path is implemented; sandbox write credentials and
  signed webhook proof remain external gates.

#### P3-22 Dev deployment follow-through

- Deployed only `payment-action` to the approved Dev project. Supabase metadata
  confirmed active version **112**, with the existing `verify_jwt = false`
  setting preserved. The deployment bundled the shared phase-availability
  helper used by the collection guard. No database migration, provider call,
  Production change, or route change occurred.
- Verification after the Dev deploy: shared Bachs phase Jest suite — **1 passed,
  0 failed**. The collection Deno suite (**8 passed**) and Edge `deno check`
  passed before deployment. Web and mobile typechecks passed for the P3-22
  change. The workspace package runner attempted a dependency repair and stopped
  on its no-TTY safeguard; invoking the already-installed Jest binary directly
  with the bundled Node runtime passed without changing dependencies.

### P3-23 — Dev-only Bachs quote acceptance

- The shared route resolver and Edge feature flag already supported an explicitly
  enabled Bachs sandbox route, but both database acceptance RPCs still rejected
  every provider except Stripe. Added a forward migration for custom quotes and
  ready-made checkout that accepts BACHS only when the database resolves the
  environment as `SANDBOX` and the selected route is `SANDBOX_ONLY`. All other
  providers retain the Stripe-only fail-closed behavior; no route is enabled.
- Added the matching guarded rollback and SQL contract test, plus a Deno test
  confirming custom quote acceptance reaches the RPC only with the explicit
  Dev sandbox flag. The Dev route table currently has zero rows, so this verifies
  the database gate, not a customer checkout.
- Verification: route acceptance + route resolver Deno suites — **15 passed,
  0 failed**; `deno check --no-lock` passed; `git diff --check` passed. The
  first remote SQL assertion was over-broad and matched the intended `elsif`
  fallback; after narrowing it to the standalone guard, the Dev SQL contract
  passed for both RPCs. Dev migration history records
  `20261028174558 phase3_sandbox_bachs_quote_acceptance`; post-apply body checks
  passed and the route table remained empty. Supabase Advisors show existing
  project-wide findings; no route was created or enabled. `deno fmt --check`
  flags pre-existing formatting throughout the two shared TypeScript files, so
  no unrelated mass reformat was applied.
- Local replay remains unavailable because Docker/Colima is inaccessible in
  this environment. No Production database/function change, provider call,
  route change, or visual QA occurred.

### P3-24 — Supabase Data API default-grant cutoff readiness

- Supabase's published 2026-10-30 change removes implicit Data API grants for
  newly created `public` tables/functions on existing projects. Audited Phase 3
  public payment tables: each source migration explicitly grants service-role
  access, sensitive tables revoke client access, and all seven are RLS-enabled.
  `provider_payment_settlement_checks` is intentionally service-role SELECT-only;
  writes go through the evidence-checking RPCs. Other claim/attempt tables use
  service-role SELECT/INSERT/UPDATE without DELETE/TRUNCATE.
- The catalog audit exposed an important Dev-only default-ACL mismatch: six
  claim/attempt tables still had service-role DELETE, TRUNCATE, REFERENCES, and
  TRIGGER privileges despite their migrations declaring only SELECT/INSERT/
  UPDATE. A code search found no delete/truncate path. Added forward-only
  migration `20261028182408` to revoke all and regrant the minimum used
  privileges; settlement checks remain SELECT-only. The SQL contract failed
  before that repair on `payout_claims`' DELETE grant and passed afterward for
  all seven tables, with no anon/authenticated privileges.
- Finalized the C2 trigger gap as migration `20261028182315`: the database guard
  now binds the correction to the snapshotted route and currency/entity, the
  same tailor across order/claim/payout/destinations, the failed tranche payout,
  and the latest provider-returned operation. The replacement must have current
  route capabilities and cleared first-withdrawal review. It is SECURITY INVOKER
  with an empty search path, and direct execution is revoked from client and
  service roles. The SQL identity contract passed in Dev.
- Recorded both exact versions in the Phase 3 Production release plan. The
  remote migration tool assigned `20261028182315` and `20261028182408`; local
  filenames and rollback names now match Dev history.
- Dev postflight: **0 enabled routes, 0 claim-linked snapshot corrections,
  0 Bachs destinations**. The correction table contains four pre-existing
  legacy rows (2 Stripe, 2 Paystack), all applied; none is linked to a Phase 3
  claim. Advisors still show broad project-wide findings; touched
  service-only tables produce the expected RLS-enabled/no-policy informational
  finding, while no new finding is tied to the C2 trigger or grant repair.
- Evidence source: [Supabase Data API grant guidance](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically).
  Local full replay remains blocked by the Docker socket permission error. No
  provider call, Production change, route change, or visual QA occurred.

### P3-25 — Remove direct execution from settlement trigger guard (Dev)

- A read-only Dev catalog audit found the legacy trigger-only
  `public.prevent_settlement_evidence_mutation()` still had inherited
  `PUBLIC EXECUTE`, making it directly callable by `anon`, `authenticated`, and
  `service_role`. Its body only raises an exception and its two append-only
  triggers were already enabled, so this was unnecessary RPC exposure, not a
  data-mutation bypass.
- Added a forward-only privilege repair that pins an empty `search_path` and
  revokes direct execution from all API roles while preserving the existing
  trigger bindings. Dev recorded it as
  `20261028183032_phase3_settlement_trigger_execute_grants`.
- The SQL contract passed in Dev: no role can directly execute the function,
  its config is `search_path=""`, it remains SECURITY INVOKER, and both
  append-only triggers are enabled. `git diff --check` passed. No data rows,
  provider calls, Production state, route status, or visuals changed. Dev has
  four pre-existing legacy destination-correction rows (2 Stripe, 2 Paystack)
  and zero claim-linked snapshot corrections; none was created by this brick.

### P3-26 — Revoke direct execution from legacy money triggers (Dev)

- A wider Dev catalog audit found four more trigger-only payment/payout
  functions inheriting `PUBLIC EXECUTE`: payment tax snapshot copy, payout
  change lifecycle guard, payout destination hold guard, and tailor payout
  currency sync. Each had exactly one expected enabled trigger. Their bodies
  and trigger bindings are unchanged; direct execution is not an application
  RPC path.
- Added migration `20261028183437` to revoke `PUBLIC`, `anon`, `authenticated`,
  and `service_role` execute grants from those four functions. The SQL contract
  passed in Dev: all four remain SECURITY INVOKER trigger functions, no API role
  can execute them directly, and each expected trigger remains enabled.
- No data rows or provider operations changed. Payment routes remain absent,
  Production is untouched, and visual QA remains deferred. PostgreSQL's
  [CREATE TRIGGER documentation](https://www.postgresql.org/docs/current/sql-createtrigger.html)
  identifies EXECUTE as a requirement for creating a trigger; the existing
  trigger bindings remained enabled after the role grants were revoked.

### P3-27 — Pin payment snapshot trigger search path (Dev)

- The post-change Supabase Security Advisor still reported one payment-related
  mutable-search-path finding: `public.copy_payment_tax_decision_snapshot()`.
  Its only relation reference is already schema-qualified, so pinning
  `search_path` to empty does not change resolution or trigger behavior.
- Applied migration `20261028183633` to Dev and added a SQL contract. It passed:
  the function remains SECURITY INVOKER, has an empty search path, is not
  directly executable by API roles, and its expected trigger remains enabled.
- Advisor evidence: the project-wide mutable-search-path count moved from 31
  to 30, and the filtered payment/payout/refund/Bachs/settlement findings moved
  from one to zero. This was an advisory-count reduction, not a claim that all
  project-wide findings are resolved. A follow-up catalog scan found zero
  directly executable client-role payment/payout/refund/Bachs/settlement
  non-trigger functions. See Supabase's
  [mutable search-path guidance](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable).

### P3-28 — Bridge payout-claim references across native ID types (Dev)

- A clean Production-shaped replay exposed a concrete release blocker: legacy
  Production order, tailor, and payout primary keys are UUID, while the restored
  provider-neutral claim foundation stores those references as text. The
  historical `20261022003751_payout_claims_and_attempts.sql` fails on a native
  `text REFERENCES ... (id uuid)` declaration. The later Phase 3 restoration
  migration `20261028014028` repeats that incompatible shape if it creates the
  table itself.
- Added forward-only migration `20261028185215` with unique generated text-key
  bridges on orders, tailor profiles, and payouts. It creates the service-only
  `payout_claims` shell before Phase 3 P3-1; the later `CREATE TABLE IF NOT
  EXISTS` then skips the incompatible inline FKs while continuing to install
  the rest of the claims foundation. Claim values and payout/refund amounts are
  not rewritten. The rollback companion refuses a destructive reversal.
- Applied exact version `20261028185215` to Dev. The SQL contract passed and
  Dev row counts were unchanged: 25 claims, 3 attempts, 82 orders, 49 tailor
  profiles, and 68 payouts. The three claim foreign keys now target the unique
  text bridges; RLS and service-only privileges passed the contract.
- Isolated UUID-schema proof: PostgreSQL 17.6.1.084 accepted the compatibility
  migration followed by the exact `20261028014028` restore migration; valid
  UUID identifiers worked through text claim references, and an invalid order
  reference was rejected by the FK. This used a disposable local container,
  not Production or a provider. The exact disposable `--rm` test container was
  stopped after the proof; no Supabase project or provider was involved.
- The full historical local replay remains incomplete: older verifier/source
  mismatches prevent an unmodified source replay from reaching this migration.
  The earlier temporarily adapted local historical files were restored, and
  that replay limitation is still a release gate. The Phase 3 Production plan
  now lists this exact Dev version as P3-0 and requires applying it before P3-1
  despite its later timestamp. No Production migration, Edge deploy, Bachs call,
  provider operation, route change, or visual QA occurred. `deno.lock` remains
  unrelated user work and was not included.
- Postflight `supabase db lint --linked --schema public --fail-on error` exited
  successfully with zero errors. It reported five warnings in existing
  functions outside this migration's scope (`reserve_bachs_payment_refund_retry_attempt`,
  `initialize_order_settlement_plan`, `finalize_claimed_staged_residual_transfer`,
  `derive_order_residual_settlement`, and `record_bachs_provider_dispute_event`);
  none is a P3-0 object.
- Re-ran the expanded catalog contract on Dev after strengthening it to verify
  all three unique bridge indexes plus the full client/service-role ACL matrix;
  it passed. A fresh route-status aggregate returned no Dev payment-route rows.
  The integrated `launch:contracts` run did not complete: the default Node 18
  stopped at an unsupported Node flag, while the bundled Node 24 attempt was
  halted by pnpm's no-TTY safeguard before it could purge/reinstall the
  workspace modules. I did not bypass that safeguard or alter dependencies.

### P3-29 — Restore clean integrated static checks

- The launch-contract Edge sweep exposed a pre-existing type error in
  `saved-tailor-action`: one `.insert()` received a union of tailor and
  ready-made payloads that Supabase's typed builder rejected. Split the calls
  by discriminant and kept their persisted fields and duplicate-recovery path
  unchanged.
- Checks: all **106** Edge function entrypoints pass
  `deno check --no-lock --sloppy-imports`; mobile, Ops, and web TypeScript checks
  pass. Shared Jest: **92 suites / 816 tests passed**. Ops Node tests: **81
  passed**; Ops UI tests: **23 passed**; interaction contract: **117 checks
  passed**. Mobile, Ops, and web ESLint all exit 0 (mobile reports 392 warnings,
  web 32 warnings, no errors). Mobile cache/media tests: **3 passed**; mobile
  contract scripts passed. `git diff --check` is the formatting gate for the
  touched source; `deno fmt --check` on the legacy Edge file reports broad
  repository-style differences, so no whole-file reformat was applied.
- The top-level `pnpm launch:contracts` wrapper still cannot complete in this
  workspace: Node 18 fails on its Node 22+ test flag, while bundled Node 24
  stops at pnpm's no-TTY module-purge safeguard. Dependencies were not purged
  or reinstalled. Its substantive checks were run directly as listed above;
  the wrapper itself remains an environment limitation, not a clean full-run
  claim. No deployment, provider call, route change, or visual QA occurred.
- Additional linked Dev lint for `public,util` completed with **0 errors** and
  five warnings in existing PL/pgSQL functions; none is a P3-0 object. The
  additional Ops Deno suites completed **42/42**. The Production Edge candidate
  list was refreshed to include the touched `saved-tailor-action` entrypoint;
  recompute the complete function/shared-dependency set from the final PR head
  before any Production deploy approval.
- **Approved read-only Production P3-0 preflight (2026-10-28):** migration
  `20261028185215` is absent. `orders.id` and `payouts.id` are UUIDs and both
  already have stored generated `text` `id_text` columns with valid unique
  indexes and zero value mismatches. `tailor_profiles.id` is UUID and has no
  `id_text` bridge, so P3-0 must add that column/index. `payout_claims` is absent.
  Aggregate counts: 5 orders, 0 payouts, 27 tailor profiles. `payment_routes`
  has no rows (not merely rows marked disabled). No customer/payment rows were
  selected and no Production object was changed. This preflight supports the
  migration's `IF NOT EXISTS` behavior for the two existing matching bridges;
  apply P3-0 only after its separate Production migration approval.
- A read-only Dev secret-name check after the user said they would configure
  Bachs credentials found the legacy `BACHS_API_KEY`, but neither
  `BACHS_SANDBOX_API_KEY` nor `BACHS_SANDBOX_WEBHOOK_SECRETS`. No values were
  printed. Until those two secrets are configured, provider-write and
  signed-event proof remains open. No visual QA was performed.

### Local replay root-cause confirmation — 2026-10-28

- Inspected the isolated `drape-phase3-replay-local` database read-only. It has
  357 migration rows and is stopped at `20260826120020`; no migration was
  applied by this inspection. The failing next migration,
  `20260826120030_repair_legacy_stage_update_and_settlement_calls.sql`, expects
  three legacy function-body strings. The first two are present, but
  `prepare_material_unused_value_refund` already contains
  `initialize_order_settlement_plan(v_advance.order_id::text)` from the earlier
  source migration, so the later migration raises because its uncast pattern is
  absent. The earlier migration source itself confirms the cast is already
  present.
- This is a historical source-chain inconsistency, not a Docker availability
  failure and not evidence of a Production runtime outage. `AGENTS.md` makes
  applied migrations immutable; no historical migration was edited and no
  replay bypass was used. The clean full-replay gate remains open until a
  compliant rehearsal strategy is agreed and proven. No Dev or Production
  schema was changed.

### Integrated launch-contract rerun — 2026-10-28

- Re-ran the repository's exact `pnpm launch:contracts` command with Node
  `v22.23.2` (satisfies the root engine requirement). The complete command
  exited **0** with `Launch contract checks passed.` This closes the prior
  Node-version/no-TTY wrapper limitation for this worktree; no dependency purge
  or reinstall was needed.
- The run covered the release and marketing contracts, Paystack-retirement
  checks, mobile release guards, mobile/Ops/web checks, and the full Edge
  entrypoint type-check sweep. Existing lint warnings remain (mobile 392, web
  warnings); no lint errors were reported.
- No production changes, provider operations, route changes, or visual QA were
  performed. `deno.lock` remains an unrelated existing worktree change and was
  not staged or edited.

### P3-0 Production schema application — 2026-10-28 (history reconciliation open)

- After explicit approval for only migration `20261028185215`, the Supabase
  migration MCP applied its SQL successfully but recorded it under its generated
  version `20261028191928` (`phase3_claim_native_id_compat`). The expected
  version `20261028185215` is still absent from Production history. Do not apply
  the SQL again. This history mismatch must be reconciled with the supported
  `supabase migration repair` path before any later Production batch.
- Schema postflight passed: all three `id_text` columns are generated from their
  UUID IDs and have valid unique indexes; `payout_claims` exists with RLS on,
  zero rows, all three text-reference FKs validated, and its immutable-identity
  trigger enabled. Production still has zero payment-route rows. Project state
  is `ACTIVE_HEALTHY`.
- Production queue/cron aggregate remains 9 `DEAD`, 5,394 `SUCCEEDED`, and 22/22
  cron jobs active; these match the previously observed pre-existing dead-job
  queue state. Database counters show no deadlocks; I/O counters are cumulative
  and do not establish a before/after change.
- The table currently has extra default `service_role` privileges beyond
  SELECT/INSERT/UPDATE (including DELETE/TRUNCATE). The already planned P3-24
  migration `20261028182408` explicitly revokes these and re-grants only the
  needed operations; it must be applied before any Phase 3 Edge release. The
  Advisor's RLS-enabled/no-policy INFO for this service-only table is expected.
- The production CLI history-repair command could not be used from this shell:
  the linked CLI has no database password configured and DNS access was denied.
  No direct edit to the migration-history table was attempted. No other
  Production schema, Edge, web, secret, provider, or route state was changed.

### Bachs sandbox credential and P3-0 repair recheck — 2026-10-28

- The user authorized handling Bachs sandbox keys in the signed-in Chrome tab.
  Computer control timed out on four connection attempts, including a direct
  Chrome-tab lookup; it never returned a tab or account state. The local
  clipboard contained zero bytes. No key was viewed, created, copied, logged,
  or set in Dev, and no Bachs provider setting was changed. Retry the browser
  connection before claiming a sandbox write or signed webhook proof.
- Rechecked the installed CLI's `supabase migration repair --help`: the
  supported repair accepts an explicit database URL or a linked-project
  database password, plus applied/reverted status. This checkout is linked to
  Dev and has neither Production connection credential. A scoped, separate
  Production approval was granted for a history-only repair. A conditional,
  single-row update through the connected Supabase SQL tool changed only the
  generated history version to the source version, preserving the recorded
  migration statement and metadata; this differs from the CLI repair procedure
  proposed in the release plan because the CLI could not connect to Production.
  Postflight: source version `20261028185215` occurs once, generated version
  `20261028191928` occurs zero times, `payout_claims` retains RLS, and enabled
  routes remain zero. No migration SQL was replayed. P3-1 was then separately
  approved and preflighted as recorded below.

### P3-1 Production foundation release — 2026-10-28

- After separate approval, preflight confirmed all five exact P3-1 versions
  absent, no `BACHS` provider enum value, P3-0's `payout_claims` shell present,
  the three other claim tables absent, destination-correction and Money Desk
  prerequisites present, and zero enabled routes.
- Applied only source migrations `20261028014025`, `20261028014028`,
  `20261028014031`, `20261028014035`, and `20261028014040` in dependency order.
  The Supabase migration tool generated a new version for each; after each
  successful application, a conditional, single-row history correction set
  the exact source version without rerunning SQL and preserved its recorded
  statements. Postflight found all five source versions once and no generated
  versions. This is the same tool-version deviation documented for P3-0.
- Production now represents `BACHS` in the provider enum and has the restored
  payout-attempt, refund-claim, and provider-operation tables. All four claim
  tables have RLS enabled, no client SELECT grant, and service-role
  SELECT/INSERT/UPDATE. Six checked business-key/operation/charge indexes and
  both immutable-identity triggers are present. Three payout-claim FKs, one
  refund-payment FK, and the Bachs charge-shape constraint are validated. All
  four new claim tables have zero rows. Production has zero payment-route rows
  and zero enabled routes; project state remains `ACTIVE_HEALTHY`.
- Security Advisor reports no new client-exposed claim-table finding; its four
  new RLS-without-policy INFO notices are expected for service-only tables.
  Performance Advisor reports two new INFO unindexed FKs on
  `payout_attempts.claim_operation_id` and
  `payout_provider_operations.reviewed_correction_id`; these need a forward
  index repair before high-volume use, but do not enable money movement.
  Existing project-wide Advisor warnings remain. No Edge, web, secret,
  provider, or route setting was changed. P3-2 requires its own approval.

### P3-29 — Restore claim-FK index source — 2026-10-28

- Production P3-1 Performance Advisor identified two new INFO unindexed-FK
  notices. Dev already has both exact indexes, but `rg` found no migration source
  for them. Added forward migration `20261028195902` plus a scoped rollback to
  make that Dev schema reproducible rather than leaving a hidden manual delta.
- Applied the migration to Dev only; its `CREATE INDEX IF NOT EXISTS` statements
  found the matching indexes already present. Reconciled the tool-generated
  history marker to source version `20261028195902`. Postflight: source version
  once, generated version zero times, both expected index definitions present.
  No Production index, Edge, route, provider or secret was changed. This small
  release unit needs its own Production approval after the earlier dependency
  batches; it is listed as P3-29 in the release plan.

### Isolated historical replay continuation — 2026-10-28

- The existing local `supabase_db_drape-phase3-replay-local` container is healthy
  and contains the replay stopped before `20260826120030`. Confirmed its
  `prepare_material_unused_value_refund` function already had the target
  `order_id::text` cast, although that historical migration expects to add it.
- In this isolated local database only, temporarily restored that single call
  to the expected pre-repair spelling, then ran the **exact unchanged source**
  of `20260826120030_repair_legacy_stage_update_and_settlement_calls.sql` with
  `ON_ERROR_STOP=1`. It completed successfully, and postflight confirmed the
  function again has the intended `order_id::text` cast. Neither the applied
  migration source nor Dev/Production schema was edited. This proves one
  historical mismatch can be normalized for rehearsal; it does **not** count
  as the full clean migration/rollback replay required before D2. The local
  replay runner still needs to advance from this point and record further
  mismatches separately.

- Continued the same isolated local stack with a mechanical copy of the current
  migration files and the Supabase migration runner. Registered only the
  already-applied `20260826120030` in that local history. The runner first
  stopped at `20260910211000` because the local Ops environment was UNKNOWN;
  configured it through the migration's guarded RPC as DEVELOPMENT using a
  synthetic local-only project ref, then reran. It advanced through the
  September and early-October migrations to `20261022003751`.
- `20261022003751_payout_claims_and_attempts.sql` fails on its first FK:
  `payout_claims.order_id text references orders.id uuid` (SQLSTATE 42804).
  Its source uses unconditional `CREATE TABLE`, so the later P3-0 shell cannot
  make this exact historical migration replayable. This is the previously
  identified native-ID historical-source mismatch, now reproduced by the
  actual Supabase runner after passing the intervening migrations. No Dev or
  Production data changed. A full unmodified historical replay remains
  impossible as written; D2 must use an explicitly reviewed, Production-shaped
  baseline plus exact Phase 3 migrations/rollbacks, or an isolated rehearsal
  overlay that corrects the historical file without changing its applied
  repository source. Neither alternative has been claimed as complete.

### Disposable full-chain overlay and rollback rehearsal — 2026-10-28

- Continued **only** the disposable `/private/tmp/drape-phase3-replay-local`
  stack. Its core IDs are native UUID; orders and payouts already had generated
  text bridges, while tailor profiles lacked one. Added that bridge locally,
  then changed only the copied `20261022003751` migration to reference the
  three generated `id_text` keys. The checked-in historical migration was not
  edited.
- The runner then reached `20261025020517` and found another historical source
  gap: it patches `reconcile_confirmed_tip_refund_receipts(integer)`, but no
  checked-in migration defines that function. Dev has it, confirming this is
  source drift, not a new Phase 3 type error. A second disposable-copy overlay
  skipped only that patch when the function is absent. The checked-in source
  and Dev/Production function definitions were not changed.
- With these two copy-only overlays plus the earlier local Ops configuration,
  `supabase migration up --local` completed successfully through
  `20261028195902`. Local history has 636 versions; the four claim tables
  exist, both restored FK indexes are present, and zero payment routes are
  enabled. This is an **overlay rehearsal**, not an exact unmodified-history
  replay or a Production release signoff.
- Rehearsed all 19 top-level `20261028*` rollback scripts inside separate local
  transactions that were rolled back. Seventeen passed individually, the
  returned-tranche function rollback passed after its trigger rollback in
  reverse dependency order, and P3-0's rollback raised its expected
  forward-only stop. Postflight still found 636 history rows, both FK indexes,
  and zero enabled routes. The rollback test proves the scripts' executable
  shape against this overlay schema; it does not prove that a live Production
  rollback would be safe after money moves.
- Found 13 more Phase 3 rollback scripts in `supabase/migrations/rollback` that
  the first glob had not covered. Rehearsed all 13 in rolled-back local
  transactions: ten executable scripts passed and three forward-only guards
  raised their intended stop. In total, 28 executable rollback scripts passed
  and four forward-only stops behaved as designed. All 12 existing
  `supabase/tests/phase3_*.sql` contracts passed in rolled-back transactions.

### P3-30 — Preserve bound Bachs refund ID — 2026-10-28

- The full-chain overlay exposed a stale refund verifier. Its old text check
  expected every `provider_refund_id` change to be rejected, while the current
  Dev trigger allows first binding but unintentionally also allows a bound ID
  to be cleared on a pending/unknown refund attempt. Read-only Dev inspection
  confirmed the same weak null guard; Dev has zero refund-attempt rows.
- Added forward migration `20261028201407` to replace only that reviewed guard
  condition: once non-null, a provider refund ID cannot change to null or a
  different ID. Updated the verifier to assert the stronger current contract
  and added a behavior test using a temporary table/trigger. No accepted
  earning, refund amount, provider operation, or route selection changes.
- Isolated local overlay: migration applied; new behavior test and updated
  verifier both passed in rolled-back transactions. Dev: exact source version
  reconciled into history, strict guard confirmed, and both the behavior test
  and updated catalog verifier passed inside rolled-back transactions. No
  Production schema, Edge, web,
  secret, provider, or route setting was changed. P3-30 requires separate
  Production approval before the dependent refund Edge release.

### Production-shaped Phase 3 rehearsal — 2026-10-28

- User chose a Production-shaped baseline instead of treating the historical
  overlay replay as D2 signoff. Reused an isolated local Phase 2 rehearsal stack
  with native UUID `orders`, `payouts`, and `tailor_profiles` IDs, generated
  `id_text` bridges on orders/payouts, zero payment-route rows, and no Phase 3
  history. Its synthetic data is local only. A separate database clone attempt
  failed on Supabase extension/role restrictions, was not used as evidence,
  and the failed local clone was removed.
- Applied the 16 exact forward fix-up SQL files locally, then the exact P3-0
  native-ID prerequisite, then 44 of the remaining 45 Phase 3 SQL files in
  source order. P3-10 (`20261028150745`) stopped because
  `public.tip_money_operation_claims` does not exist in this Phase 2 baseline.
  The separate historical source `20261022002558` creates that table and its
  reservation RPC. Production history has zero `20261022`–`20261025`
  versions. A separately approved, read-only Production catalog check now
  confirms the TIP table and all seven scoped TIP claim/runtime RPC signatures
  are absent. This is a **confirmed Production release gate**; P3-10 cannot be
  promoted safely without a reviewed forward-only Phase 1 TIP-claim closure.
- For dependency diagnosis only, applied the exact historical TIP base migration
  to the local stack; P3-10 then compiled. This is **not** an exact Phase 3-only
  rehearsal pass, and it does not restore the other historical TIP outcome and
  finalization RPCs needed by deployed TIP paths. The 13 Phase 3 SQL contract
  files passed once local migration-history names were populated and each test
  ran in one transaction (temporary-table probes use `ON COMMIT DROP`).
- Rehearsed all 33 Phase 3 rollback scripts against this local shape in
  transactions rolled back afterward: 27 executable scripts passed alone, the
  returned-tranche Ops rollback passed after its dependent trigger rollback,
  and five forward-only scripts raised their intentional stop. This is
  rollback-shape evidence, not permission to roll back a live money migration.
- D2 remains open until the TIP prerequisite is resolved by a reviewed
  forward-only repair, followed by a fresh
  exact Phase 3 replay and rollback rehearsal on a clean Production-shaped
  baseline. No Dev or Production change was made by this rehearsal.

### TIP claim forward closure and D2 local rehearsal — 2026-10-28

- Added `20261028210000_phase3_tip_claim_forward_closure.sql` instead of editing
  any historical `20261022`–`20261025` migration. It restores the Dev-verified
  final TIP claim table, uniqueness/FK/RLS/grant guards, the reservation,
  outcome and finalizer RPCs, and the three claim triggers. Its rollback is an
  explicit forward-only stop so recorded money operations cannot be dropped.
  No route, earning, refund amount, payout schedule or provider setting changes.
- Local UUID-shaped Phase 2 baseline with no TIP claim objects: the forward
  repair compiled and the new privilege/constraint/function contract passed.
  Applied the same migration in Dev; reconciled the generated history marker
  `20261028205217` to exact source version `20261028210000` with the supported
  migration-history repair command. Dev postflight: source version once,
  generated marker absent, 18 existing TIP claim rows preserved, zero enabled
  routes. The new SQL contract passed; linked public-schema lint returned no
  errors. Security/Performance Advisors showed only the existing TIP-table
  INFO notices (RLS without client policy, unused payout index), no new TIP
  warning.
- Reset only the agent-created, empty TIP objects in a second disposable local
  Phase 2 stack. Applied its missing UK Phase 2 gate, the 16 exact forward
  fix-ups, P3-0, all other exact Phase 3 files in release order, and the new
  TIP closure immediately before P3-10. **All 47 Phase 3 SQL files applied**
  without historical-source overlays. All 14 Phase 3 SQL contracts plus the
  adjacent Phase 1 TIP runtime contract passed. The baseline retained UUID
  order IDs, zero TIP rows and zero enabled routes.
- Rehearsed all 34 Phase 3 rollback companions in rolled-back local
  transactions: 27 executable scripts passed alone, the returned-tranche Ops
  rollback passed after its trigger in the same transaction, six forward-only
  scripts raised their intentional stop, and zero unexpected failures occurred.
  This closes the **local Production-shaped D2 migration/rollback rehearsal**
  selected by the user. It is not a claim of a full unmodified historical
  replay, a live Production rollback, or a provider collection→withdrawal proof.
  Production TIP closure and every later batch still need separate approval.
- Attempted the signed-in Bachs Chrome surface twice for the sandbox credential
  and webhook setup; computer control timed out before any page state was read.
  No key was created or copied, no Dev secret was changed, and no provider
  sandbox collection/transfer/withdrawal was claimed. The previously requested
  P3-2 Production approval is still outstanding; no further Production batch
  was applied in this turn.

### Integrated contract rerun — 2026-10-28

- Re-ran `pnpm launch:contracts` under Node 22.23.2 on the current Phase 3
  branch: passed (including mobile/web/Ops typechecks, 92 shared suites and 816
  shared tests, Edge typechecks, and release contracts). Mobile lint reported
  392 warnings and web lint 32 warnings, with zero errors in either.
- A first invocation under the machine's default Node 18 stopped at the
  unsupported `--experimental-strip-types` flag; the Node 22 rerun is the
  authoritative result. Read-only `git merge-tree` found no conflict with
  current `origin/main`. The unrelated local `deno.lock` change remains untouched.
- Bachs Chrome control timed out before exposing page state again. No provider
  key, Dev secret, route, or Production setting was changed. P3-2 Production
  approval and signed sandbox collection→withdrawal proof remain open.

### Main integration check — 2026-10-28

- Merged current `origin/main` (ten newer commits covering web observability,
  Sentry Ops context, and mobile auth restore) into the Phase 3 branch without
  rewriting history. The pre-merge tree check found no conflicts; the unrelated
  local `deno.lock` change was not touched.
- Installed dependencies from the committed lockfile with `pnpm install
  --frozen-lockfile`. Web and mobile typechecks passed under Node 22; the nine
  affected Sentry Edge tests passed. The first web typecheck had missing Sentry
  modules only because this checkout's `node_modules` predated main's lockfile;
  the frozen install resolved it without changing the lockfile.
- Production P3-2 still needs its separate batch approval. No Production or
  provider state was changed in this integration step.

### P3-2 Production release — 2026-10-28

- After the user's separate P3-2 approval, scoped preflight confirmed all five
  source versions absent in Drape-PROD, all prerequisite tables/columns present,
  all five target additions absent, project `ACTIVE_HEALTHY`, and zero route rows.
  The same five exact versions were already applied in Dev.
- Applied only `20261028014044`, `20261028015810`, `20261028021731`,
  `20261028022550`, and `20261028033130` in release-plan order. As in P3-1,
  the Supabase migration tool created a generated version per statement; after
  each successful apply, a conditional single-row history update changed only
  that marker to the exact source version. Postflight found all five source
  versions once and zero generated markers. No SQL was replayed.
- Verified the Bachs checkout request-state column and guard RPCs, account
  setup claim table with RLS, first-release review RPC, aggregate onboarding
  columns, payout-ledger link, four valid new indexes, two validated checks,
  and enabled ledger-immutability trigger. `anon`/`authenticated` cannot read
  setup claims or execute the sampled privileged RPCs; `service_role` can.
  There are zero setup-claim rows and zero payment-route rows/enabled routes.
- Production project remains `ACTIVE_HEALTHY`; Security Advisor showed only
  the expected new service-only RLS-without-policy INFO for the setup-claim
  table, and Performance Advisor the expected unindexed-FK INFO. Queue health
  returned no retryable or pending jobs (five unreviewed dead jobs already in
  the aggregate), 22 active cron jobs and zero failed runs in the past hour.
  No Edge, web, key, provider setting, payout, or route changed. P3-3 needs
  its own approval.

### P3-3 Production release and refund-claim guard gap — 2026-10-28

- The user corrected the accidental “Hold Production” selection and explicitly
  approved P3-3. Preflight confirmed all five versions absent, prerequisites
  present, no Bachs money rows and no enabled routes. Applied only
  `20261028035153`, `20261028041157`, `20261028041819`,
  `20261028041919`, `20261028053708` in order. Each successful migration-tool
  apply was conditionally reconciled from its generated history marker to the
  exact source version; postflight found five source versions and no generated
  markers. No Edge, web, provider, payout or route change was made.
- Postflight verified the refund-attempt table RLS/grants, its enabled identity
  trigger, valid new indexes, charge identity, payout transfer observations,
  and the new reservation/finalizer RPC signatures. Production remained
  `ACTIVE_HEALTHY`, with zero enabled routes, zero refund attempts/claims and
  zero payout claims. The Advisor findings remain the existing service-only
  RLS INFO and performance notices, with no new error identified.
- **Found a release gap:** Production has no user trigger on
  `order_payment_refund_claims`. P3-3 replaced the status guard function but
  did not attach it. The historical Phase 1 identity/status trigger migrations
  were never promoted. Thus the function alone does not enforce claim
  immutability or forward-only status. Hold P3-4 and all later Production
  batches until a forward-only trigger repair is separately approved and
  verified. With every route disabled and no claim rows, this is a future
  money-path gate, not evidence of a current customer charge.
- Added `20261028214803_phase3_refund_claim_trigger_forward_repair.sql` to
  restore the Dev-matching payment/claim identity function and attach both
  guards if absent. In a disposable local database, dropped only those two
  triggers inside a transaction, applied the repair, verified both restored,
  then rolled the transaction back. The dedicated SQL contract passed locally
  (guard presence/grants, unmatched source payment rejected, success without a
  provider ID rejected). The repair was applied to Dev and its generated
  history marker reconciled to exact `20261028214803`; linked public-schema
  lint passed. Dev retained its 15 existing refund claims and all original
  guard triggers. Production repair requires a new, explicit approval.

### P3-3 refund-claim guard Production repair — 2026-10-28

- The user separately approved exact `20261028214803`. Production preflight:
  source version absent, zero refund claims, zero enabled routes, no claim
  triggers, and the P3-3 status guard function present. Applied only the repair.
  The migration tool recorded generated `20261028215236`; a conditional
  single-row history correction changed only that marker to the approved
  source version, without replaying SQL.
- Postflight: source version once, generated marker absent; both enabled
  `order_payment_refund_claim_identity_guard` and
  `order_payment_refund_claim_status_guard` bound to their intended functions;
  `anon`/`authenticated` have no guard-function EXECUTE; zero refund claims and
  zero enabled routes. Production is `ACTIVE_HEALTHY`; Security Advisor found
  no finding on these guard functions, 22 cron jobs active and zero failed
  runs in the prior hour. The nine DEAD queue jobs are all dated September,
  with no pending jobs; they were not produced by this repair. No Edge, web,
  secret, provider, payout or route change was made.
- The P3-4 SQL batch still requires its own scoped Production approval. The
  earlier P3-3 approval and this guard-repair approval do not cover it.
- Full `pnpm launch:contracts` passed under Node 22.23.2 after the repair,
  including 92 shared suites/816 shared tests and Edge entrypoint typechecks.
  Mobile/web lint had warnings but zero errors. The unrelated `deno.lock`
  worktree change remains unstaged.
- A broader scoped catalog comparison found Dev has additional Phase 1
  refund/payout guard triggers absent from Production. Some later Phase 3
  migrations replace their function bodies but do not attach triggers. Added
  a final trigger-parity gate before the money Edge release; this needs a
  source-by-source audit and forward-only restoration, not a blanket Dev
  schema copy. All routes remain disabled and Production has zero claim rows.

### P3-4 Production schema batch — 2026-10-28

- Under the user's instruction to finish the scoped Phase 3 rollout, preflight
  confirmed all five P3-4 versions absent in Production and present in Dev;
  zero enabled routes, payout claims, attempts and provider operations; and
  zero exact-link backfill candidates. Applied only `20261028053938`,
  `20261028053952`, `20261028054016`, `20261028054237`, and
  `20261028054401`, reconciling each successful generated history marker to
  its exact source version. Postflight found five source versions, zero
  generated markers, no payout attempt/operation rows and zero enabled routes.
- Project remained `ACTIVE_HEALTHY`; Advisor warning counts did not increase;
  22 cron jobs active, no failed run in the prior hour, no pending/retryable
  jobs and no newly dead job. The broader claim-trigger parity gate remains
  open before any Phase 3 money Edge release.
- The safety review rejected the attempted P3-5 Production migration because
  it requires batch-specific approval for the payout/escrow behavior change;
  **P3-5 SQL was not applied**. Requested explicit approval for those exact
  five versions. Production was left at verified P3-4 state.

### P3-5 Production schema batch — 2026-10-28

- After the user's explicit P3-5 approval, fresh preflight confirmed P3-4's
  five source versions present, all five P3-5 versions absent, and zero route,
  payout-claim or destination-correction rows. Applied only `20261028061641`,
  `20261028062947`, `20261028063130`, `20261028094246`, and
  `20261028132120` in plan order. Corrected only each tool-generated history
  marker to its exact source version after successful application. Postflight
  found all five exact versions, no generated markers, no escrow-write rows,
  zero enabled routes and zero route rows.
- Verified the claimed-route tranche and staged-escrow finalizer signatures,
  the Bachs dispute-recorder signature, both payment-route method triggers,
  and the existing terminal-order guard binding. Project remains
  `ACTIVE_HEALTHY`; Security Advisor mutable-search-path warnings fell from
  32 to 31, other warning counts were stable; 22 active cron jobs, no failed
  run in the prior hour, no pending jobs or newly dead jobs. No Edge, web,
  provider setting, payout execution or route enablement occurred.
- The broader Phase 1 claim-trigger parity gate remains open before any
  Phase 3 money Edge release. P3-6 is a separate Production release unit.

### P3-6 Production schema batch — 2026-10-28

- After explicit P3-6 approval, fresh preflight found P3-5's exact versions
  present, all five P3-6 versions absent, zero enabled routes, no accepted
  route-snapshot orders, payout claims or destination corrections. Applied
  only `20261028132126`, `20261028132406`, `20261028132459`,
  `20261028132505`, and `20261028132557` in order. Reconciled each
  successful tool-generated history marker to the exact source version.
- Postflight: five source versions present, generated markers absent; enabled
  returned-tranche claim trigger, apply/reserve correction RPCs, two FK
  indexes, no client EXECUTE on correction RPCs, service-role access present,
  zero correction rows and zero enabled routes. Production `ACTIVE_HEALTHY`;
  Advisor warning counts stable, 22 active cron jobs, no failed run in the
  prior hour and no new dead or pending jobs. No Edge, web, provider setting,
  payout execution or route enablement occurred.
- The broader claim-trigger parity gate remains open before money Edge
  release. P3-7 requires separate Production approval.

### P3-7 Production refund-retry migration — 2026-10-28

- After explicit P3-7 approval, preflight found source version absent, zero
  refund claims/attempts and zero enabled routes. Applied only
  `20261028140403`; reconciled the tool-generated marker to the exact source
  version after successful application. Postflight confirmed exact version
  once, no generated marker, the reviewed retry RPC, two indexes, no client
  EXECUTE and service-role EXECUTE, zero refund attempts and zero enabled
  routes. Project `ACTIVE_HEALTHY`; Advisor warning counts stable, 22 active
  cron jobs, no failed run in the prior hour and no new dead/pending jobs.
- No Edge, web, provider call, payout execution or route enablement occurred.
  P3-8 and the broader claim-trigger parity repair remain separate gates.

### P3-8 Production Phase 1 claim-runtime repair — 2026-10-28

- After explicit P3-8 approval, preflight found `20261028150000` absent,
  zero payout/refund claims and zero enabled routes. Applied only that exact
  migration's SQL; reconciled the tool-generated history marker to the source
  version after successful application. Postflight confirmed the source version
  once and the generated marker absent.
- Verified all four claim RPC signatures, empty search paths, no `anon` or
  `authenticated` EXECUTE and service-role EXECUTE. Payout/refund claim rows
  and enabled routes remain zero. Production is `ACTIVE_HEALTHY`; Security
  Advisor warning counts are stable, 22 cron jobs are active, with no failed
  run in the prior hour, pending job, or newly dead job.
- No Edge, web, provider call, payout execution or route enablement occurred.
  The broader Phase 1 claim-trigger parity gate remains open before any money
  Edge release. P3-9 was separately preflighted: its source version is absent,
  and the exact old text/enum comparison targeted by the forward repair is
  present. Its Production application requires a separate batch approval.

### P3-9 Production tranche-reservation type repair — 2026-10-28

- After explicit P3-9 approval, preflight found `20261028150721` absent,
  P3-8 present, the exact old comparison in the target function and zero
  payout claims or enabled routes. Applied only the source SQL for
  `20261028150721`, then reconciled the successful tool-generated history
  marker to the source version and filename. Postflight confirmed that
  exact version once, no generated marker, and the corrected text comparison
  in `reserve_settlement_tranche_payout_row`.
- Production remains `ACTIVE_HEALTHY`; Security Advisor warning counts are
  stable, 22 cron jobs are active, with no failed run in the prior hour or
  pending job. Zero routes are enabled. No Edge, web, provider call, payout
  execution or route enablement occurred.
- P3-TIP is separately preflighted: its source version and table are absent
  in Production. It must be promoted before P3-10. The broader Phase 1
  claim-trigger parity gate remains open before the money Edge release.

### P3-TIP Production claim foundation — 2026-10-28

- After explicit P3-TIP approval, preflight confirmed source version
  `20261028210000` and `tip_money_operation_claims` absent, with zero enabled
  routes. Applied only that forward migration; reconciled its generated
  history marker to the exact source version after successful application.
- Postflight: exact source version once, generated marker absent, zero TIP
  claim rows, RLS on, all three TIP claim triggers enabled. Verified the
  reservation, outcome and finalizer function signatures: no `anon` or
  `authenticated` EXECUTE, service-role EXECUTE present. Production remains
  `ACTIVE_HEALTHY`; Security Advisor counts stable; 22 active cron jobs with
  no failed run in the prior hour or pending job. Routes enabled: zero.
- No Edge, web, provider call, payout execution or route enablement occurred.
  P3-10 is a separate release. The broader Phase 1 claim-trigger parity gate
  remains open before the money Edge release.

### P3-10 Production TIP runtime — 2026-10-28

- With explicit P3-10 approval and P3-TIP verified, applied only
  `20261028150745`, then reconciled the successful generated history marker
  to its source version. Postflight found the source version once, no
  generated marker, zero TIP claims or enabled routes. The TIP binding,
  provider-start and outcome RPCs have empty search paths, service-role-only
  EXECUTE and no client EXECUTE.
- Production `ACTIVE_HEALTHY`; Security Advisor counts stable; 22 active cron
  jobs, no failed run in the prior hour and no pending jobs. No Edge, web,
  provider call, payout execution or route enablement occurred.

### P3-11 Production settlement-fee evidence — 2026-10-28

- After explicit P3-11 approval, preflight found its source version absent
  and zero enabled routes. Applied only `20261028163119` and reconciled the
  generated marker to the source version. Postflight found one exact source
  version, no generated marker, RLS on, one enabled evidence guard trigger,
  zero evidence rows, and service-only access to registration, claim and
  recording RPCs.
- Production `ACTIVE_HEALTHY`; Advisors stable; 22 active cron jobs, no
  failed run in the prior hour or pending job. No Edge, web, provider call,
  payout execution or route enablement occurred.

### P3-12 Production signed settlement evidence — 2026-10-28

- After explicit P3-12 approval, preflight found its source version absent,
  P3-11 present, zero evidence rows and enabled routes. Applied only
  `20261028163827` and reconciled the generated marker to the source
  version. Postflight found the exact version once, no generated marker,
  all five signed-event evidence columns, zero evidence rows, and the three
  fee-evidence RPCs accessible only to `service_role`.
- Production `ACTIVE_HEALTHY`; Advisors stable; 22 active cron jobs, no
  failed run in the prior hour or pending job. No Edge, web, provider call,
  payout execution or route enablement occurred. P3-13 is a separate release.

### P3-13 Production settlement-evidence privileges — 2026-10-28

- After explicit P3-13 approval, preflight confirmed P3-12 present,
  `20261028164058` absent and zero enabled routes. Applied only the
  privilege-only source migration; reconciled the generated history marker
  to the exact source version. Postflight confirmed one source version, no
  generated marker, service-role SELECT true and direct INSERT/UPDATE/DELETE
  false on `provider_payment_settlement_checks`.
- Production remains `ACTIVE_HEALTHY`; Advisor counts stable, 22 active cron
  jobs, zero failed in the prior hour, no pending jobs and zero enabled routes.
  No data, Edge, web, provider call, payout execution or route change.

### P3-23 Production Dev-only quote acceptance guard — 2026-10-28

- After explicit P3-23 approval, preflight found the source version absent,
  P3-13 present and zero enabled routes. Applied only `20261028174558` and
  reconciled the generated marker to its source version. Both custom and
  ready-made acceptance RPC definitions now require the sandbox environment
  and a `SANDBOX_ONLY` route for Bachs; Production has zero enabled routes.
- Project `ACTIVE_HEALTHY`, Advisor counts stable, 22 active cron jobs, no
  failed run in the prior hour or pending job. No Edge, web, provider call,
  payout execution or route enablement occurred.

### P3-24 Production correction identity and claim grants — 2026-10-28

- After explicit P3-24 approval, preflight found both source versions absent,
  P3-23 present, and zero destination-correction rows and enabled routes.
  Applied only `20261028182315` and `20261028182408` in order and reconciled
  their generated markers to exact source versions. Postflight found both
  versions, no generated markers, the enabled prior-destination correction
  guard, zero correction rows, no anon/authenticated claim-table SELECT and
  service-role SELECT present.
- Production `ACTIVE_HEALTHY`; Advisors stable, 22 cron jobs active, no
  failed run in the prior hour or pending job, zero enabled routes. No Edge,
  web, provider call, payout execution or route enablement occurred.

### P3-25 Production settlement-trigger privileges — 2026-10-28

- After explicit P3-25 approval, preflight confirmed P3-24 present,
  `20261028183032` absent and zero enabled routes. Applied only the source
  migration; reconciled its generated history marker to the source version.
  Postflight found two active append-only guard triggers, an empty function
  search path and no anon/authenticated/service-role direct EXECUTE.
- Production `ACTIVE_HEALTHY`; mutable-search-path Advisor warnings fell
  from 31 to 30, other counts stable. 22 active cron jobs, zero failed runs
  in the prior hour and zero enabled routes. No data, Edge, web, provider or
  payout execution change occurred.

### P3-26 Production money-trigger privileges — 2026-10-28

- After explicit P3-26 approval, preflight confirmed P3-25 present,
  `20261028183437` absent and zero enabled routes. Applied only the source
  migration; reconciled its generated marker to the exact source version.
  Postflight found all four functions without direct anon/authenticated/
  service-role EXECUTE and all four trigger bindings still enabled.
- Production `ACTIVE_HEALTHY`; Advisor counts stable, 22 active cron jobs,
  no failed run in the prior hour and zero enabled routes. No data, Edge,
  web, provider call or payout execution change occurred.

### P3-27 Production tax-snapshot trigger path — 2026-10-28

- After explicit P3-27 approval, preflight confirmed P3-26 present,
  `20261028183633` absent and zero enabled routes. Applied only the source
  migration and reconciled the generated history marker to its source
  version. Postflight confirmed empty search path, direct anon EXECUTE
  denied, and the existing payment-tax snapshot trigger still enabled.
- Production `ACTIVE_HEALTHY`; mutable-search-path Advisor warnings fell
  from 30 to 29, other counts stable; 22 active cron jobs and no failed run
  in the prior hour. No data, Edge, web, provider or route change.

### Money-claim trigger parity audit — 2026-10-28

- Scoped catalog comparison over six Phase 1/3 money-claim tables found 43
  non-internal Dev triggers versus 10 in Production. The three TIP triggers
  now match, and the two core refund-claim guards were restored earlier;
  33 Dev trigger bindings remain absent in Production across refund claims,
  payout claims/attempts and provider operations.
- The backing-function name audit found only three of those 33 function names
  in Production. This is a function-and-trigger restoration, not simply a
  trigger attachment. The original definitions are available on the isolated
  `codex/payments-phase1-hardening` branch in 20261022–20261025 migrations;
  current Dev holds their final definitions. Reconcile each source and final
  Dev definition before writing a forward-only repair. No Phase 3 money Edge
  deployment may proceed until the missing guards are restored and verified.
- Production has zero payout/refund claim rows and zero enabled routes, so this
  audit does not establish that live customer money was affected.
- The first local rehearsal of the proposed guard functions failed before
  commit because `adjustment_money_operation_claims` is absent. A scoped
  Dev/Production catalog comparison found ten missing Dev tables in
  Production: adjustment switch/events and claims, consultation claims and
  refund holds, fabric/work funding sources and positions, payment-status
  observations, and email-provider events. Three payment-related columns
  are missing on existing tables, plus one unrelated profile column. The six existing claim tables have matching
  column sets. This broadens the repair prerequisite; do not deploy the
  untested draft guard migrations or Phase 3 money Edge functions yet.
- Four initial guard-repair SQL drafts were moved out of the branch to
  `/private/tmp/drape-phase3-guard-draft/` after the failed rolled-back local
  rehearsal. They are not committed, applied to Dev, or applied to Production.
  Revise them only after the missing-table/column prerequisites are defined.
- Built additive funding-position table repair `20261028234000` from the
  final Dev table shape, using the Production `orders.id_text` bridge for
  text order references. A rolled-back transaction on the local
  Production-shaped Supabase database passed. Automatic approval review first
  rejected the Dev apply, misidentifying the Dev target as Production and
  requiring migration-specific approval. After the user's explicit Dev-only
  approval, the migration applied to `pqptfuqogvrajozfsqzi`; its generated
  history marker was reconciled to the exact source version. Dev postflight:
  four RLS-enabled tables, zero enabled routes, `ACTIVE_HEALTHY`, no new
  Security Advisor warning. This schema migration intentionally adds no
  writer/validator function; the money Edge release remains blocked.
- Built `20261028235000` to restore consultation payout/refund claims,
  consultation refund holds, and adjustment payout/refund claims. Reconciled
  the final Dev constraints and indexes, including the
  `DRAPEON_FUNDED_UNPAID` adjustment mode, before release. A rolled-back
  Production-shaped local rehearsal passed. Applied to Dev only and reconciled
  its history marker to the exact source version. Dev postflight found all
  three tables RLS-enabled, exact migration version present and zero enabled
  routes. Its rollback file is intentionally forward-only to preserve future
  money-operation evidence. Production remains untouched by this repair;
  guard and money Edge releases remain blocked.
- Built `20261028235500` for adjustment release-policy and payout booking/
  adjustment identity columns, purpose constraints and unique indexes. The
  Production-shaped local rollback rehearsal passed. Applied to Dev as an
  idempotent parity check (the target columns already existed), reconciled its
  migration history to the source version. Production has not received this
  repair. No payout or route was enabled.
- Rehearsed all 30 candidate Phase 1 claim-guard functions and 33 trigger
  bindings in one rolled-back Production-shaped local transaction after the
  three dependency migrations. It passed after adding the baseline's missing
  `order_payment_refund_claims.refund_context` column inside that rollback-only
  transaction; the column is already present in both real Dev and Production.
  The draft guard SQL remains outside the branch and unapplied: Production has
  native UUID `orders.id`, `payouts.id` and `order_payments.order_id`, while
  Dev has text values. Claim `order_id` and `payout_id` are text in both.
  Functions copied verbatim from Dev would therefore fail on some Production
  money events despite compiling. Adapt and exercise those joins against the
  Production-shaped schema before any guard release.
- Rebuilt the guard repair as five forward migrations `20261029000000`–
  `20261029002000`: four missing dependency functions, ten refund guards,
  payout guards, provider-operation guards and 33 conditional trigger
  bindings. Adapted native UUID order, payout, profile and payment references
  through text comparisons; route-snapshot payouts now validate the pinned
  `payout_destinations` record for Bachs/Stripe while legacy orders retain
  their locked-provider fields. The local Production-shaped transaction
  compiled and rolled back. `plpgsql_check` reported zero errors across the
  bound trigger functions and four dependencies, after correcting the type
  mismatches it initially found. Applied the five versions in order to Dev
  only, reconciled history to exact source versions; Dev has all five and zero
  enabled routes. `pnpm launch:contracts` passed with the bundled Node 24
  runtime; the system Node 18 cannot run that suite. Runtime race and provider
  proof remain outstanding. The
  Production money Edge release and these five Production migrations remain
  gated.
- Added a rolled-back, Production-shaped local runtime fixture for the
  route-aware tranche guard. With an accepted NGN/Bachs snapshot, active
  destination, settled initial payment, eligible 80% tranche and reviewed
  release request, `payout_claim_tranche_source_guard` accepted the exact
  claim. When the pinned destination was then made inactive, a second eligible
  claim was rejected with the expected destination error. The fixture used
  local-only records and left zero route, destination or payout-claim rows
  after rollback. It is guard proof, not a Bachs provider transfer or
  withdrawal receipt.
- Repeated the same rolled-back Bachs tranche fixture with **all** payout-claim
  user triggers enabled, rather than isolating the source guard. The accepted
  claim and inactive-destination rejection both passed through the full claim
  trigger chain. The local database again retained zero route, destination or
  claim rows afterward. This exercises reservation-time SQL guards but not a
  provider operation or finalization.
- A broader Production function-signature comparison was rejected by
  automatic approval review because prior catalog approvals were narrower.
  Requested a separate names-only read; no indirect Production query or
  release followed the rejection.
- A later Production enum catalog read was likewise rejected as outside the
  approved scope. No alternate Production read was attempted; the existing
  `20261028014025` migration source establishes `BACHS` as a value of
  `payment_provider`, and the Production enum remains an explicit release
  verification item.

### P3-29 Production claim FK indexes — 2026-10-28

- After explicit P3-29 approval, preflight confirmed P3-27 present,
  `20261028195902` absent and zero enabled routes. Applied only the source
  migration and reconciled the generated marker to its exact source version.
  Postflight found both target partial indexes, no generated history marker,
  zero enabled routes and `ACTIVE_HEALTHY` project status. 22 cron jobs
  active, none failed in the prior hour. The Performance Advisor still reports
  unrelated unindexed FKs; both target indexes are present.
- No data rewrite, Edge, web, provider call, payout execution or route change.

### P3-30 Production refund-attempt provider ID guard — 2026-10-28

- After explicit P3-30 approval, preflight confirmed P3-29 present,
  `20261028201407` absent and zero enabled routes. Applied only the source
  migration and reconciled its generated marker to the source version.
  Postflight found the provider-ID immutability check in the guard body, its
  trigger enabled, zero generated marker and zero enabled routes.
- Production `ACTIVE_HEALTHY`; Security Advisor counts stable, 22 active
  cron jobs and no failed run in the prior hour. No Edge, web, provider call,
  payout execution or route change occurred.

### Phase 3 draft PR checks — 2026-10-28

- Draft PR #79 head `6dd0912b` passed Workers Builds and the full
  `static-contract` check (4m47s, run `40791136487`). This is source/CI
  evidence; the P3-F1/F2 Production schema units and Phase 3 money Edge/web
  releases remain separate approval gates. Every payment route stays disabled.

### Production P3-F1 and grant follow-up — 2026-10-28

- With batch-specific approval, Production preflight found all three exact
  versions absent, all required base tables present, zero payouts and zero
  enabled routes. Applied only `20261028234000`, `20261028235000`, and
  `20261028235500` in order, and reconciled each generated migration-history
  marker to its exact source version. Postflight found all seven new tables
  with RLS enabled, three expected payout/adjustment columns and constraints,
  target indexes, and zero enabled routes. Project status was `ACTIVE_HEALTHY`;
  22 cron jobs active and none failed in the preceding hour. No Edge, web,
  provider or route change occurred.
- Grant postflight exposed that the three consultation/adjustment claim tables
  retained default full `service_role` ACL, including DELETE/TRUNCATE. The F1
  migration granted SELECT/INSERT/UPDATE without first revoking the default
  service-role ACL. Customer API roles have no table grants. This is an open
  security deviation, not a passed grant check. Created forward repair
  `20261028235900`, rehearsed its apply/rollback on a Production-shaped local
  schema, then applied and verified it in Dev. Dev now has only
  `service_role=arw` on those tables; RLS remains on. Production repair is a
  separate approval gate before P3-F2. No Production grant repair was made.
- Production Security Advisor after F1 reports 101 `rls_enabled_no_policy`
  INFO findings (including the intentionally service-only new tables) and the
  pre-existing warning classes. Review the [RLS no-policy guidance](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
  when auditing service-only access; no new high-severity finding was observed.

### Production P3-F1R service-grant repair — 2026-10-28

- With separate approval, preflight confirmed exact repair version
  `20261028235900` absent, all three F1 versions present, the three affected
  tables still carrying full `service_role` ACL, and zero enabled routes.
  Applied only the repair and reconciled its generated migration marker to the
  source version. Postflight found `service_role=arw` (SELECT/INSERT/UPDATE)
  on all three tables, RLS on, zero anon/authenticated grants, and zero
  enabled routes. Production stayed `ACTIVE_HEALTHY`; 22 cron jobs active,
  none failed in the preceding hour. Security Advisor class counts were
  unchanged after the repair. No data, Edge, web, provider or route change.
- P3-F2 remains a separate five-version Production approval. The broader
  claim/RPC parity and Bachs write-capable sandbox proof remain Edge gates.

### Production P3-F2 claim guards and bindings — 2026-10-28

- With batch-specific approval, preflight found P3-F1/F1R exact versions
  present, all five P3-F2 versions absent, the required claim tables present,
  zero claim rows and zero enabled routes. Applied only `20261029000000`,
  `20261029000500`, `20261029001000`, `20261029001500`, and
  `20261029002000` in order; reconciled each generated history marker to its
  source version. All five exact versions are now present.
- Postflight compared the binding migration against the Production catalog:
  all 33 expected user triggers are present/enabled and call their intended
  functions. All 34 restored function names are present, with zero anon or
  authenticated EXECUTE privileges. Production remains `ACTIVE_HEALTHY`, with
  22 active cron jobs, zero failed in the prior hour, zero payout/refund claim
  rows and zero enabled payment routes. Security Advisor class counts were
  unchanged. No Edge, web, provider operation or route change occurred.
- The broader RPC dependency parity audit and signed, write-capable Bachs
  sandbox proof remain gates before the separate money Edge release.

### Scoped Phase 3 Edge RPC audit — 2026-10-28

- From the 151 changed `supabase/functions` source paths on PR #79, extracted
  the 96 distinct direct `.rpc()` names (excluding tests). With specific
  read-only approval, compared `public` and `payment_internal` callable
  signatures in Dev and Production, without reading function bodies or rows.
  Dev has all 96 names; Production has 95. The sole missing signature is
  `public.block_tip_payout_identity_conflict(uuid,text,jsonb) returns jsonb`.
  The other 97 callable signatures, including overloads, match Dev and have
  service-role EXECUTE permission. This blocks the money Edge release until
  repaired; no Production schema or Edge change resulted from the audit.
- Added forward-only repair `20261029002500`, with the exact function body
  matching the historical Dev migration. Its preflight requires the existing
  `BLOCKED_IDENTITY` constraint and enabled transition guard. Local
  Production-shaped apply/rollback passed, including rejection of invalid
  identity evidence and an unknown claim. The focused Edge wrapper suite
  passed 12/12 tests, including exact RPC arguments and mismatched-claim
  response rejection. Applied and verified in Dev:
  source version present, function callable by service_role only, transition
  guard enabled, zero enabled routes. Production repair needs its own approval.

### Scoped Bachs sandbox credential — 2026-10-28

- Created one sandbox-only key for Dev proof. It has read/write access for
  connected accounts, payments, refunds and transfers, and read-only access
  for balances, payouts and webhooks. Full access and unrelated scopes are off.
  Set only Dev `BACHS_SANDBOX_API_KEY`; its Dev secret digest matched the
  copied `sk_sandbox_` key. Cleared the clipboard and did not print the key.
- A GET-only `/v1/balances` probe from the Mac received Cloudflare Error 1010
  (`browser_signature_banned`, owner action required). Stopped direct Mac API
  calls on that response; this is not evidence of a Bachs API or Dev Edge
  failure. The Dev webhook endpoint and signed provider proof remain open.
- Registered a Bachs sandbox account-event endpoint for the Dev
  `bachs-webhook` function, with 13 collection, checkout, dispute, refund,
  transfer and payout events. Its signing secret is in Dev as
  `BACHS_SANDBOX_WEBHOOK_SECRETS`, verified by digest; no value was logged.
  The Dev function is ACTIVE v8 with `verify_jwt=false` and performs its own
  HMAC verification.
- Registered a separate connected-account event endpoint, needed because the
  Bachs portal makes account and connected-account event sources mutually
  exclusive. A shell-stdin mistake printed this second sandbox signing secret
  in local tool output before Dev configuration. Disabled that endpoint
  immediately, cleared the clipboard, and asked for credential rotation under
  the browser safety policy. The first endpoint remains enabled and its secret
  was not exposed. No Production endpoint or credential was touched.

### Dev sandbox route and recipient proof — 2026-10-28

- With the specifically approved Dev QA admin fixture, created principal
  `224b1a06-4a71-4e1c-8817-4e6349d56a8f` with a non-deliverable `.invalid`
  address, no access subject and development-only roles. Provisioned route
  `d70aeeca-6e54-4f2d-a4c4-a82893c686a5` as `SANDBOX_ONLY`, and domestic
  NG delivery rule `29ff7bcd-db21-4a8a-84b7-103f1c799732` as READY in Dev.
  Enabled the Dev-only onboarding flag for the test. Afterwards, while the
  remaining proof waits, used the audited kill switches to return the route and
  delivery rule to `DISABLED` and set the onboarding flag to `false`; all three
  were verified. Dev has zero `ENABLED` routes. Retire the QA principal and
  remove the fixtures in the final approved cleanup. No Production change occurred.
- Three tagged, unpublished and unverified QA tailor profiles have no phone or
  push token. User/profile IDs are `d650efa2-a447-4c6a-9689-e27728641c74` /
  `df02b03d-6897-4916-b049-3497f7f516cc`,
  `aa2892f9-7a00-4a8a-8e0f-1499d7ae42b3` /
  `86f1e740-71d1-4373-a782-38454691f3b8`, and
  `3052d54e-6cdb-4c5a-991c-5499ff2c7fc8` /
  `c3278e33-3a3a-40e4-b742-136f9e9844e5`.
- The first two account-creation requests returned Bachs `400 VALIDATION_ERROR`
  using `.invalid` addresses and left reserved claims
  `284a6d8b-bb3f-477a-8cd8-545698cb6cc5` and
  `36b074c5-64f2-4eab-a981-6ab4770039b6`, with no provider ID. A third used
  `example.com` (whose MX is `0 .`, so it cannot receive mail) and succeeded.
  This suggests the provider rejected the first test email format; the provider
  did not expose a field name in its response logs, so that cause is not proven.
- The actual Dev action created Bachs sandbox recipient
  `acct_LPvacykCDo2YmEFW`, bound claim `0fa032c6-e7b0-4a21-8b75-77d6291383b6`
  and destination `3300fa5b-e261-4e1b-b59e-aa07f40f3e20`, and returned a
  hosted onboarding link. Bachs reported transfer/payout capabilities active;
  the destination remains inactive with first-withdrawal review PENDING and
  identity/name and payout-destination requirements outstanding. The hosted
  screen requested identity information and acceptance of Bachs terms; nothing
  was submitted. Collection, transfer and withdrawal proof remain open.
- Added bounded, allowlisted Bachs validation-field and request-ID diagnostics;
  provider messages and customer values are not logged. Added Dev-only
  suppression for the tagged QA account emails. Bachs client tests passed 7/7,
  account-email tests 6/6, and both affected Edge entrypoints type-checked.
  Deployed only `payout-account-action` v84 and `process-job-queue` v116 to Dev
  with existing JWT settings preserved. Four targeted QA mail jobs subsequently
  recorded `SKIPPED / DEV_QA_SUPPRESSED`, with no provider references. Two
  earlier jobs were marked succeeded for `.invalid` addresses; no real mailbox
  can receive them. One `example.com` attempt was rejected by Resend before
  suppression. No QA-linked Ops cases or push tokens were found.
- A temporary service-only Dev helper could not be used (HTTP 403). Automatic
  approval review rejected adding authorization/secret-presence diagnostics to
  it as an unnecessary disclosure. Replaced it with an inert HTTP 410 function
  and verified that response. Remove that temporary function in the final
  batched Dev cleanup; do not treat it as provider proof.

### Bachs onboarding readiness guard — 2026-10-28

- The actual sandbox recipient reported both payout capabilities active while
  two onboarding requirements were still due. The first-release review RPC
  previously checked capability status only and could have activated that
  destination before those requirements were complete.
- The provider refresh now treats missing, malformed, due or pending
  requirements as unavailable; it activates only after complete requirement
  arrays, both capabilities and the existing review are clear. Migration
  `20261029003000` adds a validated DB constraint for active Bachs destinations
  and a trigger that requires recent, complete onboarding evidence before the
  first-release review can be cleared. No customer earning or payout timing is
  changed.
- Local apply → rollback → reapply and the rollback-only SQL behavior proof
  passed, covering due, pending, missing, stale, complete, subsequent loss and
  attempted reactivation. Eight destination tests and both affected Edge
  typechecks passed. Applied the single migration to Dev via a temporary CLI
  workspace after dry-run showed exactly that file; Dev history contains the
  exact version, the constraint is validated, and the trigger is enabled.
  The real Dev QA destination had two due requirements and the review RPC
  rejected clearance with `23514`; no review event was saved and it stayed
  PENDING/inactive. Dev routes remain disabled.
- Production: approved exact migrations `20261029002500` and `20261029003000`
  applied in order. Both history versions, service-only TIP RPC privileges,
  validated constraint, enabled trigger, health and zero enabled routes verified.
  The first approved synthetic TIP RPC call used incomplete evidence and stopped
  at validation. A follow-up call with the required synthetic identity-conflict
  evidence and the all-zero claim UUID returned the expected `Tip payout claim
  not found` error. It stopped before any claim update or Ops-case insert; no
  real claim or payout was touched.
  The Edge and web releases remain separate approval gates.

### Release gate reconciliation — 2026-10-29

- The final full `pnpm launch:contracts` run passed on code commit `750e23e5`.
  The following commit `6d1471f0` only corrected the Production release plan.
  `git diff --check` also passed after the documentation update.
- Recomputed the Phase 3 Edge deployment set from the final PR source, including
  transitive imports of changed `supabase/functions/_shared` and
  `packages/shared/src` modules. The correct candidate is 40 functions, not the
  earlier 14-index-only list; the release plan now records the full set.
- Cloudflare's PR bot now reports commit `6d1471f0` deployed successfully to
  Production Worker `drape`, and build
  `cb8db290-7a71-4c71-9f8c-080a3076cce1` for commit `76021d8c` also completed.
  This means the PR branch triggered Production web deployments while PR #79
  was still draft and without the separately required web-release approval.
  The user approved cancel/rollback after the build had completed. Cloudflare
  MCP requires reauthentication, Wrangler has no local
  `CLOUDFLARE_API_TOKEN`, and browser control is timing out. The last
  bot-reported successful deployment before PR #79 was `fd89ffc6` (build
  `103d36db-73c3-4a3b-8866-cfa843ec847a`, PR #72); this is only a rollback
  candidate until matched to its Cloudflare Worker version. Reconnect Cloudflare
  access, verify that mapping, and restore it before treating the web release as
  approved or complete. No rollback or setting change was made.
  The account owner reports Google has disabled the Google account for 30 days,
  blocking Cloudflare's Google sign-in. Cloudflare documents password reset for
  social-login accounts, but it sends the reset to the Cloudflare account's
  original email; the owner's Outlook address with a similar local part is not
  the same mailbox. An existing Cloudflare account member could invite the
  Outlook identity; otherwise the owner needs Cloudflare account-recovery/support
  guidance. No alternative Cloudflare account has been created, and the
  approved rollback remains pending authenticated access and version mapping.
  A fresh Cloudflare API identity check on 2026-10-28 still returned
  `MCP authentication required`; the rollback is therefore still not performed.
  The access and release-control gate is now recorded in `docs/launch-gates.md`.
  The repo already contains a non-main branch guard in
  `apps/web/scripts/cf-preview.mjs` and `cf-build-mode.mjs`; Cloudflare Workers
  Builds inject `WORKERS_CI_BRANCH`. The successful Production build therefore
  indicates the connected build is likely bypassing the guarded script, or the
  Worker production branch is configured to this feature branch. This is not yet
  proven because the dashboard build settings/logs are inaccessible. Recovery
  must verify the production branch is `main`, use the guarded script as the
  production deploy command, and keep preview builds disabled until isolated
  preview resources are configured. Do not push another commit to this branch
  before checking those settings.
- GitHub's connected integration returned 403 `Resource not accessible by
  integration` when asked to refresh PR #79's body. A fresh read confirms PR #79
  remains open and draft at head `76021d8c`; its hosted body is still stale and
  incorrectly says five guard migrations are Dev-only, and it omits the
  bot-reported draft-branch Production Worker deployments. A second body update
  attempt returned the same 403, so the PR itself was not changed. The branch
  release plan and progress log contain the current status.
- The first approved Production synthetic TIP RPC call stopped at evidence
  validation. The follow-up used valid synthetic evidence and the all-zero UUID,
  reached claim lookup, and returned `Tip payout claim not found` without writes.
  This closes the synthetic RPC failure-path check. Production routes remain
  disabled per the verified postflight.

### Consultation and adjustment claim guard parity — 2026-10-28

- The scoped Production/Dev catalog comparison found the 33 core refund,
  payout, payout-attempt, provider-operation and TIP trigger bindings already
  match after P3-F2/P3-TIP. It found eight additional enabled Dev triggers
  missing from Production across `consultation_money_operation_claims`,
  `consultation_refund_holds` and `adjustment_money_operation_claims`. Those
  bindings were present in Dev but had no committed migration source.
- Added forward-only migration `20261029043814` with the eight Dev-verified
  identity, exact-payment, refund-hold, post-payout-review and payout-receipt
  guards. Each function uses an empty search path; the exact-payment guard
  qualifies `pg_catalog.lower`. Added a focused SQL contract and an
  intentionally forward-only rollback companion. No payment, payout, order,
  route, or customer row changed.
- Local Production-shaped rehearsal: the earlier saved baseline lacked the
  three Phase 3 claim tables, while all required base tables existed. Applied
  the exact table/identity prerequisites and this migration in one disposable
  transaction; assertions passed for all 8 enabled bindings, empty search
  paths, and zero enabled routes; transaction rolled back.
- Dev verification: applied the exact source migration; the tool-generated
  history marker `20261029044041` was reconciled with the supported
  `supabase migration repair` command to `20261029043814`. The SQL contract
  passed: 8/8 function/trigger/grant/search-path checks and five positive or
  rejected-transition assertions. Postflight confirms all 8 triggers enabled,
  all functions invoker-only with empty search paths and no direct
  `anon`/`authenticated`/`service_role` EXECUTE, exact migration version once,
  and zero enabled routes.
- Production status: the approved trigger catalog read found none of these
  eight bindings in Production. The exact migration was subsequently approved
  and applied. Supabase recorded generated marker `20261029044957`; a
  conditional one-row history reconciliation changed only that marker to the
  approved source version `20261029043814`, without rerunning migration SQL.
  Postflight confirms the source version once, generated marker absent, 8/8
  enabled bindings, 8/8 invoker functions with empty search paths and no direct
  API-role execute, Production `ACTIVE_HEALTHY`, and zero enabled routes. The
  remaining 40-function Edge release is blocked on provider proof and its
  separate release approval.
- Advisor review after Dev apply: no new direct-execute or mutable-search-path
  finding on the eight guard functions. Existing table-level RLS-without-policy
  INFO findings are expected for these service-only claim tables. The existing
  performance report also lists unindexed foreign keys and unused indexes on
  the adjustment claim table from its earlier foundation migration; those are
  separate baseline findings and were not changed by this guard-parity repair.

### Cloudflare branch-build guard — 2026-10-29

- Added a shared branch assertion to the standard web `prebuild` and the
  dedicated `cf:build` entrypoint. Workers Builds can produce the Production
  bundle only when `WORKERS_CI_BRANCH=main`; a missing branch marker fails
  closed when the Workers Build marker is present. Local builds remain
  available. This guards the build step before Cloudflare's separate deploy
  command runs.
- Focused Node tests: 9 passed, 0 failed. `git diff --check` passed.
- This is repository protection only. It does not verify or repair Cloudflare's
  Production branch-control/build/deploy settings, stop a completed deployment,
  or confirm the active Worker version. Cloudflare MCP still requires
  reauthentication, so the approved rollback remains pending. Do not push this
  branch until dashboard settings and the Worker version are confirmed.
- Design deviation: none to payment behavior. The production web release gate
  remains open; all payment routes remain disabled.

### Bachs sandbox withdrawal proof scope — 2026-10-29

- Current Dev credential is write-scoped for connected accounts, payments,
  refunds and transfers, but read-only for payouts. Bachs requires
  `payouts:write` to create a withdrawal through the API, so the current key
  cannot execute D1's withdrawal leg. No scope or provider setting was changed.
- Official Bachs sandbox docs provide a synthetic `bank_transfer` success
  fixture (bank code `999`, account `0001112223`) and failure fixture (bank code
  `998`, account `0001112224`). Sandbox settlement makes successful charges
  available immediately and simulates withdrawals asynchronously; this does
  not prove live settlement timing or real bank clearing. See
  [Connect sandbox testing](https://docs.bachs.io/connect/testing) and
  [Payouts](https://docs.bachs.io/connect/payouts).
- Recommendation: provision a separate sandbox-only key with `payouts:write`
  added, then run a successful test withdrawal from the tagged QA account and
  verify the signed event and account-level timeline. Production credentials
  and routes remain untouched.

### D1 withdrawal-key approval and Bachs review boundary — 2026-10-29

- The user approved a separate Bachs sandbox-only API key with the single
  additional `payouts:write` scope, for the published synthetic success
  destination only. This does not authorize changing the existing key, any
  Production credential, or payment routes.
- No key has been created or stored yet. The TinyFish saved profile has no Bachs
  sign-in, while local browser control timed out. A secure profile handoff is
  open; the user must sign in there and click **Save profile** before the
  authenticated dashboard step can continue. No payout or provider write has
  occurred.
- The current Bachs [payout documentation](https://docs.bachs.io/connect/payouts)
  clarifies that recipient-only accounts are not held for Bachs' one-time first
  payout review. Drapeon's first-release review is the separate Ops gate before
  its first transfer into a tailor's connected balance; it cannot delay the
  tailor's withdrawal from that balance. Account-specific withdrawal control
  and any additional review remain external confirmation items.
- The documented sandbox bank-transfer fixture still supports an asynchronous
  payout event proof. It proves event handling and account-level tracking only,
  not real settlement timing or bank clearing. All routes remain disabled.

### D1 connected-account withdrawal API support — 2026-10-29

- Added account-scoped Bachs payout-destination creation/retrieval and connected-
  account withdrawal creation/retrieval helpers. The payout call checks that the
  destination is currently usable for the requested currency, uses the shared
  minor-unit conversion, requires a fixed idempotency key, and verifies the
  returned amount, currency, destination, and reference. Recovery can retrieve a
  known payout without issuing another write.
- Added a Dev-only payout-proof client that uses the separate sandbox
  `payouts:write` credential and rejects non-payout endpoints. The normal
  checkout/transfer/refund client continues to use the existing sandbox key;
  Production has no payout-proof credential path.
- Focused tests: `deno test --allow-env
  supabase/functions/_shared/bachs_test.ts
  supabase/functions/_shared/bachs-operations_test.ts` — 24 passed, 0 failed;
  `git diff --check` passed.
- The separate sandbox-only payout credential is stored in the Dev project as
  `BACHS_SANDBOX_PAYOUTS_API_KEY`; the checkout/transfer/refund key was not
  replaced. No Production secret changed.
- Bachs Dashboard confirmed Sandbox mode and the QA recipient account is Active,
  but its hosted account details still list `Persons Name` and `Payout Destination`
  as currently due. The matching Drape Dev destination row remains inactive with
  first-withdrawal review `PENDING`. No synthetic bank destination or withdrawal
  was created, and no identity data or legal agreement was submitted. This leaves
  the provider withdrawal leg unproven until the connected account finishes its
  required hosted setup and a usable destination is available. All payment routes
  remain disabled.

### Bachs hosted recipient setup inspection — 2026-10-29

- Opened the generated Bachs Sandbox hosted setup link for the tagged QA
  recipient, but submitted no fields. The current form asks for date of birth,
  phone, address, government ID number and document, and requires consent to
  identity verification and Bachs' Terms and Privacy Policy.
- This conflicts with Bachs' public
  [requirements guide](https://docs.bachs.io/connect/requirements), which says a
  recipient requires only a person's name. Ask Bachs to explain this account's
  hosted-form requirements before claiming withdrawal proof. No fabricated
  identity or ID document was supplied, no consent was given, and no provider
  write occurred. The sandbox withdrawal proof remains open; Production and
  routes are unchanged.

### Bachs integration regression pass — 2026-10-29

- Re-ran the complete shared Bachs helper suite after adding the Dev-only
  payout-credential client and account-scoped withdrawal operations:
  `deno test --allow-env supabase/functions/_shared/bachs*_test.ts` — 118
  passed, 0 failed. One mocked refund-notification test emitted its expected
  missing-notification-environment warnings; no real notification was sent.
- Type-checked the seven affected Edge entrypoints:
  `payout-account-action`, `bachs-webhook`, `release-settlement-tranche`,
  `release-order-tip`, `ops-money-action`, `monitor-settlements`, and
  `payment-action` — all passed.
- No schema, provider account, webhook, route, or Production state changed in
  this verification pass. The hosted recipient requirement and signed
  withdrawal-event proof remain open as recorded above.
- Checked Bachs' detailed [payout destination API](https://docs.bachs.io/api-reference/payouts/create-payout-destination): NGN registration resolves the bank account name, and `account_name` is not required for that corridor. The existing test fixture request shape is correct; no code change was needed. The separate [API onboarding guide](https://docs.bachs.io/connect/guides/api-onboarding) says recipient-only onboarding requires a name and payout destination, while the hosted page displays additional identity fields; their account-specific status still needs Bachs clarification.

### Dev payout-key state and API onboarding route — 2026-10-29

- The user approved saving the separately scoped Bachs sandbox `payouts:write`
  credential to Dev as `BACHS_SANDBOX_PAYOUTS_API_KEY`. A names-only
  `supabase secrets list` check against `pqptfuqogvrajozfsqzi` confirms that
  secret name is already present, alongside `BACHS_SANDBOX_API_KEY` and
  `BACHS_SANDBOX_WEBHOOK_SECRETS`. Secret values were neither retrieved nor
  printed; no Production secret changed. No redundant replacement was made.
- Bachs' official [API onboarding guide](https://docs.bachs.io/connect/guides/api-onboarding)
  confirms a recipient account can be completed by first reading its live
  `requirements.entries[]`, then submitting only the outstanding `persons` and
  `payout_destination` fields through the account update API. It explicitly
  warns that requirements vary and change. The test account's required fields
  must be read before any submission; do not assume the public short-form
  description overrides the account's actual requirements, and do not submit
  real-person identity or agreement claims for a QA fixture.
- A new TinyFish handoff for the existing Default profile was started for the
  Bachs Developer Portal. The profile currently records no signed-in sites, so
  no authenticated dashboard/API key operation was attempted. The user must
  complete the secure sign-in and Save Profile step before that browser route
  can be automated. Local Chrome control timed out; it was not retried.
- Read-only route check: Production `payment_routes` has zero rows; Dev has one
  route row and its status is `DISABLED`. Thus there is no enabled route in either
  project. No route or payment data was changed.
- Sandbox collection/transfer/withdrawal proof is still open until the synthetic
  recipient has an accepted payout destination and a signed withdrawal receipt.

### Current branch contract gate and credential recheck — 2026-10-29

- Rechecked Phase 3 migration history: all 76 Phase 3 source versions are present
  in both Dev and Production, with matching latest version `20261029043814`.
  Production's `payment_routes` had zero rows in the preceding scoped route
  check; the Dev QA route remains DISABLED. No migration, route, or provider
  state changed in this check.
- Re-ran `pnpm launch:contracts` on the current branch using the bundled Node 22
  runtime. The first attempt used system Node 18 and stopped at its unsupported
  `--experimental-strip-types` option; the Node 22 run passed with exit 0,
  including mobile typecheck, web typecheck/lint, Edge Deno checks and the
  repository release contracts. The focused Paystack retirement tests passed
  2/2. `deno.lock` remains unrelated and unstaged.
- Reconfirmed the Dev secret *name* `BACHS_SANDBOX_PAYOUTS_API_KEY` from the
  earlier names-only secret listing; the approved key is already present, so no
  redundant secret write was made. Secret values were not read or printed.
- Remaining release gates: Bachs recipient requirements and signed
  collection-to-withdrawal proof; Production deployment of the Phase 3 Edge
  dependency set under separate approval; Cloudflare reauthentication and
  production Worker version/branch verification before pushing or merging web
  changes. PR #79 remains a draft and its hosted head is older than this local
  branch; no push, Edge deploy, web merge, or visual QA was performed.

### Phase 1 retained-protection reconciliation — 2026-10-29

- A fresh migration-history comparison found **93 Dev versions dated
  2026-10-24/25 and zero Production versions in that range**. The old Phase 1
  source branch has 92 migration files; Dev history includes both the original
  and generated marker for the legacy dispute-resolver ACL repair, so history
  rows are not a one-to-one replay list. Thirty-five rows are assertion-only
  verifiers. The remaining files cover adjustments, payout/refund claims,
  consultations, tips, worker wakeups, withdrawal indexes, and security fixes.
  This is a history gap, not evidence that all 93 files should be replayed.
- The Phase 3 forward repairs already restore the generic claims foundation,
  TIP path, consultation/adjustment guards, refund guards, payout-policy
  exclusivity, and reviewed destination-correction requirements. Do not replay
  overlapping Oct 24/25 history over those current final definitions. Still
  reconcile each retained Phase 1 behavior against Production before declaring
  the phase complete. The legacy `ops_resolve_dispute` privilege repair is now
  covered by the forward-only Production release recorded below. The old
  atomic rate-limit helper has no caller in current source.
- **Active fabric worker follow-up:** the current checked-in Production baseline
  migration installed only the webhook/tip wake path; the retained Phase 1
  fabric wakeup was not in the Phase 2/3 release batches. A read-only Production
  preflight confirmed the gap. Added forward repair
  `20261029062510_phase1_fabric_worker_wakeup_forward.sql` and an emergency
  rollback companion. The repair keeps the webhook/tip trigger, adds a separate
  `PROCESS_FABRIC_RELEASE` insert trigger, includes fabric in the existing
  bounded recovery function, and pins both SECURITY DEFINER worker functions
  to an empty search path. It adds no cron schedule and changes no payout rule.
- **Dev evidence:** the new migration applied to Dev as exact version
  `20261029062510`. Postflight confirms the fabric insert trigger is active,
  both immediate/recovery worker functions include fabric, the existing
  five-minute recovery job is active, the worker function has an empty search
  path, and there are zero pending fabric jobs. The apply/rollback/reapply
  sequence passed in an isolated local Production-shaped database transaction.
  No job was inserted or worker invoked. Production was subsequently updated
  under a separate exact-batch approval; see the Production follow-up below.
- **Remaining Phase 1 gates:** run the approved two-session Dev TIP
  refund/payout race (the previous fixture covered serial orderings only) and
  finish semantic reconciliation of retained Phase 1 protections. Keep
  historical adjustment payouts deferred while their
  new-charge server pause is in force; do not reopen that charge path without
  its complete, reviewed payout implementation.
- Checks for this brick: Dev migration application and targeted metadata
  postflight passed; the forward-in-transaction SQL rehearsal passed and
  local Production-shaped apply/rollback/reapply and `git diff --cached --check`
  passed. Commit `a724a0cf` records the migration,
  rollback, and release-plan/progress updates. The broader full migration
  replay/rollback gate remains separate before D2.

### Phase 1 legacy dispute-RPC privilege repair — 2026-10-29

- Added forward-only migration `20261029063007` to keep the unused legacy
  `public.ops_resolve_dispute(uuid,text,text)` SECURITY DEFINER RPC executable
  only by `service_role`. It has no authenticated Ops-principal check and no
  current application caller, so restoring client/PUBLIC execution is not an
  acceptable rollback. No function body, dispute/order row, or route changes.
- Applied to Dev as exact version `20261029063007`. Postflight confirms
  `anon=false`, `authenticated=false`, `service_role=true`; the function remains
  SECURITY DEFINER. No dispute RPC was invoked and no dispute rows were read or
  changed. The read-only Production preflight confirmed the client roles could
  execute this SECURITY DEFINER RPC, so the repair was promoted under a separate
  exact-batch approval. Its Production grant now denies `anon` and
  `authenticated`, retains `service_role`, and leaves the function
  SECURITY DEFINER.
- Checks: migration assertions passed during Dev apply; targeted grant readback
  and `git diff --cached --check` passed. Commit `14725e50` records the
  forward-only repair and progress/release-plan updates. No provider, Edge, web,
  or route action.

### Phase 1 Production follow-up release — 2026-10-29

- Applied the approved Production batch to Drape-PROD: `20261029062510`
  restores the immediate fabric-release job wakeup and includes fabric jobs in
  the existing bounded recovery worker; `20261029063007` restricts the legacy
  dispute resolver to `service_role`.
- The migration tool initially recorded generated versions `20261029063320`
  and `20261029063328`. Under the same exact-batch approval, only those two
  history markers were corrected to match the reviewed source versions and
  migration names. No migration SQL was rerun for that metadata correction.
- Production postflight: both exact versions present; generated markers absent;
  fabric trigger active; immediate and recovery workers include fabric and tip;
  both worker functions have empty search paths; the existing
  `process-money-jobs-recovery` cron remains active; dispute RPC is still
  SECURITY DEFINER but executable only by `service_role`; `payment_routes` has
  zero rows (therefore zero enabled routes); Supabase project status is
  `ACTIVE_HEALTHY`.
- No job was inserted, worker invoked, dispute RPC called, provider contacted,
  or payment/order row read or changed. Security/performance Advisors were
  inspected after release; the repaired dispute RPC and the two worker
  functions were absent from the corresponding client-execution and mutable
  search-path findings. The project still has wider Advisor findings outside
  this scoped release.
- Checks: exact migration/history and metadata postflight passed; local
  Production-shaped apply/rollback rehearsal passed; `git diff --cached
  --check` passed. No Edge, web, app, or route release.

### Dev TIP claim evidence inventory — 2026-10-29

- Read-only Dev inventory found nine QA-tagged TIP payout claims and seven
  QA-tagged TIP refund claims still in `RESERVED`, in addition to one succeeded
  claim in each direction. The reserved claims are tied to unpublished test
  profiles and test-only customers with no phone numbers; no push tokens or
  customer profiles were present. The reserved payout claims had no saved
  provider operation or payout ID; one lacked its source payment. The reserved
  refund claims had no provider operation ID; one lacked its source payment.
  Existing rows appear to be leftovers from earlier serial QA attempts, so they
  were not released, deleted, or repurposed. Age alone is not evidence to release
  a reservation.
- Provider lookup was read-only against the Stripe sandbox account confirmed
  with `livemode=false`: transfer-group lookups returned no transfer for each
  of the nine reserved payout orders; refund lookups returned no matching
  PaymentIntent in that account for the six distinct references in the reserved
  refund claims. These results are limited to that connected sandbox account;
  they do not prove the two-session race or the state of another provider
  account. No transfer, refund, payout, or provider write occurred.
- The schema/RPC contract serializes refund and payout reservation on the tip
  row, with refund-first permanently blocking payout and payout-first holding a
  refund until the payout reaches a terminal outcome. The existing Dev rows are
  not evidence of two sessions racing at the same time. The required fresh
  two-session race therefore remains **open**. Reusing the old reserved claims
  would not establish a clean simultaneous race, and creating approval rows
  would misrepresent an Ops review; no such rows were created.
- Checks: Dev claim inventory and Stripe test-account GET lookups completed;
  no mutations or notifications. Dev race proof remains blocked on preparing a
  clean, tagged fixture and exercising both concurrent reservation orderings
  without reusing unresolved claims or fabricating a Money Desk approval.

### Local Production-shaped migration replay retry — 2026-10-29

- Retried the outstanding local migration replay/rollback gate. Docker's active
  `colima` context points to a stale socket and reports permission denied;
  `colima status` says the VM is stopped. The `colima-phase1-local` and
  `colima-phase1-rehearsal` sockets are also inaccessible, while Docker Desktop
  and the default Docker socket are not running.
- Starting Colima was attempted once and stopped before VM startup because the
  sandbox cannot write the user's `~/.colima/default/colima.yaml` configuration
  (and cannot read the Rosetta sysctl). No file was modified, no local database
  was created, and no Dev/Production database or Docker context was changed.
- Result: full Production-shaped migration replay and rollback remains **blocked**
  on local Docker access. The previously recorded targeted local SQL rehearsals
  still stand; they are not a substitute for this full gate. Continue independent
  source/release preparation and retry only when a permitted local runtime is
  available.

### Current Phase 3 Edge dependency scope check — 2026-10-29

- Rechecked the local branch's current Bachs runtime modules against the
  documented 40-entrypoint payment release candidate. All 16 Edge entrypoints
  that currently consume `_shared/bachs-operations.ts` / `_shared/bachs.ts` are
  already in that candidate. This includes the sandbox-withdrawal addition
  committed after the hosted PR head. No additional Bachs caller is missing
  from the candidate list.
- This is a local source-closure check only. PR #79's hosted head is still
  `76021d8c`, while local worktree has 22 commits ahead of its remote branch.
  Cloudflare production branch/version access and the approved rollback remain
  unresolved, so the branch is not pushed and no Production Edge approval is
  requested from this stale hosted snapshot. Recompute once more from the
  reviewed final head after Cloudflare release control is restored.
- Check: import graph across all Edge `index.ts` files; 16/16 Bachs module
  consumers are contained in the documented 40-function candidate. No deploy.

### Bachs public-docs reconciliation — 2026-10-29

- Re-read primary Bachs documentation for payment corridors, processing fees,
  platform-owned separate transfers, hosted onboarding and connected payouts.
  The public method matrix lists `NGN_CARD`, but does not identify accepted card
  issuer countries. Its published fee table gives NGN local-card and global-card
  rates, but does not state the exact fee for a UK/US-issued card on an NGN
  checkout or Drapeon's account-specific pricing. That remains a written
  provider question; the public table is not used as a quote.
- The separate-transfer guide resolves the fee-setting ambiguity: create the
  checkout as Drapeon's platform (no `X-Account-Id` or destination), wait for
  settlement, then transfer from platform `available_balance`. The platform
  owns that customer charge and `customer_bears_fee: false` makes the checkout
  account absorb its processing fee. The recipient account's immutable
  `fees_collector` does not choose the fee treatment for this platform-owned
  charge; it is relevant to charges made on the connected account. Bachs reports
  the actual fee/`fee_paid_by` after settlement, so signed settlement evidence
  and the existing reconciliation remain required.
- Public connected-payout docs say payout state is asynchronous and should be
  reconciled with `payout.paid`/`payout.failed` or polling. They say a first-payout
  review applies to accounts the platform creates, but not recipient-only
  accounts registered purely as payees. Drapeon's own pre-transfer review remains
  separate from a Bachs hold. The docs do not establish that the platform can
  schedule or delay a recipient's bank withdrawal; that stays an external
  confirmation item. The hosted-onboarding guide says its hosted flow requests
  only the account's currently due requirements; the QA account's extra fields
  still require account-specific explanation and valid account-holder consent.
- Updated `docs/launch-gates.md` to reflect these distinctions and removed the
  obsolete question about the recipient `fees_collector` controlling a
  platform-owned charge. No code, route, credential, database, provider setting,
  or user email changed. Check: primary Bachs docs reviewed; documentation diff
  checked.

### Final current-head contract check — 2026-10-29

- After restoring the locked workspace dependencies, `CI=1 pnpm
  launch:contracts` passed on the current Phase 3 branch. Release contracts,
  web/mobile static checks, repository-specific contract suites, and all Edge
  entrypoint type checks completed successfully. Existing lint warnings remain;
  no check failed.
- `pnpm install --frozen-lockfile` passed after network access was enabled for
  this turn. No package manifest or pnpm lockfile changed. The pre-existing
  unrelated `deno.lock` modification remains unstaged and was not included.
- No database, provider, Edge, web, mobile, secret, or route state changed.

### Production migration-source reconciliation — 2026-10-29

- Compared every local migration source version matching `20261028*` or
  `20261029*` against the current Drape-PROD migration history. All **78/78**
  versions are present; there are no missing or unexplained versions in this
  Phase 2/3 source range.
- The approved Phase 1 follow-up versions `20261029062510` and
  `20261029063007` are present under their canonical source versions. The two
  generated tool markers `20261029063320` and `20261029063328` are absent, so
  no history correction or migration replay is needed now.
- This is migration metadata only. No Production business rows were read or
  changed; no migration, Edge function, web build, provider operation, or route
  setting was changed by this check.

### Current Phase 3 Edge-scope delta — 2026-10-29

- Compared the isolated branch with the hosted PR branch at `76021d8c`. The
  isolated branch is at `dcd98c65`; the intervening 18 paths include shared
  Bachs runtime additions and their tests, migration/rollback files, web build
  guards, and documentation.
- A local static import-closure scan found 16 affected Edge entrypoints from
  those post-hosted-head source changes. All 16 are already included in the
  documented 40-function payment-scoped Production release candidate, so this
  delta does not add another Edge function to that candidate.
- The PR remains a draft at the older hosted SHA. This does not authorize a
  push or deployment: Cloudflare Production branch/version access and the
  already-approved rollback check remain unresolved. Recompute the complete
  release candidate after the branch is synchronized and before its separate
  Production Edge approval.
- Check: source-to-entrypoint dependency closure and candidate-list comparison;
  no tests rerun because only the release-scope calculation changed. No
  Production, Dev, provider, route, or deployment state changed.

### Focused Dev TIP claim/execution contracts — 2026-10-29

- Ran `deno test --allow-env` for `tip-money-claims_test.ts` and
  `tip-payout-execution_test.ts`: **17 passed, 0 failed**. This covers stable
  claim keys, SEND versus reconcile-only behavior, provider uncertainty,
  mismatched evidence, and late provider success.
- These are local unit/contract tests. They do not substitute for the approved
  simultaneous two-session Dev race. The existing unresolved QA reservations
  were not reused or released, and no Money Desk approval or provider operation
  was fabricated. No Dev or Production state changed.

### Bachs contract-suite recheck and provider-contact check — 2026-10-29

- Ran the 15 focused Bachs shared suites (account onboarding/reconciliation,
  checkout, claimed payouts, collection matching, Connect/dispute events,
  provider operations, settlement fees, destinations, refund claims/events,
  transfer watchdog, webhook signatures and amount/key handling): **118 passed,
  0 failed**. The simulated refund-finalization failure emitted expected test
  logs only; tests made no provider request, database write, or notification.
- Searched the connected Outlook mailbox for Bachs, `bachs.io`, the known
  support sender, and the outstanding corridor/merchant questions; no Bachs
  reply was returned. TinyFish profile inventory still has no recorded signed-in
  site, so no authenticated Bachs automation was attempted.
- The migration approval and history correction are already satisfied: both
  Production and Dev have the exact canonical versions `20261029062510` and
  `20261029063007`; generated markers `20261029063320` and `20261029063328` are
  absent. No SQL or history edit was needed this turn.
- Open remains: Bachs recipient requirements and signed collection-to-withdrawal
  proof; the unrotated connected-account webhook secret; a real two-session TIP
  race; the separate Production Edge release; and Cloudflare access to verify
  the active Worker and approved rollback. All routes remain disabled. The
  unrelated `deno.lock` change remains unstaged and untouched.

### Full launch-contract verification — 2026-10-29

- Ran the repository's required `pnpm launch:contracts` with bundled Node
  v24.19.0. Result: **passed**. This included studio build, release and lifecycle
  contracts, web build-mode tests, Paystack retirement checks, mobile release
  guards, shared package tests (**92 suites, 816 tests passed**), app typecheck,
  all Edge entrypoint `deno check` checks, and web TypeScript validation.
- ESLint completed with **0 errors and 32 warnings**; warnings were existing
  style, image, and React-hook diagnostics. `git diff --check` passed.
- No provider calls, database writes, migrations, deployments, or route changes
  occurred. The only remaining worktree modification is the unrelated,
  unstaged `deno.lock` change.

### Phase 3 release-gate refresh — 2026-10-29

- Rechecked the approved Production migration-history markers. Exact source
  versions `20261029062510` and `20261029063007` are present under their
  canonical names; generated markers `20261029063320` and `20261029063328` are
  absent. The approved correction is already satisfied, so no history write or
  migration replay was performed.
- Read-only route check: Production has zero `payment_routes` rows (zero
  enabled); Dev has one Bachs route and zero enabled routes.
- Rechecked the documented 40-function Phase 3 Edge candidate: Dev has all
  40; Production has 39. `bachs-webhook` is the only candidate not yet created
  in Production. No Edge function was deployed. Existing Production candidates
  retain their current JWT settings, including `ops-money-action=true`.
- Hosted PR #79 remains draft at `76021d8c`; the local branch is at
  `81d230c1` with 30 local commits not pushed. Its hosted description still
  reflects an earlier release state. No PR update, push, merge, or Cloudflare
  action was made. Cloudflare authentication remains unavailable, so the
  previously approved Worker rollback and current active-version verification
  remain unconfirmed.
- Dev provider proof remains incomplete: the available TinyFish profile has no
  signed-in sites, direct CUA access to the user's Chrome timed out, and no
  Bachs sandbox secret is available in the local process. No provider request,
  transfer, withdrawal, or webhook-secret rotation occurred.
- Checks: Production/Dev route counts, Dev/Production Edge inventories, GitHub
  PR metadata, and migration history were read only. No tests rerun because no
  code changed. The unrelated `deno.lock` modification remains unstaged.

### Cloudflare branch-build incident reconciliation — 2026-10-29

- Traced the reported Worker build SHA `6d1471f0` in local history. That commit
  predates `d332ef1e`, which added the Workers Build production-branch guard.
  At `6d1471f0`, `cf-build-mode.mjs` did not yet contain the production-build
  assertion. The incident therefore does not show that the current guard failed;
  it shows that the source revision associated with the incident did not yet
  include it.
- The current branch guard checks Cloudflare's documented `WORKERS_CI`,
  `WORKERS_CI_BUILD_UUID`, and `WORKERS_CI_BRANCH` signals, fails closed for
  missing or non-`main` Workers Build branch metadata, and is called both by
  the standard web build lifecycle and the explicit Cloudflare production build
  script. Cloudflare documents that pushes to the configured production branch
  run build then deploy, while non-production branches use the Preview command.
- Focused checks on the current source: `node --test
  apps/web/scripts/cf-build-mode.test.mjs
  apps/web/scripts/worker-build-env.test.mjs` — **11 passed, 0 failed**.
- Cloudflare authentication is still unavailable, so the current production
  Worker version, its configured production branch/build commands, and the
  previously approved cancel/rollback action remain unverified. The local guard
  is not evidence that it is active in Production. No Cloudflare setting,
  Worker, route, database, provider, or secret was changed.
- References: [Workers Build branch configuration](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/),
  [Workers Build environment variables](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#environment-variables).

### Dev proof feasibility refresh — 2026-10-29

- Read-only Dev TIP inventory confirms the existing Stripe QA tips are all
  `HELD`, `PROCESSING`, or `REFUNDED`; there is no clean `PAYOUT_PENDING` TIP
  fixture to reuse. A separate aggregate of QA `CUSTOMER_REFUND` requests for
  `ORDER_TIP` found 6 `CANCELLED`, 10 `FAILED`, and 1 `SUCCEEDED`, with no active
  pending, approved, or executing QA refund request. Existing reservations were
  left untouched; no Money Desk decision was fabricated and no race was run.
- Rechecked the public Bachs sandbox guide. It documents synthetic `bank_transfer`
  withdrawal outcomes: `bank_code: "999"` and `account_number: "0001112223"`
  complete; `bank_code: "998"` and `account_number: "0001112224"` fail. Sandbox
  withdrawals resolve asynchronously after entering `processing`. This provides
  non-real destination values for the provider proof once the QA account's
  account-specific onboarding requirements are resolved; it does not replace
  the hosted-form identity/consent requirements or prove that a withdrawal event
  is signed and reconciled by Drapeon.
- Outlook has no new Bachs reply since the prior check. The attempt to inspect
  the signed-in Chrome session timed out again; no portal form, credential,
  account, or provider state was changed.
- Checks: scoped aggregate reads against Dev; public Bachs
  [Connect sandbox testing guide](https://docs.bachs.io/connect/testing) reviewed;
  no Dev/Production write, provider operation, notification, route change, or
  secret access.

### Approved migration-marker and release-catalog recheck — 2026-10-29

- The user approved the two migration-history marker corrections. Fresh
  Production and Dev history reads show canonical versions `20261029062510`
  and `20261029063007` present, with generated markers `20261029063320` and
  `20261029063328` absent. The corrections were already reflected in history;
  no SQL/history write or migration replay was performed.
- The approved Production catalog-only check found the
  `process-money-jobs-recovery` cron active at `11,41 * * * *`, calling
  `wake_due_money_jobs`; all five non-internal `job_queue` triggers were
  enabled, including both money-worker wake triggers. The legacy
  `ops_resolve_dispute(uuid,text,text)` function exists as SECURITY DEFINER;
  EXECUTE is granted to `service_role` only (not PUBLIC, `anon`, or
  `authenticated`). Its configured search path remains `public, pg_temp`; no
  function or ACL change was requested or made in this read-only check.
- Re-read Bachs' primary [recipient API onboarding guide](https://docs.bachs.io/connect/guides/api-onboarding),
  [Connect sandbox guide](https://docs.bachs.io/connect/testing),
  [requirements guide](https://docs.bachs.io/connect/requirements), and
  [payout guide](https://docs.bachs.io/connect/payouts). For the Dev QA
  recipient, the next safe proof step is to retrieve its actual
  `requirements.entries[]` through the authenticated account API. Only if the
  API confirms the documented recipient-name and payout-destination fields
  should Dev use a clearly fictional QA name and Bachs' published synthetic
  bank-transfer destination. No hosted identity fields, ID document, or terms
  were submitted or accepted.
- The local Mac is currently locked, Chrome inspection reports that it cannot
  auto-unlock, and the TinyFish Default profile has no signed-in sites. The
  Cloudflare API connection also requires reconnection. No provider, browser,
  secret, Worker, database, route, or deployment state changed.

### Dev credential and provider-proof recheck — 2026-10-29

- Rechecked Dev with the linked Supabase CLI and project tools. Secret metadata
  contains the expected Bachs sandbox collection, payout-proof, and webhook
  secret names; only names/digests were available, and no secret value was
  retrieved or printed. No Production secret was read or changed.
- The Dev payout-destination aggregate has one BACHS NG/NGN destination. It is
  inactive, first-withdrawal review is PENDING, with two onboarding requirements
  due and none pending verification. This is the remaining provider-side blocker
  for collection-to-withdrawal proof.
- Dev Edge metadata shows `bachs-webhook` active and the temporary
  `phase3-dev-bachs-qa-helper` active only as an inert HTTP 410 response. In the
  last 24h, the helper received three 403 responses and one 410 response. No
  Bachs account read, provider write, transfer, withdrawal, or signed webhook
  proof occurred in this check. A temporary token-gated, single-account GET
  helper is awaiting user approval; if approved, it will be retired and its
  temporary token removed immediately after retrieving only requirements and
  capability status.
- Dev Performance Advisor reports two identical unique partial indexes on
  `payout_claims(payout_id) WHERE payout_id IS NOT NULL`; their definitions were
  confirmed equal. This is a redundant write-cost finding to reconcile during
  the next scoped schema review. Security Advisor also reports service-only
  tables with RLS enabled and no client policies; this alone does not establish
  a data exposure, and no ACL or policy changes were made.
- PR metadata confirms #66 and #68 are merged. PR #79 remains a draft at the
  older hosted head `76021d8c`; local Phase 3 work is not synchronized. Both the
  Cloudflare API MCP and the deprecated builds MCP still require
  reauthentication, so the active Worker version and previously approved
  rollback remain unverified. Outlook search found no new Bachs reply since
  2026-10-28. Browser automation timed out after 60 seconds.
- No tests were rerun because no code changed. No Production read/write,
  migration, Edge deploy, provider request, route update, PR update, or web
  deployment was performed. `deno.lock` remains unstaged and untouched.

### Dev route gate recheck — 2026-10-29

- Read-only Dev aggregate confirms the single BACHS NGN→NGN route remains
  `DISABLED`. No route or delivery-country setting changed.
- This is the latest Dev evidence for the no-route-enablement invariant; the
  Production route state was not queried or changed during this recheck.
- No tests were rerun because no code changed. `deno.lock` remains unstaged.

### Reviewed tailor-adjustment payout brick — 2026-10-29

- Added the accepted-route-snapshot-bound payout claim for customer-funded
  TAILOR adjustments, with one immutable `adjustment:{id}` business claim and
  `:op:1` provider key. Release requires the snapshotted policy, payment and
  ledger reconciliation, ready pinned destination, completion evidence plus
  72 hours, no unresolved refund/dispute, and Money Desk approval. An after-
  delivery alteration needs its own customer delivery confirmation. FULFILLMENT
  adjustments remain paused; MATERIAL allocations stay on their existing path.
- Dev migrations applied and verified: `20261029131928`
  (`20261029082845_route_aware_reviewed_adjustment_payout`) and `20261029132040`
  (`20261029132019_tailor_adjustment_delivery_confirmation_index_policy`). The
  first adds the release policy snapshot, customer delivery-confirmation
  receipt, provider-pinned payout claim reservation/finalization, RLS, and
  service-only RPCs. The follow-up adds the `order_id` index and init-plan
  `auth.uid()` policy form after the Dev Advisor flagged the new FK/policy.
  Dev postflight confirms RLS on, customer-party SELECT, no client INSERT,
  service INSERT, active completion guard, and zero enabled routes (one
  configured route remains DISABLED).
- Dev Edge deployments succeeded with configured JWT settings preserved:
  `commercial-adjustment-action` v46 (JWT off), `monitor-settlements` v51
  (JWT off), `release-tailor-adjustment` v14 (JWT off), and `ops-money-action`
  v36 (JWT on). One initial monitor deployment failed bundling because
  `commercial-adjustments.ts` used extensionless imports. Added explicit Deno
  extensions with narrow TypeScript suppressions, reran shared tests and both
  app typechecks, then deployed successfully. This is a runtime-compatibility
  repair; no payment rule changed.
- Focused verification: shared commercial-adjustment tests 6/6; payout identity
  tests 5/5; Deno checks for the four affected functions passed; web and mobile
  typechecks passed; `git diff --check` passed. A full migration replay remains
  deferred to the single Phase 3 replay gate because Docker is unavailable.
- Approved temporary helper used only GET requests to the fixed Dev QA Bachs
  account. Bachs reports `persons.name` and `payout_destination` currently due;
  `payouts`, `transfers`, and `conversions` are active in sandbox. The helper
  returns only requirement field/status metadata and capability status. Its
  temporary token was removed and the helper restored to HTTP 410 with JWT
  verification enabled. No provider write, payout, webhook receipt, notification,
  Production query, or route change occurred. Collection-to-withdrawal proof
  remains open because the QA account still has no completed payout destination.
- Design deviation: none. Open release gates: the two new migrations require a
  separate Production approval; provider E2E still needs Bachs recipient-name
  and synthetic payout-destination setup under the sandbox test policy, signed
  webhook evidence, and a successful account-level withdrawal; final integrated
  release/route gate remains Phase 4. `deno.lock` is unrelated and unstaged.

### Reviewed tailor-adjustment payout Production batch — 2026-10-29

- Applied the approved exact migrations `20261029131928` and `20261029132040`
  to Drape-PROD after the conditional preflight. The two local migration files
  use those values as their filename prefixes; the older timestamps in their
  descriptive names are not migration versions. Preflight confirmed both
  versions absent, all base tables/columns present, the existing payout-claim
  trigger active, the delivery-confirmation table absent as expected, and zero
  payment routes.
- The Supabase migration tool initially recorded execution-time markers
  `20261029134407` and `20261029145017`; under the approved two-marker repair,
  only those two version values were conditionally changed to the approved
  filename-prefix IDs. Final readback confirms each exact source version once
  and neither generated marker. A transient Dev marker correction based on the
  descriptive suffix was immediately restored; Dev's final history uses the
  same two filename-prefix IDs. No migration SQL was replayed for either
  metadata correction.
- Production postflight: the confirmation table has RLS enabled, its
  customer/tailor SELECT policy and validation trigger are present, the
  order-id index exists, and the policy/payout/confirmation functions are
  service-only where intended with empty search paths. The Production project
  reports `ACTIVE_HEALTHY`; `payment_routes` remains empty (zero enabled).
  Security Advisors showed no new finding for these objects; the performance
  Advisor reports the new order-id index as unused while the table is empty,
  plus the existing baseline duplicate-index findings.
- No provider call, payment, payout, user row, order, Edge function, secret,
  route, web build, or mobile build changed. No automated tests were run for
  this DDL-only release; checks were the conditional catalog preflight,
  migration apply, and targeted postflight. `deno.lock` remains unrelated and
  unstaged.

### Fail-closed Ops handling for unsupported tailor-adjustment refunds — 2026-10-29

- Added a shared deterministic issue payload and wired both the web Money Desk
  execution route and `ops-money-action` to open/refresh a deduplicated HIGH
  Money Desk case for `CUSTOMER_REFUND` requests targeting
  `TAILOR_ADJUSTMENT`. The response is explicit that the refund is unsupported,
  no provider refund was sent, and no earning or payout changed. This prevents
  an unsupported manual request from falling through to a generic refund path.
- This is the approved fail-closed case behavior only; it does not implement
  reviewed adjustment refunds. Work-performed vs work-not-performed decisions,
  adjustment refund claims, pre/post-payout funding, and the visible customer
  receipt remain open. Bachs routes must continue to exclude ADJUSTMENT until
  its full collection/refund/release path is proven.
- Tests/checks: shared Money Desk test file **5 passed, 0 failed** using the
  bundled Node 24 runtime; web typecheck passed; `deno check
  supabase/functions/ops-money-action/index.ts` passed; `git diff --check`
  passed. An initial test invocation under system Node 18 failed before running
  tests because Jest requires the repository's Node 22+ engine; rerunning under
  Node 24 passed.
- Dev evidence: no deployment, database, provider, notification, or route
  mutation was performed. Runtime behavior is unit/type checked but not yet
  deployed or exercised against a tagged Dev request.
- Design deviation: none. The case is a temporary fail-closed outcome, not a
  supported refund. `deno.lock` remains unrelated and unstaged.

### Dev deployment verification — adjustment-refund fail-closed case — 2026-10-29

- Deployed the committed `ops-money-action` guard to Dev project
  `pqptfuqogvrajozfsqzi`. Dev reports version 37, `ACTIVE`, with JWT
  verification still enabled; the deployed source contains the
  `TAILOR_ADJUSTMENT` refund branch and shared deduplicated issue builder.
- Focused verification inherited from commit `c3b7aab1`: shared Money Desk
  tests 5/5 passed, web typecheck passed, `deno check` for
  `ops-money-action` passed, and `git diff --check` passed. No live refund,
  payout, notification, Production change, or route enablement was performed.
- Dev evidence proves deployment and source presence only; the authenticated
  request branch was not invoked because no tagged Ops refund fixture was
  available. Full adjustment refunds remain unsupported and continue to open
  the explicit Money Desk case.

### Adjustment delivery-status lint blocker — 2026-10-29

- The current-head `pnpm launch:contracts` run under Node 24 reached web lint
  and failed on `order-resolution-panels.tsx:866`: the delivery-status effect
  synchronously cleared React state when no completed reviewed adjustment was
  eligible. This was introduced with the delivery-confirmation UI.
- Removed the effect-time state write. Delivery status is now rendered only
  while its adjustment is still completed under the reviewed release policy;
  stale cached status cannot appear after the adjustment leaves that state.
- Focused checks after the fix: ESLint on the touched component passed (0
  errors); web typecheck passed; `git diff --check` passed. The full launch
  contract has not yet been rerun after this correction and remains required
  before publishing the branch.
- Dev/Production evidence: no deploy, database/provider mutation, route change,
  refund, or payout. Design deviation: none. `deno.lock` remains unrelated and
  unstaged.

### Tailor-adjustment payout-purpose contract — 2026-10-29

- The first post-fix full launch-contract run found the shared contract test
  still expected the pre-adjustment `PAYOUT_PURPOSES` list. Added
  `TAILOR_ADJUSTMENT` to the expected list and asserted its human label and
  that it remains outside ordinary order-earning purposes.
- Focused test: `commercial-contracts.test.ts` **6 passed, 0 failed**. Full
  `pnpm launch:contracts` then passed: shared **92 suites / 818 tests**, web
  lint **0 errors** (32 warnings), mobile lint **0 errors** (392 warnings),
  Ops checks passed, and the full Edge `deno check` completed. `git diff
  --check` passed.
- Dev/Production evidence: test-only source change; no deploy, database,
  provider, route, refund, or payout mutation. Design deviation: none.
  `deno.lock` remains unrelated and unstaged.

### Re-enabled rotated Bachs connected-account webhook — 2026-10-29

- In the signed-in Bachs Sandbox dashboard, re-enabled only the endpoint
  `Drapeon Dev sandbox connected events` after the rotated signing secret had
  been saved in Dev. The endpoint detail now shows `Enable this endpoint: on`
  and the confirmation toast says `Endpoint enabled`; the separate account
  events endpoint was left unchanged.
- The endpoint currently shows **0 delivery attempts**. This restores the
  event path but does not prove a signed `account.updated` delivery, provider
  signature verification, recipient onboarding, or a payout/withdrawal.
- Read-only route count after the change: Production `payment_routes` has zero
  rows; Dev has one route and its status is `DISABLED`.
- Updated only the sandbox QA account's display label to identify it as a Dev
  proof account (the dashboard confirmed `Account updated`). After refreshing
  the connected-account endpoint, Bachs still showed **0 delivery attempts**.
  Therefore this change did not produce a verifiable signed webhook receipt;
  do not count the endpoint's enabled state as webhook proof.
- No live-mode setting, Production project, application route, real identity,
  money, or legal agreement was touched. Payment routes remain disabled.
- Next sandbox gate: complete only previously approved synthetic QA recipient
  setup fields without accepting legal terms, then capture a signed event and
  verify the stored destination/capability status. If provider-controlled
  identity or legal acceptance remains required, leave that real-person step to
  the account holder and keep Phase 4 blocked on the documented evidence.
- `git diff --check` is the documentation-only check for this entry; unrelated
  `deno.lock` remains unstaged.

### Final independent closeout while Cloudflare access is unavailable — 2026-10-29

- Re-ran the final Production read-only runtime contract audit against the Edge
  release head: all 86 directly called RPC names exist in `public` or
  `payment_internal`. Production reports `ACTIVE_HEALTHY` and has zero
  `payment_routes` rows, therefore zero enabled routes. No Production row,
  function, secret, route, or provider state changed in this audit.
- Reconciled the final payment-scoped Edge release manifest to **41** functions.
  The previously documented 40-function closure gains only
  `release-tailor-adjustment`, added by the reviewed adjustment payout brick.
  The exact list is in `payments-phase3-production-release-plan.md`. The release
  remains a separate Production approval; it has not been deployed here.
- Corrected the Dev-only Bachs API onboarding request to match the current
  official contract (`fields` envelope and `relationship.representative`). The
  request used only a fictional QA name and the published sandbox withdrawal
  success fixture. Bachs returned HTTP 400; a follow-up read still reports
  `persons.name` and `payout_destination` due. The fixture is valid for
  simulating withdrawal completion, but Bachs onboarding requires a resolvable
  bank destination. No real identity, bank data, document, consent, payment,
  transfer, or withdrawal was supplied or created.
- The temporary helper was restored to HTTP 410 with JWT verification enabled.
  Dev's matching payout destination remains inactive, capabilities remain
  recorded as transfer/payout enabled, first-withdrawal review remains PENDING,
  and all routes remain disabled. Signed account/withdrawal proof moves to the
  Phase 4 provider-evidence gate; it does not block the fail-closed Phase 3
  implementation release.
- The independent closeout is otherwise complete. Remaining release actions are
  the separately approved 41-function Production Edge release and the web merge.
  The web merge stays blocked until Cloudflare access is restored and the
  unintended draft-branch Production deployment is inspected/rolled back or
  explicitly accepted. Visual QA remains deferred by user decision.
- Authoritative GitHub recheck: PR #79 is still OPEN and draft at remote head
  `76021d8c`; its static-contract and Cloudflare checks are green for that stale
  head. The local reviewed branch head is `288acd6c`, **47 commits ahead** of the
  PR. Those commits include final guard repairs, Bachs sandbox withdrawal code,
  reviewed adjustment payout/refund handling, and release evidence. They must
  not be pushed until Cloudflare's production-branch/build configuration is
  repaired, because the last feature-branch push deployed to Production. The
  green checks on `76021d8c` therefore do not certify the final local head.

### Production Phase 3 Edge release — 2026-10-29

- Under the user's explicit approval, deployed exactly the documented 41-function
  Phase 3 manifest to Supabase Production `wkfsrunetmgjdtcurmoj`. The normal
  guard linked to Production correctly, but its Docker bundler could not mount
  the isolated `/private/tmp` worktree and stopped before the first change. The
  release then used Supabase CLI's supported server-side bundler (`--use-api`)
  against the same exact project/function list and local configuration. The
  repository was linked back to Dev immediately after postflight.
- Postflight from Supabase's function inventory: **41/41 present, 41/41 ACTIVE,
  0 missing, 0 inactive**, with fresh Production versions/timestamps. This
  includes new functions `bachs-webhook` v1 and `release-tailor-adjustment` v1.
  Configured JWT behavior was preserved: 40 public/self-authenticated or
  webhook functions remain runtime-JWT-off; `ops-money-action` remains
  runtime-JWT-on.
- Runtime/database postflight: Drape-PROD is `ACTIVE_HEALTHY`; public
  `service-health` live check returned HTTP 200 with `{ok:true,status:"ok"}`;
  `payment_routes` has 0 rows (0 ENABLED); `job_queue` has 0 active and 0
  dead-letter rows. No payment, refund, payout, provider call, route, secret,
  web build, mobile build, or user/order row was created by the release.
- A log-window check found one HTTP 503 from Cloudflare's readiness synthetic at
  16:05 UTC against the prior `service-health` v54, before v55 deployed. The
  request carried an invalid API-key authorization and is part of the existing
  Cloudflare access/configuration incident. No 5xx was found for the newly
  deployed service-health version or another released function in the checked
  post-deploy window.
- The Production Edge gate is complete. Remaining Phase 3 release work is the
  final branch push/PR CI/web merge, which remains blocked on restoring
  Cloudflare access and preventing another feature-branch Production deploy.
  All routes remain disabled; provider live proof and route enablement remain
  Phase 4.

### iOS tailor readiness visual pass — 2026-10-29

- Reconnected the installed Dev build (`co.drapeon.app.dev`) to Metro on the
  iPhone 17 Pro simulator using the Dev Supabase project
  `pqptfuqogvrajozfsqzi`. No Production app, route, or user row was changed.
- Authenticated the existing pending-review Dev tailor already stored on the
  simulator. Verified the cockpit, Orders, and Profile surfaces show identity
  review in progress, payout setup required, paid quotes/shop publishing
  paused, fulfillment setup missing, and no raw provider/status enum strings.
- The pass caught one contradictory cockpit label: a tailor who could not take
  paid work was still shown as `Available for orders`. Updated the dashboard so
  readiness-blocked accounts show `Paid orders paused`, use warning tone, and
  retain the configured availability only as supporting context. The readiness
  gate and stored availability are unchanged.
- Focused verification passed: `pnpm --filter @drape/mobile typecheck` and
  `pnpm --filter @drape/mobile lint` (zero command failures). Unrelated
  `deno.lock` remains unstaged.
- Sent the normal Dev recovery email for the verified/live QA tailor
  `dimowoope+drapeon25@outlook.com`. The inbox receipt is confirmed. Completing
  the password change requires the account holder's final browser submission;
  this is not a Phase 3 release blocker. The already-authenticated pending
  account supplied the fail-closed readiness evidence; verified-account payout
  onboarding and withdrawal remain part of the Phase 4 provider proof.
