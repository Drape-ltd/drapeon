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
- Not yet applied to Dev: local Docker/Postgres is unavailable, so the required
  migration replay/rollback rehearsal has not been done. No Edge deployment,
  provider write, signed sandbox receipt, Production schema/function change, or
  route enablement. The Bachs webhook subscription must include
  `event_source=connect` or `all`; that provider-side configuration and signed
  proof are recorded in [launch gates](launch-gates.md). Visual QA remains
  deferred.

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
