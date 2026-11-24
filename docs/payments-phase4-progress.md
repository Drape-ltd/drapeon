# Phase 4 Bachs NGN live-readiness progress

This log records evidence for Phase 4. It is not authority to move money or
enable a route. Production writes, deployments, secrets, route rows,
enablement, and merges remain separately approved release units.

## Stage 2 — live prerequisites (prepared; no live calls)

### Controlled live proof prepared (not authorized)

- The exact one-order proof boundary, preconditions, allowlist contract,
  execution order and evidence requirements are recorded in
  [`docs/payments-phase4-controlled-live-proof-plan.md`](payments-phase4-controlled-live-proof-plan.md).
  It keeps the public NGN/Bachs route `DISABLED`; no proof allowlist exists or
  is active. The plan is preparation for a separate founder approval, not a
  live-money instruction.
- Focused boundary regression passed on the Phase 4 follow-up branch:
  `payment-routes_test.ts` and `bachs-operations_test.ts` passed **31/31**;
  shared `currency-config` passed **38/38**. These checks prove the current
  executable checkout accepts Bachs only on the explicitly flagged Dev sandbox
  host, never selects a legacy Paystack route, rejects bank-transfer checkout
  methods, and fails closed for disabled/sandbox-only Production routes. They
  are guard evidence, not authorization for a live payment.

### Production credential and webhook contract

- Required Production secret names are `BACHS_LIVE_API_KEY`,
  `BACHS_LIVE_WEBHOOK_SECRETS`, and `BACHS_PLATFORM_ACCOUNT_ID`.
  `BACHS_LIVE_WEBHOOK_SECRETS` accepts a comma-separated overlap so the
  platform-event and connected-account-event endpoint secrets can coexist and
  rotate without losing signed events. Values must be entered by the owner and
  are never returned, logged or committed.
- Register both live Bachs event subscriptions at
  `https://wkfsrunetmgjdtcurmoj.supabase.co/functions/v1/bachs-webhook`.
  Subscribe to payment/collection, account/capability, transfer, refund,
  dispute and payout events. Presence and a signed test delivery must be
  verified before any live proof.
- `BACHS_CARD_ISSUER_GATE_ENABLED` remains unset/false. Quote acceptance does
  not guess issuer country. No foreign-card corridor is enabled by this work.
- Bachs later confirmed the live platform account country is NG; sandbox was
  already NG. Ticket `#154675279` is resolved for the country move. Drapeon
  still sends explicit `country=NG` for Nigerian bank discovery/resolution and
  never relies on the account default.

### Provider questions still requiring written, account-specific answers

Subject: `Drapeon live NGN card route — final technical confirmations`

> Hi Bachs technical team,
>
> We completed Drapeon's NGN sandbox collection, settlement, separate transfer,
> connected-account withdrawal, refund and signed-webhook tests. Before the
> smallest controlled live proof, please confirm in writing for our live
> account:
>
> 1. Can UK- and US-issued cards pay an NGN card checkout, and are there any
> issuer-country restrictions we must enforce?
> 2. What exact fees and fee currency apply to Nigerian-issued, UK-issued and
> US-issued cards on an NGN checkout created with
> `customer_bears_fee: false`? Our sandbox Nigerian-card proof settled NGN
> 500.00 gross, NGN 490.00 net, fee NGN 10.00.
> 3. Can the platform delay or schedule withdrawals from recipient-only
> connected accounts, and is any additional first-live-withdrawal review
> applied to our account?
> 4. Are card refunds always funded from the platform available balance, and
> what live behavior should we expect when that balance is insufficient?
> 5. Sandbox charge `ch_80b98ca7dc5145fdb9adc2cbad7d246f` succeeded and its
> signed collection event reported NGN 2.04 processing fee, but repeated
> payment retrievals omit final `fees` / `fee_paid_by`. Is that expected in
> sandbox, and which endpoint or field is authoritative for final settled net?
> 6. Is there a supported sandbox trigger for `dispute.created` and
> `dispute.updated`? The public sandbox fixtures and Disputes API document no
> operation that creates a test dispute.
>
> Our launch route is Nigerian-issued cards only, NGN charge, Nigerian tailor,
> Nigerian customer. Bank-transfer checkout and other countries/currencies are
> out of scope. Please also confirm when Compliance has changed the live
> platform account country to Nigeria.
>
> Best,
> Ope
> Drapeon

### Fee-disclosure finding

- The real sandbox charge proved a 2% provider fee: NGN 500.00 gross, NGN
  490.00 settlement, NGN 10.00 processing fee. This is strong sandbox evidence,
  not an account-specific live price guarantee.
- The Stage 1 sandbox checkout sent `customer_bears_fee: false`, so its original
  NGN 500.00 fixture had no separate customer-facing provider-cost component
  and Drapeon absorbed the NGN 10.00 fee. That proved the provider outcome but
  did not satisfy the launch disclosure policy.
- The locked launch policy is zero commission: the customer sees a separately
  disclosed `Payment processing (2%)` line based on the pre-fee accepted order
  total, while Drapeon absorbs any difference between that stable disclosure
  and Bachs' settlement fee. The actual Bachs fee is still recognized only from
  signed/retrieved settlement evidence as `PROVIDER_FEE_EXPENSE`; it is never
  inferred from the displayed rate.
- The prepared forward migration
  `20261112201000_phase4_lock_bachs_provider_cost.sql` adds service-only v2
  acceptance wrappers. In the same transaction as the immutable route
  snapshot, they require the exact Bachs NGN-card fee schedule, reject any
  pre-existing Drapeon commission, round the 2% amount in minor units, lock the
  accepted customer total and store the schedule/amount in the order's tax and
  duty snapshot. Ready-made checkout uses the same wrapper. Stripe remains a
  zero-provider-cost pass-through.
- For compatibility with the existing balanced pricing, receipt and refund
  contracts, the recovered cash component occupies the existing
  `platform_fee_amount` slot internally. That legacy database name is not the
  customer meaning: Bachs receipts, emails, order history and web/mobile
  checkout render it only as `Payment processing`; non-Bachs routes retain the
  existing service-fee label. The capture ledger records the gross recovery in
  Drapeon's revenue account and the reconciled provider charge as a separate
  expense, so the net difference is measurable and borne by Drapeon.
- The shared preview helper rejects unknown schedules and unsafe minor-unit
  values. Both web and mobile request the canonical route preview before quote
  acceptance or ready-made checkout and fail closed for NGN when the route or
  schedule is unavailable. Promotions remain Drapeon-funded: the provider-cost
  line is added after the promotion to the amount the customer pays, without
  mutating the accepted tailor earning.
- Local disposable-Postgres proof passed for custom NGN 500.00 → NGN 10.00
  processing → NGN 510.00 total and ready-made NGN 99.99 → NGN 2.00 processing
  → NGN 101.99 total. Rollback removed only the two v2 wrappers and reapply
  passed. Focused shared tests passed 11/11; route-acceptance tests passed 2/2;
  strict Deno checks and web/mobile typechecks passed.
- Dev-only release evidence: exact migration `20261112201000` is present in
  Dev history (the MCP-generated marker was removed), both v2 wrappers exist,
  only `service_role` can execute them, and no finding for either wrapper was
  introduced in the security or performance Advisors. Dev health is clean.
  `customer-order-action`, `payment-action`, `payment-route-availability`, and
  `ready-made-order-action` were then deployed to Dev with server-side bundling.
  The guarded deploy script now always uses `--use-api`, avoiding the local
  Docker bind-mount failure that originally prevented the worktree path from
  being bundled.
- The immutable Dev sandbox route was versioned instead of edited: v1 retains
  its historical `customer-disclosed-provider-costs-v1` configuration, while
  audited v2 `b4c80000-0000-4000-8000-000000000002` is `SANDBOX_ONLY` with
  `ngn-card-provider-cost-2pct-v1`. Neither version is `ENABLED`; both have no
  active enablement request. The prior sandbox orders remain pinned to v1.
- Authenticated Dev route proof now passes with the approved QA account
  `dimowoope+drapeon25@outlook.com`. Its password was rotated in Dev only and
  stored in the local macOS Keychain under service `drapeon-dev-e2e`; no secret
  was written to this repository or log. The signed-in customer check against
  the isolated Bachs tailor returned `available=true`, provider `BACHS`, schedule
  `ngn-card-provider-cost-2pct-v1`, and NGN 200 processing on an NGN 10,000
  pre-fee total. This proves the deployed authenticated route/fee preview, not a
  live charge.
- After the final web purity correction, the complete `pnpm launch:contracts`
  gate passed (exit 0). The focused shared tests remain 11/11, route-acceptance
  tests 2/2, deployment-guard tests 3/3, and web/mobile/Edge typechecks pass.
- The fresh accepted-order v2 checkout, receipt, claim-backed full refund and
  allocation proof are recorded below. The remaining provider-evidence gap is
  final fee-payer/settled-net reconciliation: Bachs' sandbox payment read omits
  the documented final fields even though the signed collection event carries
  the actual fee. Production/live Bachs and every Bachs route remain untouched
  or non-enabled.

### Disabled Production route seed

- The initial rehearsal caught an actor mismatch before shared release: route
  creation is guarded by a named Auth/Ops actor, while Production has no row for
  the placeholder Ops UUID used in the first seed. Null actor fields alone also
  fail the guard. No shared Dev or Production change was made.
- The actual seed is
  `20261113040509_phase4_seed_disabled_bachs_ngn_route_system_audit.sql`, after
  the three route-cost migrations. It permits only the fixed route ID and exact
  immutable NGN/Bachs/Drape Marketplace Limited configuration, with status
  `DISABLED`, exact reason, and a transaction-local system-seed marker. It does
  not create a human or Ops principal, and it cannot authorize a later status
  change. The route audit event has null person fields; the paired
  `audit_logs` row records `phase4-production-migration` as the system actor.
- The migration rollback restores the original Phase 2 route guard and removes
  only the exact null-person system receipt created by this migration. A
  pre-existing Dev `SANDBOX_ONLY` route has no system marker and is left alone.
  Rollback refuses a route with snapshots or approval evidence.
- Dev applied source version `20261113040509`; postflight confirms its two
  existing NGN Bachs versions remain `SANDBOX_ONLY` with the same route IDs and
  fee schedules, the reserved Production ID is absent, and zero routes are
  enabled. The migration history matches the source version.
- Disposable local PostgreSQL rehearsal passed: new seed creates exactly one
  disabled route, one null-person route audit receipt and one system audit log;
  reapply is idempotent; a wrong-entity insert is rejected; the system marker
  cannot enable the route; reverse-order rollback removes the unused route and
  audit receipts and restores the original guard. Focused contract checks pass
  7/7. The rehearsal database is disposable; Production remains untouched.
- Creating this row cannot accept an order: it has no enabled status, no active
  enablement request and no Production payout destination. Production release
  still requires exact approval after local/Dev rehearsal and read-only
  Production preflight.

## Stage 0 — post-merge checks (2026-10-29)

- **Branch:** `codex/phase4-bachs-live`, created from `origin/main` at merge
  `c654fea0068998e00b28581a0559ba2d3d4600a0`. The prior Phase 3 worktree and
  its unrelated `deno.lock` edit were left untouched.
- **Edge parity:** the approved 41-function Production deployment ran from the
  reviewed branch head `288acd6cf0fa5106ed0ceb80a97e0b01a4c24571` between
  its 11:04 CDT commit and the 11:09 CDT evidence commit. The exact 41-function
  manifest is in `payments-phase3-production-release-plan.md`. A path-scoped
  `git diff --name-only 288acd6c c654fea0` across those 41 directories and
  `supabase/functions/_shared` returned no files. The merged source is therefore
  byte-identical for the deployed Edge scope.
- **Review range:** `git rev-list --count --first-parent
  750e23e5..fcc14a1e` returned 54. The post-merge review is in
  `payments-phase3-postmerge-review.md`.
- **Migration naming:** the two double-timestamp source files use applied
  versions `20261029131928` and `20261029132040` in both Dev and Production.
  Production names retain the double timestamp. Dev records only the suffix for
  both, so the history *names* are not identical even though the authoritative
  versions are. The first rollback also omits the embedded original timestamp;
  the second retains it. No history marker or filename was changed. The exact
  mapping and safe convention are documented in the post-merge review.
- **Route state:** no route was created or enabled during Stage 0.
- **Production writes:** none.

### Stage 0 commands/evidence

- `git diff --name-only 288acd6c c654fea0 -- <41 function dirs>
  supabase/functions/_shared` → empty.
- Supabase read-only migration inventories: Dev `pqptfuqogvrajozfsqzi` and
  Production `wkfsrunetmgjdtcurmoj`.
- `git diff --check` and documentation checks are run before the Stage 0 commit.

### Open operator gates

- Cloudflare dashboard branch/deployment controls must be checked by the account
  owner using this exact checklist:
  1. Workers & Pages → `drape` → Settings → Builds: Production branch is exactly
     `main`.
  2. Non-production branch builds are Preview builds only; they have no command,
     environment, or branch rule capable of deploying the Production Worker.
  3. Deployments → Production: the active version was built from merged `main`
     commit `c654fea0068998e00b28581a0559ba2d3d4600a0` (not PR-head
     `76021d8c`, `6d1471f0`, or another feature-branch SHA).
  4. The build command uses the repository's guarded build path and receives
     `WORKERS_CI_BRANCH=main`; no dashboard override bypasses it.
  5. Save screenshots of the Production-branch setting and active deployment
     SHA/version in the Phase 4 evidence pack. If any item differs, do not build
     or deploy; report the current value first.
- A second named Production Ops principal must be provisioned with independent
  MFA before any route-enable request. No account was created in Stage 0.

## Stage 1 — sandbox proof

### 2026-11-12 — Bachs support unblocked the country scope

- Bachs support ticket `#154675279` confirmed that requests without an explicit
  country fall back to the platform account country, which is `US` in sandbox
  and remains `US` in live mode until Bachs Compliance changes it.
- Drapeon must send `country: "NG"` in every
  `POST /v1/misc/bank-accounts/resolve` body and `?country=NG` in every bank-list
  request. The shared provider client now fails closed if either scope is
  omitted, and the permanent wrappers always add it.
- The current supported sandbox fixture is account ending `0000`, bank code
  `033`, expected name `Test Bank Account - Success`. The older account ending
  `6789` is retired and must not be used in fixtures or runbooks.
- **Dev proof:** the explicit-NG retry returned `resolved=true`,
  `lookup_supported=true`, bank-list country `NG`, bank code `033` present, and
  the expected account name matched. `bank_id` and `bank_account_id` were not
  returned by this resolver response and are recorded as `null`; no substitute
  identifiers were inferred.
- The temporary Dev-only probe was deleted and its token unset immediately after
  the proof. No Production or live-mode request was made.
- **Open external item:** Bachs Compliance still needs to change the live account
  country. This does not block Dev/sandbox proof; it remains a live-readiness
  gate before any Production route enablement.

### 2026-11-12 — Dev payout-setup continuation

- The existing audited NGN/Bachs Dev route was moved from `DISABLED` to
  `SANDBOX_ONLY` with the Phase 2 Ops RPC and a named Dev QA principal. It was
  not enabled, and no Production route changed.
- Reused the existing bound synthetic recipient account and destination rather
  than creating another provider account. Provider retrieval confirmed country
  `NG`, transfers `active`, payouts `active`, two onboarding requirements due,
  zero pending-verification requirements, and no external payout account yet.
- The destination sync persisted the same destination ID and provider account
  ID. It remains inactive with first-withdrawal review `PENDING`, as required
  until hosted onboarding and an external payout destination are complete.
- A fresh Bachs sandbox hosted-onboarding link opened successfully and reached
  Bachs' identity/KYC form. Drapeon did not collect identity documents and did
  not invent a person or upload a real document to sandbox. No approved Bachs
  sandbox identity/document fixture is published in the official docs, so the
  hosted KYC completion remains a provider-test-data item rather than an app
  integration failure.
- The temporary token-gated Dev helper and its secret were deleted immediately
  after the handoff proof. No Production or live-mode request was made.
- Focused provider tests passed `26/26`; strict Deno checks passed for the shared
  Bachs client, operations adapter, and `payout-account-action`; `git diff
  --check` passed. Only `payout-account-action` was redeployed to Supabase Dev so
  the verified country guard and current onboarding adapter are active there.

### 2026-11-12 — synthetic destination fallback

- Because the connected recipient is API-owned and not a normal Bachs portal
  login, the sandbox proof used Bachs' supplied synthetic Nigerian bank fixture
  directly through the account-scoped payout-destination API. This does not
  replace hosted KYC for real tailors and is forbidden in live mode.
- Bachs created destination `pd_xvxVN5HyuyMzeNzY` under connected account
  `acct_LPvacykCDo2YmEFW`. Provider evidence: type `bank_account`, currency
  `NGN`, status `approved`, `is_usable=true`.
- The platform and connected account both reported NGN available and pending
  balances of `0.00`; therefore no transfer or withdrawal was attempted. The
  next sandbox proof step is a synthetic collection that funds the platform,
  followed by the existing claim-backed transfer and an account-level
  withdrawal to this approved destination.
- The temporary destination probe and token were removed after the evidence was
  captured. Production and live mode were untouched.

### 2026-11-12 — API onboarding and destination activation

- The account-scoped provider read returned exactly one payout destination in
  Bachs' `destinations` envelope: `pd_xvxVN5HyuyMzeNzY`, type `bank_account`,
  currency `NGN`, approved and usable. This is authoritative sandbox API
  evidence even though the destination is not rendered in the Bachs portal.
- A temporary token-gated Dev helper submitted only the fictional sandbox name
  `Drapeon Sandbox` through Bachs' documented API-onboarding `fields.persons`
  shape. It submitted no real identity, address, phone, document or agreement.
  The provider moved the connected account from one currently-due requirement
  (`persons.name`) to zero due and zero pending-verification requirements.
- Bachs delivered signed `account.updated` event
  `evt_5f7b5c1df8ec3f600f6ba6d57c3ade41`; Dev processed it successfully. The
  resulting Drape payout destination stores provider account
  `acct_LPvacykCDo2YmEFW`, provider destination `pd_xvxVN5HyuyMzeNzY`, external
  account present, both capabilities active, and zero onboarding requirements.
- Dev Ops first-release review then cleared destination
  `3300fa5b-e261-4e1b-b59e-aa07f40f3e20`; the destination became active. The
  review evidence is tied to the exact provider account and destination IDs.
- The temporary helper and token were deleted immediately after the proof. No
  Production or live-mode request was made. The route remains `SANDBOX_ONLY`.
- The next proof step is a proper Drape order and Bachs sandbox card collection,
  followed by the claim-backed 80/20 transfer and account-level withdrawal.

### 2026-11-12 — complete sandbox collection → transfer → withdrawal proof

- Created one fresh, tagged Dev-only local-handoff order
  `f4050000-0000-4000-8000-000000000001` on the audited `SANDBOX_ONLY`
  NG/NGN Bachs route. Its accepted snapshot pinned the legal entity, provider,
  route version and payout destination before payment. Production remained
  untouched and no route was enabled.
- Drape reserved checkout attempt `41d1ca27-64d2-4630-b4c8-fb83f2aae8a6`
  with the fixed business idempotency key and created Bachs checkout
  `chk_8ywYTFwX4qKOs2zW` for NGN 500.00. The hosted sandbox card payment
  completed. Bachs' original endpoint delivery failed `401` because Dev had
  only one of the two account webhook secrets. Dev now accepts both rotated
  endpoint secrets. Bachs denied its resend API to the available scoped key, so
  the immutable event was retrieved from `GET /v1/webhooks/events/{id}`, signed
  with the current endpoint secret and posted to the canonical webhook. This
  replayed provider evidence; it did not invent an event or mutate the payment
  directly.
- Signed collection event `evt_8e965ebc92ad29e7578ee65a4ac1e3de`
  reconciled to provider charge `ch_e22f2075f56640f59b153b696363c23f`.
  Dev recorded the payment as `SUCCEEDED`, the order as `CONFIRMED`, the capture
  ledger entry once, and settlement evidence with gross/settlement NGN 500.00
  and provider processing fee NGN 10.00.
- The local handoff produced the snapshotted 80/20 plan. The first tranche
  `86262260-3127-436d-af39-6173540a7a36` reserved exactly one payout claim
  `58aa8995-262c-4df4-bae2-331ce288c822`, one provider operation and one
  attempt. Bachs transfer `tr_8fb04df301c24c1d8af21d44` moved NGN 400.00 to
  the connected account. The claim and operation are `TRANSFERRED`, the attempt
  is `SUCCEEDED`, the tranche is `RELEASED`, and the commercial release ledger
  contains one matching provider reference. The retry reused
  `tranche:86262260-3127-436d-af39-6173540a7a36:op:1`; no second transfer was
  created.
- Two provider-neutral readiness defects surfaced and were fixed in Dev. The
  Edge releaser and DB reservation function had continued to require the
  pre-route `tailor_profiles.payout_account_verified` flag even for an accepted
  order with a fresh, active, immutable Bachs destination. Snapshot orders now
  trust that exact destination and its live capabilities; legacy orders retain
  the legacy profile check. Fresh provider GET evidence is still required
  within the existing 15-minute window.
- The account-level withdrawal used Bachs payout
  `pay_MaUUEWgIvqw6jq1t`. The connected account was debited NGN 150.00: NGN
  100.00 reached the synthetic sandbox bank destination and Bachs charged NGN
  50.00. Signed `payout.created` event
  `evt_9c92d01a0aafd5ef7b765c31db54b84b` and signed `payout.paid` event
  `evt_c5c6aad082d58773bc6f65f07b885683` are both processed and stored at
  account level, not attached to an individual earning. The real provider sent
  `status: processing` on `payout.created`; the parser now accepts that documented
  nonterminal state as `PENDING` while retaining strict paid/failed terminal
  checks.
- The Bachs portal did not render the API-owned destination/account consistently.
  That is not a proof gap: Bachs' account, destination, event, transfer and payout
  APIs supplied immutable IDs and signed outcomes. The portal is treated as an
  operator viewer, never as the integration source of truth.
- The temporary tranche/withdrawal helper was deleted from Dev and its token
  unset immediately after proof. No live-mode request, Production call, real
  bank account or real money was used.

### 2026-10-29 — original blocked attempt

- Deployed a temporary token-gated, Dev-only probe to Supabase Dev
  `pqptfuqogvrajozfsqzi`. It used the existing server-side Bachs sandbox key and
  called only the three required `POST /v1/misc/bank-accounts/resolve` fixtures.
  No key or full account number was returned or logged.
- Results:
  - bank code `058`, fixture ending `6789`: `resolved=false`, no account name,
    message `Account resolution is not supported for country US`;
  - bank code `101`, fixture ending `6789`: the same result;
  - bank code `999`, fixture ending `2223`: the same result.
- **Gate result:** zero of three fixtures resolved. Stage 1.1 explicitly says to
  stop when none resolves, so no QA recipient submission, route row, checkout,
  transfer, withdrawal, refund, or failure-path test was attempted.
- **Root cause evidence:** the Bachs sandbox organization/API-key context still
  defaults reference resolution to `US`, matching the account-country issue
  reported during business registration. The NG onboarding corridor cannot be
  proved from this sandbox context until Bachs changes the sandbox platform
  country to Nigeria or provides an authorized NG sandbox fixture/account scope.
- The temporary function was replaced with an HTTP 410 responder and its probe
  token was removed from Dev after the evidence was captured. Production was
  untouched and every route remains disabled.

### Superseded external resolution

Bachs supplied the explicit country rule and replacement sandbox fixture in
ticket `#154675279`. Stage 1.1 resumes with those documented inputs; no real
personal bank account is required.

### 2026-11-12 — sandbox failure, replay, refund and concurrency proof

- **Customer card failures:** sandbox checkout
  `chk_T2sqqRqYkKTjrkSE` rejected Bachs' documented declined-card fixture with
  “Declined by your bank” and the insufficient-funds fixture with “Not enough
  money”. Both states said the customer was not charged and retained the same
  retryable checkout. The same checkout then completed with the success card as
  charge `ch_34ec9ee267ad48a8a1177445bf7655ee`; no replacement checkout was
  created. Signed decline event `evt_658ef22b009ab12563cda585e1676dd1`
  was processed as `failed_collection_needs_review` with provider code
  `bank_declined`. The provider-only QA checkout had no Drape order/payment
  attempt, so it advanced no order state.
- **Failed account withdrawal:** the first attempt correctly failed before a
  provider payout with `PLATFORM_FEE_UNFUNDED`. This exposed that Bachs debits
  its NGN 50 withdrawal fee on top of the requested amount. After a separate
  sandbox-only NGN 200 funding charge, withdrawal
  `pay_0HV8AEpictsxiCLv` to synthetic failure destination
  `pd_oUIXihFIWZx56Jt1` progressed through signed `payout.created`
  (`evt_4f5373429d5ab8f93f66751adb04f3f7`) and signed `payout.failed`
  (`evt_059fa059a2f126186da609df241da9fd`). Dev stored PENDING then FAILED
  account-level movement events and opened one HIGH `PAYOUT_FAILED` Ops case.
  The source earning claim stayed TRANSFERRED, its attempt stayed SUCCEEDED,
  and provider transfer `tr_8fb04df301c24c1d8af21d44` was not recreated or
  downgraded.
- **Refund outcomes:** partial-success refund
  `rfnd_xZXAeFKqeNJymvR3` returned NGN 50.00; full-success refund
  `rfnd_DcgSsxIQTXyBLmSc` returned NGN 100.00 on a separate charge. Bachs
  permits only one refund per charge, so these deliberately use distinct
  charges. Simulated-failure refund `rfnd_Vfw1wCyxdBe0TOob` reached terminal
  `failed` with no refunded amount. Its signed `refund.failed` event
  `evt_a2514ac3bd30e24bbac93844fb334a1e` was processed and opened Money Desk
  case `OPS-C732B73D`. These provider-only QA charges intentionally have no
  Drape refund claim; the webhook therefore failed closed with
  `refund_identity_needs_ops_review` instead of mutating an order. Canonical
  claim matching, exact amounts and reviewed retry behavior remain covered by
  the focused automated suites.
- **Webhook replay and rejection:** the immutable collection event was fetched
  again from Bachs and signed with the Dev endpoint secret. The canonical
  webhook returned `duplicate=true` / `alreadyProcessed=true`; database
  `receive_count` is 2 while the original processing result remains
  `confirmed`. The same untouched payload signed with a timestamp 301 seconds
  old returned HTTP 401. A current timestamp with an invalid signature also
  returned HTTP 401.
- **Two-session TIP gate:** two concurrent, independent PostgREST RPC sessions
  raced the same tagged Dev-only QA tip. The two reservation outcomes were one
  `RESERVED` and one `EXISTING`. Exactly one immutable claim
  `372ff679-3db2-4726-b7b0-e3b29dd2d8fe` and one payout row
  `f4050000-0000-4000-8000-000000000023` existed. Two concurrent provider-call
  starts returned exactly one `SEND` and one `RECONCILE`. The probe deliberately
  stopped before a provider call, so no transfer or notification was sent.
  The tagged fixture remains isolated in Dev because its guarded cleanup could
  not truthfully claim terminal provider failure; it is `PROVIDER_UNKNOWN` and
  cannot authorize another send. No delivery job was queued for it.
- **Lost-response recovery:** focused claimed-payout and TIP execution tests
  prove that an unknown provider outcome re-enters through lookup using the
  saved operation identity and never calls create again. The real tranche
  retry also reused `tr_8fb04df301c24c1d8af21d44`, providing provider-side
  evidence that no second transfer was created.
- **Adjustment boundary:** the reviewed adjustment identity supports immutable
  Bachs claims, rejects policy/amount/key drift, and the shared payout executor
  releases once while concurrent re-entry is reconcile-only. Focused tests
  passed. Dev also retains fail-closed examples for an unsupported refund and a
  blocked payout claim. A new Bachs ADJUSTMENT collection is deliberately not
  available (`isBachsPaymentPhaseAvailable` permits only INITIAL_ORDER and
  FULFILLMENT), so no Bachs adjustment transfer was fabricated. ADJUSTMENT must
  remain excluded from the route evidence matrix and checkout until its own
  collection/refund/release proof is completed.
- **Focused tests:** the 12 Bachs/claim suites passed **134/134**. The focused
  TIP/adjustment follow-up passed **34/34** after rerunning the one source-read
  contract with its required read permission. Coverage includes retryable card
  failure behavior, signature age/signature rejection, refund success/failure
  matching, account withdrawal chronology, unknown-transfer lookup recovery,
  one-writer TIP start gating, adjustment immutable identity and concurrent
  payout loser behavior.
- **Cleanup:** temporary Dev Edge function
  `phase4-bachs-failure-probe` was deleted and
  `PHASE4_BACHS_FAILURE_PROBE_TOKEN` was unset. The function-name and
  secret-name readbacks were empty. No Production or live-mode request was
  made. Dev route `ng-ngn-ngn-bachs` remains `SANDBOX_ONLY`; no route is
  enabled.

### 2026-11-12 — customer-funded provider-cost checkout proof

- Created tagged Dev-only order `f4060000-0000-4000-8000-000000000001`
  and immutable tailor quote `f4060000-0000-4000-8000-000000000002` on
  route version `b4c80000-0000-4000-8000-000000000002`, using fee schedule
  `ngn-card-provider-cost-2pct-v1`. The tailor quote and accepted earning
  remained NGN 100.00.
- The first v2 acceptance attempt exposed two useful database guards. A
  post-acceptance amount update was rejected because the accepted route
  snapshot is immutable, and an attempted quote rewrite was rejected because
  the tailor's quote payload is immutable. Forward migrations
  `20261112203000` and `20261112204000` now lock the customer amount on the
  order before the canonical snapshot and never rewrite the quote. Both exact
  versions are applied in Dev; Production is untouched.
- The accepted customer order locked NGN 100.00 subtotal + NGN 2.00 disclosed
  payment processing = NGN 102.00 total while preserving NGN 100.00 protected
  tailor earning. Bachs checkout `chk_pkmTlNJivVB24Kr6` completed in the hosted
  sandbox as charge `ch_80b98ca7dc5145fdb9adc2cbad7d246f`. Signed event
  `evt_c9b5420428cebade5c6b9e89e156bb3` advanced payment attempt
  `d0f0321d-3540-40c9-8e40-dd97533409cf` once to `SUCCEEDED` and the order to
  `CONFIRMED`.
- Commercial receipt `DRP-2026-00000033` records NGN 100.00 subtotal, NGN
  2.00 processing cost, NGN 102.00 paid total, and NGN 100.00 protected tailor
  amount. The signed provider event reports an actual Bachs fee of NGN 2.04.
  The settlement monitor correctly left reconciliation `PENDING` because the
  provider payment GET had not yet returned final fee-payer evidence; it did
  not guess or post the fee ledger early. When final, the 4-kobo difference is
  Drapeon's cost under the locked policy.
- Bachs' current sandbox documentation says a succeeded sandbox charge
  finalizes automatically and reaches `available_balance` immediately, while
  its processing-fee documentation says the payment read should expose the
  actual `fees` and `fee_paid_by`. Consequently, a repeated sandbox payment
  read that remains succeeded but omits those fields is treated as provider
  evidence inconsistency, not as permission to infer a payer or manufacture a
  fee journal. The route remains non-enabled while that evidence is absent.
- Added a migration contract that fails if quote acceptance mutates
  `order_quotes` or snapshots before the customer-cost lock. The focused test
  passes 2/2. The fresh refund-allocation proof waits for final settlement
  evidence so the provider balance and fee ledger cannot be confused.
- Post-apply Dev catalog verification confirms the final quote-acceptance v2
  wrapper is `SECURITY DEFINER`, executable by `service_role` only, blocks
  `anon` and `authenticated`, keeps the quote immutable, and locks customer
  cost before calling the canonical route snapshot. Its effective
  `search_path` is the deliberately empty value (`search_path=""`).
- The complete launch contract was rerun under Node 22 after this change and
  passed. The first sandboxed run reached an environment-only `tsx` IPC-socket
  denial; the exact affected bundle then passed 21/21 with local IPC permission,
  and the complete rerun finished exit 0, including shared Jest 96 suites /
  846 tests and strict Edge checks. Existing lint warnings remain warnings,
  with zero lint errors.
- Rehearsed exact migrations `20261112203000` and `20261112204000` against an
  isolated Postgres 17 minimal Production-shaped contract: apply produced both
  wrappers, the final quote wrapper contained no `order_quotes` update and
  locked `orders` before the canonical snapshot, reverse-order rollback removed
  both wrappers, and reapply restored both. A rolled-back NGN 100.00 behavior
  fixture then proved the wrapper returned NGN 2.00 provider cost / NGN 102.00
  customer total, locked those amounts on the order, and left the NGN 100.00
  tailor quote unchanged. A clean full-history local Supabase
  start remains unsuitable because pre-existing verification migration
  `20260731150100` requires a development order in an otherwise empty database;
  this targeted rehearsal did not edit that historical migration.

### 2026-11-12 — claim-bound Bachs refund regression

- A full refund of the customer-funded QA checkout initially failed closed
  before a provider request because the reserved Bachs claim did not yet own
  its immutable commercial-ledger allocation. Root cause: the refund path
  validated the allocation, then discarded it; the provider attempt was
  reserved before `refund_context` contained the frozen ledger entries. The
  database guard correctly refused to advance that incomplete claim.
- The Dev repair now binds the validated allocation to the still-`RESERVED`
  refund claim before any Bachs lookup or write. An existing context is accepted
  only when its canonical contents match exactly. Reviewed retries retain the
  same frozen allocation, and a missing/mismatched allocation fails before
  provider I/O. Focused refund, replay and Edge type checks passed **40/40**.
- That replay exposed a second missing step: the signed Bachs initial-order
  success had confirmed the order and posted its capture ledger, but unlike the
  Stripe path had not initialized the order's staged settlement plan. The Bachs
  webhook now runs the idempotent settlement refresh after an initial-order
  confirmation and again on duplicate-success recovery. Non-initial payment
  phases never create a plan. The focused settlement/refund suites passed
  **32/32**, and both Edge entrypoints type-checked.
- For the already-confirmed QA order only, the exact webhook settlement RPC was
  run once to create plan `49320826-bd4a-4fd8-ab3a-beff7c12acd4`. Because the
  original claim context had been frozen before that plan existed, its exact
  NGN 100.00 work-funding position was reconciled once after verifying the
  payment, plan, claim and ledger identities. No Production row was touched.
- The original claim/attempt and idempotency key were reused. Bachs created
  refund `rfnd_rHSrNKsOO0tOntA4` for NGN 102.00 and reported `processing`.
  A second replay returned that same refund ID and did not create a second
  provider refund. The signed terminal success then finalized that same claim
  and attempt as `SUCCEEDED`, moved the payment to `REFUNDED`, and recorded one
  refund journal only: NGN 100.00 debit to `TAILOR_ENTITLEMENT`, NGN 2.00 debit
  to `DRAPEON_REVENUE`, and NGN 102.00 credit to `PROVIDER_CLEARING`. The exact
  work-funding position is `REFUND_CONFIRMED`; the payment has one refund count
  and one provider refund ID.
- The earlier fail-closed attempt had opened Ops issue `#970`. Recovery now
  resolves `refund-failed:<payment-id>` only after the commercial refund has
  finalized, whether terminal success is observed synchronously or through the
  signed Bachs webhook. Focused refund/claim/event tests passed **33/33**, both
  Edge entrypoints type-checked, and the repaired functions were redeployed to
  Dev. The existing QA issue was reconciled to `RESOLVED` with an audit record
  after verifying the provider refund and balanced journal.
- A postflight also exposed an old Dev Stripe QA route left `ENABLED` outside
  Phase 4 scope. It was immediately moved to `DISABLED` through the audited
  route kill switch. The two Bachs Dev route versions remain `SANDBOX_ONLY`;
  Dev now has no `ENABLED` route.
- Dev deployments were limited to `refund-order-payments` and `bachs-webhook`.
  Production remains unchanged and every Bachs route remains non-enabled. The
  Phase 4 release plan now includes both functions in its separately approved
  Edge unit.
- The complete Node 22 `pnpm launch:contracts` gate was rerun after the refund
  recovery fix and passed. This included shared Jest **96 suites / 846 tests**,
  strict checks for every Edge entrypoint, mobile and web typechecks, focused
  refund/replay contracts, route/build guards, and `git diff --check`. Existing
  lint findings remain warnings only; there were zero lint errors. An earlier
  Node 18 run was discarded because the repository requires Node 22, and the
  first Node 22 sandbox run reached only a local `tsx` IPC permission denial;
  the permitted rerun completed exit 0.

### 2026-11-12 — Production release-scope reconciliation

- A branch-to-main scope audit found that the first release plan listed only the
  four disabled-route/provider-cost migrations, while the reviewed Phase 4 Edge
  runtime also depends on five earlier Dev-applied migrations. Deploying the
  runtime without them would leave Production without Bachs destination identity,
  definite-checkout-rejection handling, service-role claim authorization, the
  corrected rejection state, and accepted-route tranche destination behavior.
- The Production plan now has two independently approved database units: P4-1 is
  the five prerequisite migrations in dependency order; P4-2 is the four
  disabled-route/provider-cost migrations. Edge and web remain later units.
- A static contract now requires all nine versions exactly once and in order,
  requires the two database units, and preserves the zero-enabled-route preflight.
  The matching preflight is checked in as read-only SQL and covers exact history,
  prerequisite columns/constraints, callable signatures and grants, definition
  hashes, and route counts without reading customer or payment rows.
  This is a planning/code-scope correction only: no Production read, migration,
  provider call, Edge deploy, web deploy, or route transition occurred.
- The same audit was extended to Supabase function bundle dependencies. Seven
  entrypoints changed directly, but changed shared Bachs, refund, receipt-email
  and route-acceptance modules are bundled into 19 entrypoints; the direct
  `payment-route-availability` change brings the exact Edge release unit to 20.
  The release plan now names that complete closure, and its contract refuses an
  omitted or extra function. This remains release preparation only; no function
  was deployed by this audit.
- The release now has checked-in read-only preflight and postflight SQL. The
  postflight proves all nine history markers, destination identity guards,
  service-only callable privileges, the exact disabled route row, zero enabled
  routes/requests, and zero accepted orders pinned to the reserved route ID.
  Its contract rejects any write-capable SQL token and requires every planned
  version. Neither script has been run against Production yet.
- Dev verification then found the first prerequisite recorded under generated
  version `20261112182339` instead of source version `20261112181838`. Only the
  Dev history markers were repaired: the generated marker was reverted and the
  source marker applied, without rerunning schema SQL. A scoped read verified
  `20261112181838` is now the sole marker, named
  `phase4_bachs_destination_identity`. Production was not read or changed.

### 2026-11-12 — combined Phase 4 database release rehearsal

- Exported the Dev application schemas only (`public`, `private`,
  `payment_internal`, and `util`) through Supabase's temporary CLI login and
  IPv4 pooler into an isolated local Postgres 17 database. No table rows,
  credential value, Dev schema, or Production resource was changed. The local
  clone used standard `auth.uid()` / `auth.role()` stubs plus one synthetic
  non-login Ops actor solely because the disabled-route seed's audited insert
  requires that foreign-key target.
- Reconstructed the pre-Phase-4 baseline by running the exact existing rollback
  companions for the eight Dev-present changes. Applied the nine Production
  release migrations in documented order. The first combined rollback exposed
  a real defect: the seed's immutable `CREATED` route receipt has a restrictive
  foreign key, so the route rollback could not delete even a completely unused
  route.
- Hardened the rollback to require exactly the seed-created receipt and no
  other route history, delete that receipt and the exact general audit marker,
  then remove only the reviewed disabled route. Any order snapshot, enablement
  evidence, status change, provider identity use, or extra audit receipt still
  makes rollback fail closed. The static release contract now checks both the
  destination-identity usage guard and the exact route-receipt ordering.
- Authoritative local result: all nine migrations applied; all nine rollback
  companions ran in exact reverse order; the route, seed receipts,
  `provider_destination_ref`, and v2 wrappers were absent afterward; all nine
  migrations then reapplied successfully. Final checks found one exact
  `DISABLED` NGN/Bachs route, zero enabled routes, the provider destination
  identity column, the `REJECTED` checkout constraint, and both v2 acceptance
  wrappers. The release-plan contract passes **7/7** and `git diff --check`
  passes. Production remains unread and unchanged by this rehearsal.
- Re-ran the complete repository gate on Node 22.23.2 after the rollback repair.
  The first sandboxed run reached only the known local `tsx` IPC-socket
  permission boundary after all preceding checks had passed; that exact bundle
  passed **21/21** with local IPC permission. The complete permitted rerun then
  finished exit 0: shared Jest **96 suites / 846 tests**, web/mobile/Ops
  typechecks, lint with warnings but zero errors, strict checks for every Edge
  entrypoint, the Phase 4 release contract **7/7**, and all remaining launch
  contracts passed. No external system was changed by the gate.

### 2026-11-12 — Production Phase 4 read-only preflight

- Ran the checked-in Phase 4 Production preflight against Drape-PROD as a
  read-only transaction. None of the nine planned Phase 4 migration versions is
  present. Production has zero Bachs routes, zero Bachs payout destinations,
  zero provider-destination references, zero accepted orders pinned to the
  reserved route ID, zero active enablement requests, and zero enabled Bachs
  routes.
- The catalog matches the expected pre-Phase-4 baseline: the checkout-claim and
  settlement-tranche reservation RPCs exist and are callable only by
  `service_role`; the checkout-rejection RPC and `provider_destination_ref` do
  not exist yet; the current checkout-state constraint does not include
  `REJECTED`; and the two destination-identity constraints are absent. The
  compact evidence hashes were checkout claim
  `ca9ac294f5a2d0a0ed13fc193e43cbba` and tranche reservation
  `43d28cc50827f7fbe924cf0aa1577336`.
- Result: the P4-1 prerequisite batch is ready for a separate explicit
  Production approval. This preflight made no schema, data, secret, provider,
  Edge, web, or route change.

### 2026-11-13 — Production readiness dependency and migration history

- The first approved P4-1 migration failed before completing because Production
  did not have `payout_destinations.provider_external_account_present`. A
  follow-up read confirmed that the three earlier Stripe-readiness versions
  (`20261030154721`, `20261030231747`, `20261102054500`) were absent, the profile
  fields needed by the readiness sync were present, and the sync RPC was absent.
  This exposed a Production compatibility gap: deployed payout-account and
  Stripe-webhook code calls the missing sync RPC.
- After approval to close this prerequisite, the three source migrations were
  applied in order. Their schema effects are now present: four Stripe readiness
  evidence columns and `sync_stripe_payout_profile_readiness`. No route or payout
  was changed. Supabase's migration API recorded them under generated versions
  `20261113031822`, `20261113031910`, and `20261113031913` while retaining the
  source migration names and one statement per entry.
- The automatic safety review rejected a direct SQL update of Production
  migration-history rows. The exact marker correction is pending approval for
  the supported `supabase migration repair` workflow. No workaround was used.
  At that point, P4-1 had not been applied; its first failed attempt left no
  P4-1 marker or destination identity column. Bachs routes remained disabled.

### 2026-11-13 — Production P4-0 history repair and P4-1 schema

- The approved supported CLI history repair mapped the three generated
  prerequisite versions back to source versions:
  `20261113031822` → `20261030154721`, `20261113031910` → `20261030231747`,
  `20261113031913` → `20261102054500`. Read-only verification found all three
  source markers exactly once, no generated markers, the four readiness columns,
  and the restored Stripe readiness RPC.
- The five approved P4-1 SQL files then applied successfully. Read-only
  postflight found the provider destination reference column, both validated
  destination constraints, the `REJECTED` checkout constraint, all three
  expected RPCs, and the checkout claim callable only by `service_role`. There
  are zero enabled routes of any provider, zero Bachs routes, zero Bachs
  destinations, and zero Phase 4 route snapshots.
- The migration API again recorded P4-1 SQL under generated versions. It
  retained these exact source names:
  `20261113034054` → `20261112181838`, `20261113034059` → `20261112185135`,
  `20261113034102` → `20261112185545`, `20261113034105` → `20261112185931`,
  `20261113034109` → `20261112193225`. The supported repair is awaiting
  explicit approval for this five-marker mapping; P4-2 is not started.
- Production advisors after P4-0 reported zero health lints. Security and
  performance advisors reported 201 and 546 findings respectively; the only
  finding returned for the new destination objects was the existing informational
  `RLS enabled, no policies` notice on the service-managed `payout_destinations`
  table. No finding referenced the new provider identity column or readiness
  RPCs.

### 2026-11-13 — current release state

- The preceding P4-1 history-repair note is superseded: all five generated
  markers were repaired to the exact source versions with the supported
  `supabase migration repair` workflow. Production P4-0/P4-1 schema and exact
  history are verified.
- The first system-seed rehearsal failed safely because the existing route
  trigger requires a named Auth/Ops actor. The placeholder workforce principal
  does not exist in Production. The route is now seeded by
  `20261113040509_phase4_seed_disabled_bachs_ngn_route_system_audit.sql` using
  a transaction-local marker accepted only for the exact immutable disabled
  NGN Bachs route. No person or Ops principal is fabricated; `audit_logs`
  identifies the system migration.
- This source version was applied to Dev and recorded under the exact source
  version. Postflight confirms Dev's existing NGN Bachs versions 1 and 2 remain
  `SANDBOX_ONLY`, their IDs and fee schedules are unchanged, the reserved
  Production route ID was not added, and no route is `ENABLED`.
- Final disposable-Postgres rehearsal: apply created one disabled route, one
  null-person route audit receipt and one system audit marker; reapply did not
  duplicate them; a wrong-entity seed and an enable attempt through the system
  marker were rejected. The migration rollback removed the unused route and
  markers and restored the original route guard. Focused contract test passed
  7/7; `git diff --check` passed.
- Production P4-2 was approved and applied as four exact source versions:
  `20261112201000`, `20261112203000`, `20261112204000`, and `20261113040509`.
  The migration API initially recorded generated timestamps; the supported CLI
  history repair changed each generated marker to the approved source version.
  Exact P4-2 repairs: `20261113041820` → `20261112201000`,
  `20261113041918` → `20261112203000`, `20261113041947` → `20261112204000`,
  and `20261113042020` → `20261113040509`.
  A fresh read-only listing confirms all 12 P4-0/P4-1/P4-2 source versions are
  present exactly once and none of the four generated P4-2 markers remains.
- Production route postflight found exactly one Bachs route: the reserved
  `ng-ngn-ngn-bachs` version 1, NGN→NGN, entity `DRAPE_MARKETPLACE_LIMITED`,
  `fees_collector=PLATFORM`, fee schedule
  `ngn-card-provider-cost-2pct-v1`, status `DISABLED`. No Bachs destination,
  accepted order snapshot, enablement request or approval exists; there are
  zero enabled routes across all providers. The route audit guard and RLS remain
  enabled. The system seed produced one null-person `CREATED` route audit event
  plus one `phase4-production-migration` audit log.
- Production health Advisor returned zero lints. Security and Performance
  findings remain at the pre-release totals of 201 and 546; route-table
  `RLS enabled, no policies` and unindexed-FK notices are the previously
  observed service-managed-table findings, with no new total increase.
- The P4-2 database batch itself did not deploy Edge/web code, make a Bachs
  provider call, create a destination, or enable checkout. The separately
  approved Phase 4 Edge release is recorded below. Web remains a separate
  release boundary; routes stay disabled until live proof and two-person
  enablement are separately approved.
- After separate approval, the Phase 4 Edge batch was deployed sequentially
  from source tree `c447285e6ea82bd9ccd396a70d83e8418a289d10` to Production.
  All 20 functions are `ACTIVE`, advanced exactly one version, and retained
  `verify_jwt=false`:

  | Function | Before → after |
  |---|---:|
  | `bachs-webhook` | 1 → 2 |
  | `consultation-lifecycle-action` | 30 → 31 |
  | `customer-order-action` | 51 → 52 |
  | `drapeon-dispatch-action` | 28 → 29 |
  | `expire-pending-payments` | 48 → 49 |
  | `message-action` | 51 → 52 |
  | `monitor-settlements` | 29 → 30 |
  | `payment-action` | 52 → 53 |
  | `payment-route-availability` | 3 → 4 |
  | `payout-account-action` | 35 → 36 |
  | `paystack-webhook` | 53 → 54 |
  | `process-job-queue` | 58 → 59 |
  | `ready-made-order-action` | 54 → 55 |
  | `refund-order-payments` | 32 → 33 |
  | `release-order-tip` | 28 → 29 |
  | `release-settlement-tranche` | 30 → 31 |
  | `release-tailor-adjustment` | 1 → 2 |
  | `send-consultation-reminders` | 33 → 34 |
  | `stripe-webhook` | 52 → 53 |
  | `tailor-order-action` | 57 → 58 |

- Edge postflight: public `service-health?check=live` returned HTTP 200 and
  `status=ok`; an unauthenticated `payment-route-availability` POST returned
  HTTP 401 `UNAUTHORIZED`; the health Advisor returned zero lints. The final
  database check still found all 12 migration markers, one exact disabled
  Bachs route, zero enabled routes, zero Bachs destinations, snapshots,
  enablement requests or approvals, and one system seed audit receipt. No live
  Bachs request or payment was made.

### 2026-11-12 — Production release source accounting

- A read-only retrieval of the 20 Production bundles matched all 847 returned
  file blobs exactly to `c447285e6ea82bd9ccd396a70d83e8418a289d10`. This
  verifies source content, not a CI provenance attestation; Supabase metadata
  does not include the build Git SHA.
- All five held Track A slugs were outside the 20-function release and their
  deployed versions did not advance.
- A read-only route/payment aggregate still shows zero enabled routes, zero
  Bachs destinations, zero Bachs-pinned orders and zero Bachs payment rows.
- Release accounting and exact Production versions are in
  `docs/phase4-production-release-accounting-2026-11-12.md`. It records that
  migration `20261030154721` has no matching rollback file in the repository.
- Local code review confirms the web branch-build guard is present in both
  `main` and the candidate. Cloudflare's remote Workers Builds configuration
  could not be inspected: Wrangler is not authenticated. Do not push until an
  admin verifies the Production branch/build settings through read-only access.
- No Production write, deploy, or route change occurred during this audit.

### 2026-11-16 — Post-review Bachs follow-up staged locally

- The founder reviewed GitHub PR #209 at head
  `2c3e0da06a16247519aa467310aaf2bd2fd550b0` without approving or requesting
  changes. The review found four release-critical follow-ups: Bachs provider
  cost could be omitted on a benefit-backed retry; ready-made benefit UI could
  display that cost twice; a failed Bachs destination refresh could leave an
  unusable destination active; and three provider-cost rollback files could
  drop checkout RPCs that live Stripe checkout also calls.
- The isolated local branch `codex/phase4-bachs-fixes`, based directly on that
  reviewed head, contains the follow-up commits `3a954f64`, `7228946d`,
  `283729d6`, `c00d28a1`, and `379f0dba`. It preserves the locked Bachs cost
  on every benefit retry, displays a persisted ready-made benefit total exactly
  once, deactivates ambiguous/unusable Bachs destinations before surfacing the
  conflict, and makes each provider-cost rollback restore compatible checkout
  RPC bodies rather than dropping them. It also keeps Bachs HTTP 408/409
  checkout responses uncertain, normalizes receipt labels to the accepted
  charge-provider snapshot, and retains non-NGN checkout when the NGN route
  availability request is unavailable.
- The snapshot payout-readiness review item needed no money-behaviour change:
  accepted orders revalidate the *pinned destination's* active/capability/review
  state before a new transfer. A profile-level reverification requirement for a
  later payout setup must not strand an accepted earning whose pinned
  destination remains usable. Legacy orders still require the profile flag.
  The explicit regression assertion covers that distinction.
- Verification of the local follow-up: focused Bachs/route/readiness Deno
  suites **46/46**, shared provider-cost/receipt/currency Jest suites **56/56**,
  provider-cost migration-contract checks **3/3**, `payment-action` Deno
  typecheck, and `git diff --check` all passed. No Dev or Production data,
  migration, Edge deployment, provider request, or route status changed.
- **Publication is deliberately paused.** GitHub's Cloudflare bot reported a
  successful Production `drape` build for the unmerged PR #209 head `2c3e0da0`
  on 2026-11-16. This is additional evidence that remote Workers Builds control
  is not yet accounted for. The repository guard passes its 9 focused cases,
  but cannot prove or repair the remote Production-branch/build-command
  setting. Do not push this follow-up or any other branch until a Cloudflare
  admin provides read-only verification of that setting and the active version.
  The NGN/Bachs route remains `DISABLED` throughout.

### 2026-11-16 — PR #211 promotion-retry review follow-up

- Addressed the one blocking review finding on PR #211: an accepted custom
  Bachs quote can have a benefit reserved before acceptance, then fail before
  its first payment attempt is inserted. Its reservation stores the pre-cost
  due amount, while the accepted order has the locked provider cost. The
  checkout path now restores that due on the in-memory benefit passed to the
  pricing reservation, so capture amount and locked pricing total remain equal.
- The recovery is fail-closed: an inconsistent benefit/order total returns the
  existing recoverable 409 `PAYMENT_ROUTE_PROVIDER_COST_LOCK_FAILED`, rather
  than escaping as a generic Edge failure.
- Added a focused regression test for the exact no-attempt custom Bachs retry:
  reserved customer due + locked provider cost equals the accepted pricing
  total, and the capture-ledger breakdown accepts it.
- Verification: shared `provider-cost` Jest suite **12/12**; `deno check`
  for `payment-action`; `git diff --check`. No Dev or Production data,
  migration, Edge deployment, provider request, or route status changed.

### 2026-11-17 — Dev Bachs regression and public-catalogue repair

- A public ready-made catalogue regression in Dev was found while starting the
  Bachs visual pass. Anonymous `seller_items` reads embed `tailor_profiles`;
  the shared-order profile policy had also been evaluated for `anon` and read
  `orders`, which `anon` deliberately cannot read. This made the catalogue
  fail with `permission denied for table orders` before an item could be
  evaluated for checkout.
- The actual Postgres error was `permission denied for table orders`, caused by
  evaluating the shared-order profile policy for `anon`; it was not a missing
  profile-column grant. The shared-order policy is now `TO authenticated` and
  still requires a customer-owned shared order. The catalogue fields
  (`id`, `display_name`, `business_name`, `avatar_url`, `location`,
  `availability`, `shop_paused`, `is_live`) were already granted individually
  by earlier migrations. A later Dev-only table-wide SELECT grant was unsafe:
  it would expose payout, bank and document columns despite their column-level
  revokes. It is removed from the promotion candidate. The later correction is
  documented below: a conditional repair may revoke a table grant only when it
  exists, and the full established per-role column baseline is restored rather
  than a narrow catalogue-only subset. A public-key contract test requests zero
  rows and proves every protected public field is denied.
- Fresh browser evidence for the current-code Bachs custom-order path is
  present on the Dev QA account. Order
  `f4170000-0000-4000-8000-000000000001` is `CONFIRMED` with a succeeded NGN
  102.00 payment after the deliberate failure/retry; its replayed provider
  event remains `evt_f622007665d156bab614f88f5aabe9a6`.
- The post-acceptance-promotion order
  `f4180000-0000-4000-8000-000000000001` has a completed Bachs receipt
  `DRP-2026-00000038`: NGN 60,000.00 work, a Drapeon-funded NGN 10,000.00
  benefit, NGN 1,200.00 `Payment processing`, and NGN 51,200.00 total paid.
  The receipt identifies `Drapeon, operated by Drape Marketplace Limited`.
  This confirms the current web receipt uses the locked, discounted total and
  the Bachs-specific customer fee label.
- The same order-detail sidebar still presents the immutable source quote/old
  order total of NGN 61,200.00 while its Payments panel and receipt show the
  actual NGN 51,200.00 capture. This is not a charge mismatch—the captured
  payment and receipt agree—but it is a customer-facing commercial-state
  ambiguity that remains **OPEN** for the next UI/payment review.
- iOS evidence is now complete for both fresh Bachs custom orders. The Dev
  new-device challenge was accepted by Resend with a provider reference, and a
  current inbox code completed the normal verification flow; no auth guard was
  bypassed. On the customer order view, both orders are `CONFIRMED`. Their
  mobile receipts show the same locked totals as the corresponding captures:
  `DRP-2026-00000037` shows NGN 100.00 work + NGN 2.00 `Payment processing`
  = NGN 102.00, and `DRP-2026-00000038` shows NGN 60,000.00 work − NGN
  10,000.00 benefit + NGN 1,200.00 `Payment processing` = NGN 51,200.00.
  Both render `Drapeon, operated by Drape Marketplace Limited`.
- The signed-in account's tailors workspace is reachable on iOS and correctly
  reports zero active orders. It is not the `Phase 3 Bachs QA Tailor` pinned on
  the two evidence orders, so this does **not** prove the recipient-tailor
  order view. That remains a Dev-fixture coverage gap; no profile visibility,
  verification, or payout readiness was changed merely to manufacture it.
- Ready-made Bachs checkout remains blocked as a fixture-coverage gap, not a
  runtime failure: the public catalogue loads after the policy repair, but has
  no public NGN/Bachs-ready Nigerian seller item. A Ghana seller item fails
  closed before checkout because its charge currency does not match the
  seller's payout destination. No route or seller configuration was changed
  to force a checkout.
- Android's active Dev emulator reaches the same verified-tailor cockpit and
  correctly shows zero active orders plus `Paid orders paused`; its order
  fixture is likewise not the separate Bachs recipient profile, so it is not
  counted as recipient-tailor proof. Local Ops could not be used for the
  visual check because its development server was intentionally missing its
  server-side Supabase credential and stayed on the locked-workforce screen.
  This is an environment configuration gap, not evidence of an Ops money-flow
  failure; no secret was created or changed to bypass it.

### 2026-11-17 — Dev public-catalogue permission correction

- **Incident:** Dev had applied `20261117172226`, which granted table-wide
  `SELECT` on `public.tailor_profiles` to `anon` and `authenticated`. Before
  correction, a zero-row public-key projection containing payout, bank and
  document fields returned HTTP 200. No values were requested or recorded.
- **Cause:** the original public-catalogue failure was exactly `permission
denied for table orders`, not a missing `tailor_profiles` grant. The eight
  embedded catalogue columns were already individually granted. The table-wide
  grant incorrectly assumed RLS also limited columns.
- **Initial repair correction:** the first Dev repair (`20261117190000`) did
  revoke the unsafe table grant, but its first draft restored only eight public
  columns. PostgreSQL treats `REVOKE SELECT ON TABLE` as also removing every
  individual column grant, so that draft would have broken public profile
  fields and authenticated tailor setup/profile reads. It was never promoted.
- **Dev repair:** the source for `20261117190000` now first checks
  `information_schema.table_privileges`; it changes an environment only when a
  direct table-wide grant exists and, in that case, restores the complete
  Production-derived per-column baseline. The additive Dev-only
  `20261117191500_restore_tailor_profile_column_grants` then restored that
  exact baseline after the earlier draft had run: 38 `anon` columns and 71
  `authenticated` columns. Both roles have no table-wide `SELECT`. The unsafe
  `20261117172226` source and its Dev history marker remain reverted.
- **Applied-source note and history:** `20261117190000` was first applied to
  Dev while it contained the incomplete eight-column repair. Its source was
  subsequently corrected to the conditional full-baseline form above; this is
  recorded here because changing an applied migration is exceptional, not a
  normal repair strategy. `20261117191500` is the forward Dev repair that made
  the actual database state match the corrected intent. A linked Dev migration
  check on 2026-11-17 shows the expected relevant source versions
  `20261117171105`, `20261117190000`, and `20261117191500`, and no unsafe
  `20261117172226` or generated `20261117190917` marker. The separate
  `20261117172853_monitor_cron_edge_outcomes` history entry predates this
  correction and has no source file on this branch; it was neither created nor
  changed by this work.
- **Verification:** an exact `information_schema.column_privileges` diff of
  Dev against that Production baseline returned **0 differences**. The current
  Dev publishable key passes zero-row requests for the full public catalogue,
  mobile-search, and saved-tailor projections (HTTP 200); all protected public
  payout, bank, document, verification, and test-profile fields return HTTP
  401. The static contract rejects a table-wide grant and checks the complete
  migration grant lists plus the public/authenticated application projections.
  No profile values were read.
  Security Advisor findings do not mention `tailor_profiles`; pre-existing
  project-wide findings remain outside this repair.
- **Production:** read-only public-key checks show the safe projection returns
  HTTP 200 and a payout-field projection returns HTTP 401. Production has no
  table-wide `tailor_profiles` SELECT grant, so the corrected conditional
  migration is a no-op there. No Production SQL, deployment, or route
  configuration was changed.
- **Browser coverage:** signed-out Dev checks passed for Explore and a public
  tailor profile (bio, category, ratings, portfolio and fulfilment fields all
  rendered); the QA customer saw Explore and the same public profile. The QA
  tailor's own profile/setup browser pass is **NEEDS FOUNDER**: the new-device
  email challenge correctly stopped a password-only sign-in, and no bypass was
  used. Shop item detail remains covered by the public REST projection contract
  until a signed-in customer test session is available again.

### 2026-11-18 — Current-code Dev Bachs ready-made regression

- **Scope and route safety:** all activity below used only the Dev Supabase
  project and Bachs Sandbox. The NGN/Bachs route
  `b4c80000-0000-4000-8000-000000000002` was returned from `SANDBOX_ONLY` to
  `DISABLED` through `ops_disable_payment_route` after the run, with an audit
  event. No Production route, credential, provider account, or payment changed.
- **Audited stale-tranche recovery:** the tagged Dev tranche
  `86262260-3127-436d-af39-6173540a7a36` was already `RELEASED` with its claim
  transferred and provider reference persisted, while its linked Money Desk
  request/execution was `EXECUTING`/`PROCESSING`. The existing idempotent
  `complete_money_desk_execution` RPC created one `SUCCEEDED` execution receipt
  (`24ad7d8f-b50f-4ba4-9d9d-c2ad00db0e2a`) and made no provider call. Root cause:
  Dev scheduled only the alert-only settlement monitor, not bounded
  reconciliation; that monitoring gap remains a Stage 2 release gate.
- **Ready-made payment failure and recovery:** a tagged low-value fixture
  persisted a Bachs validation failure before provider checkout creation
  (attempt `9f3bb1f4-f72e-4684-8461-7a713e91ed8f`). The separate successful
  fixture created order `b075928d-33db-4be9-a8e5-b5ed4ec74eac`, attempt
  `65f828c8-8064-47b4-a6fc-e0aa562313bd`, and Bachs checkout
  `chk_U3RLJgpFHlOCQFqH` for NGN 109.65. A declined-card run produced signed
  event `evt_ab7d92dc2056df8be920d8e4a807b6b7`; retrying the *same* checkout
  reused the attempt and then completed signed collection event
  `evt_0d1c1123520a522bedfd45b18b29acca` (webhook inbox
  `1025a9c6-def4-4615-afee-571b62f23f33`). The attempt is `SUCCEEDED` and the
  order is `CONFIRMED`. This proves current-code checkout reuse and a failed
  payment recovery without a duplicate checkout.
- **Refund lookup/idempotency:** a full Dev-only refund was requested for the
  successful order. Bachs created provider refund `rfnd_jEf7IpPjBABusJ5f`,
  linked claim `e45827e7-8c41-4e30-b5d1-dd9e1d5a2148`, and attempt
  `6e31f252-4177-41d0-935f-db2aac3829c6`; signed `refund.created` event
  `evt_370934c2d68977e2affd252a6374d6f8` was processed in inbox row
  `9204e10d-e69c-498e-9408-8754f145c804`. Repeating the Drapeon refund action
  performed provider lookup and reused that claim/attempt; no second Bachs
  refund was created. It remained `PROVIDER_PENDING` at the end of the
  observation window, so a sandbox `refund.paid` receipt is **not claimed**.
- **Receiving-tailor web:** the dedicated unpublished test recipient loaded
  the confirmed ready-made order and payment panel in local Dev. The UI showed
  a confirmed Local Collection order and a succeeded NGN 109.65 payment with
  no raw provider/database state. The fixture was not made discoverable.
- **Customer/Ops/replay limits:** the QA purchaser also has an independent
  tailor profile, so local web selects its tailor workspace and cannot represent
  the customer receipt without changing a separate test identity. Checkout
  itself visibly completed in the customer handoff. Local Ops is intentionally
  locked to a founder workforce identity and was not bypassed under the
  QA-only rule. Persisted Dev payment/refund/webhook/audit records provide
  data-level Ops evidence. Bachs' adapter exposes provider-event retrieval but
  no replay operation, and the sandbox dashboard session was unavailable; a
  provider-originated duplicate webhook replay is **BLOCKED**, not inferred
  from unit tests.

### 2026-11-18 — Follow-up verification and local Android build

- PR #240 merged after both CI checks passed. The Dev refund claim
  `e45827e7-8c41-4e30-b5d1-dd9e1d5a2148` remains `PROVIDER_PENDING` on a
  fresh read. The signed `refund.created` event
  `evt_370934c2d68977e2affd252a6374d6f8` and collection event
  `evt_0d1c1123520a522bedfd45b18b29acca` are each `PROCESSED` with
  `receive_count=1`. No terminal refund or provider replay has reached Dev.
- Correction to the earlier replay assessment: Bachs documents both
  `POST /v1/webhooks/replay` and an endpoint-specific event resend API. A
  provider-originated replay is therefore supported, but has not been run:
  the sandbox webhook-writing credential/dashboard session was unavailable to
  this pass. The claim of no replay operation above describes only Drapeon's
  adapter, not Bachs' API. See [Bachs replay guidance](https://docs.bachs.io/guides/webhooks/replay-events).
- Bachs also documents `simulated_outcome: "success"` on a *new* sandbox refund
  to force `refund.paid`. The existing refund was submitted without that field
  and cannot be replaced while it is processing because Bachs allows one
  active refund per charge. A fresh tagged paid order and claim-safe refund
  request are needed for this proof. See [Bachs sandbox testing](https://docs.bachs.io/integrate/sandbox)
  and [refund testing](https://docs.bachs.io/guides/refunds).
- The local Android build from `1111d569638512771a120c0cf9bee5555981750a`
  uncovered a reproducible release blocker. Node 18 initially failed Prisma;
  the clean checkout also needed the existing ignored Android Firebase file
  supplied to the local builder. With Node 22, the SDK and Firebase file, the
  release reached `:app:minifyReleaseWithR8`. A 512 MiB Gradle Metaspace limit
  failed one attempt. Increasing Gradle memory let R8 run and expose missing
  Stripe push-provisioning classes (`com.stripe.android.pushProvisioning.*`).
  Gradle wrote `missing_rules.txt` with five scoped `-dontwarn` rules, then
  failed `:app:minifyReleaseWithR8` after 13m58s. No AAB or build-matched
  `mapping.txt` exists, so nothing was uploaded to Play or Sentry. R8 remains
  enabled; disabling it to obtain an artifact would hide the release defect.
- Installed TestFlight build 28 targets the Production Supabase environment,
  as does the matching `testflight` Android profile. These builds cannot be
  used to view the Dev QA Bachs order while the instruction limits this pass
  to Dev. A Dev-targeted internal build is required for installed-build Dev
  receipt and receiving-tailor evidence.

### 2026-11-18 — Mobile release-candidate artifacts

- **Source integrity:** the release build came from a separate clean checkout
  at merged `main` commit `1111d569638512771a120c0cf9bee5555981750a`. The
  checkout was clean, `git diff --check` passed, and `pnpm launch:contracts`
  passed under Node 22.23.2 before submission.
- **iOS internal beta:** EAS iOS build
  `f8c62493-5a9d-4d1e-96ea-aadd58f0227e` completed for version `1.0.4` build
  `28` on the `staging` channel. It was uploaded to App Store Connect as build
  `993bea39-b920-4b66-82e4-cf72eab38dcb`, which is `VALID` and available to
  the existing internal TestFlight group. No App Store submission, external
  TestFlight review, or public release was requested or performed.
- **Android internal beta:** no Android build was created. The EAS account had
  exhausted its monthly Android build allowance and reported its reset on
  2026-12-01. Consequently there is no build-matched Android `mapping.txt`,
  native-symbol upload, or Play Internal artifact to record yet. Do not treat
  the iOS artifact as cross-platform mobile-release evidence; create the
  Android build after capacity is restored and attach its exact mapping/native
  symbols to both Play and Sentry per `AGENTS.md`.

### 2026-11-18 — follow-up internal candidate and Dev receipt

- PR #245's scoped R8 rules were rebased onto `main` `9ed3edcf` without merging
  it. The candidate source is `74cb9ca77fb8ef6db1317a67961dad9be75e63e7`.
  This is an explicitly approved exception to the usual merged-main release
  build rule for **internal testing only**. No public store release or payment
  route change is implied.
- EAS iOS internal build `09ee39ac-3153-4c42-9200-6b25469acfe5` finished
  from that candidate at app version `1.0.4`, build `29`; its IPA checksum is
  `3bac4fbd94cd3f48cb4288d902f3d3114be5e3043e1eb03410e85b3d7c605c2c`.
  App Store Connect upload/build `9db96c48-ed29-4a81-a47c-7930e565376f`
  processed `VALID`; TestFlight reports `internalBuildState=IN_BETA_TESTING`.
  It was not submitted to external review or the public store.
- A clean local Android EAS build from the **same** candidate SHA passed R8 and
  produced version `1.0.4`, version code `35`. The AAB checksum is
  `22fb3cfe989068fb7462c91de9525df663c093f86cf1d6dfdbed39d0e7f30ead`.
  The build-matched R8 map checksum is
  `7d48a0a05298a8fb1588a697d50a3466ba29a792580ec73ddbceb6ee12e8248c`;
  the map embedded in the AAB has the same checksum. The AAB also embeds 84
  native debug-symbol files. EAS submission
  `168295c8-48b3-45dd-8db0-717d237531aa` **succeeded** to Play's internal
  track. That submission carried the embedded map and native symbols to Play.
  Sentry separately accepted the map (debug ID
  `418e01c6-2769-5893-9b38-1ee385ade22d`) and all 84 native files; the JS
  source-map upload also completed during the local build.
- The installed **Dev** iPhone client already had the tagged QA purchaser
  session, so no password reset or fixture ownership rewrite was needed. The
  paid ready-made order `b075928d-33db-4be9-a8e5-b5ed4ec74eac` opened via
  its Dev deep link. The receipt `DRP-2026-00000039` shows captured NGN 109.65:
  NGN 100.00 item, NGN 2.15 “Payment processing”, NGN 7.50 VAT, and free
  fulfilment. It names Drape Marketplace Limited and Bachs checkout
  `chk_U3RLJgpFHlOCQFqH`. The screenshot is
  [Dev iOS receipt](phase4-evidence/dev-bachs-ready-made-ios-receipt.png).
  Dev `order_payments` independently reports `SUCCEEDED`, amount `10965` minor
  units, currency `NGN`, for payment `65f828c8-8064-47b4-a6fc-e0aa562313bd`.
- The Dev Bachs route `b4c80000-0000-4000-8000-000000000002` was read again
  and remains `DISABLED` at version 2. No Production or live-mode provider call
  was made in this follow-up.
- Customer web originally mislabeled the full NGN 109.65 as “Item subtotal.”
  The Dev-verified fix in PR #249 now displays NGN 100.00 item subtotal,
  NGN 2.15 payment processing, NGN 7.50 tax and NGN 109.65 total. The iOS
  receipt was already correct. PR #249 is separate and unmerged.
- The Bachs sandbox portal is signed out, and no write-capable Bachs sandbox
  credential is available to this local session. Consequently the **new**
  forced-success refund and Bachs-originated replay were not run. The existing
  `PROVIDER_PENDING` refund remains documented above; no synthetic event was
  substituted for a provider receipt. Dev Ops has two existing QA workforce
  principals, so no extra admin was created, but their MFA-backed local UI
  credentials are unavailable. Order/tranche/refund Ops **screens** are still
  unverified; their persisted Dev records are not visual proof. The Dev iOS
  receipt was verified, while installed TestFlight and Play binaries point to
  Production and cannot display this Dev order. Internal store processing is
  proven; installed-build Dev payment-screen coverage is still open.

### 2026-11-18 — Sandbox terminal refund and provider replay follow-up

- This follow-up used Bachs **Sandbox** and Supabase **Dev** only. The provider
  payment `ch_d621bb3d87944e14a589306169f4ecc4` for Dev order
  `b075928d-33db-4be9-a8e5-b5ed4ec74eac` shows a completed NGN 109.65
  refund, `rfnd_jEf7IpPjBABusJ5f`. Bachs delivered its signed `refund.paid`
  event `evt_a2144c9a57f98e6f3fb11249edcdde1e` to the Dev callback with
  HTTP 200. This closes the provider's ability to produce a terminal sandbox
  refund event; it does **not** prove Drapeon's refund finalization.
- Dev inbox row `60e7be57-d79a-45de-b992-a4692447cb44` recorded
  `refund_identity_needs_ops_review`. The linked claim
  `e45827e7-8c41-4e30-b5d1-dd9e1d5a2148` remained `PROVIDER_PENDING`, and
  payment `65f828c8-8064-47b4-a6fc-e0aa562313bd` remained `SUCCEEDED` with
  zero refunded amount in Drapeon's ledger. Bachs serialized the requested
  amount as `109.650000000000000000` in `refund.paid`; the old parser rejected
  that exact value because it allowed at most two decimal places. The signed
  event correctly failed closed to Ops rather than posting a guessed refund.
- PR #252 accepts extra **zero-only** decimal places from Bachs and rejects
  any extra nonzero precision. The focused Bachs/parser tests passed 15/15,
  `bachs-webhook` typechecked, and Node 22 `launch:contracts` passed. Only
  `bachs-webhook` was deployed to Dev, version 84 to 85, with `verify_jwt=false`
  preserved. Production Edge was not changed. A fresh Dev provider refund is
  still needed to prove finalization on version 85; the earlier processed event
  must not be repurposed as that proof.
- From the Bachs sandbox Events page, the provider retried the same signed
  `refund.paid` event to both configured Dev destinations. The same Dev inbox
  row's `receive_count` increased from 1 to 3; its ID, processed timestamp and
  review result were unchanged. This proves provider-originated replay is
  deduplicated without a second refund outcome. No locally forged event was
  used.
- The sandbox QA key created for this follow-up appeared in browser-control
  output. Its value is absent from this repository and all evidence. The
  founder chose to leave that scoped sandbox key active for now; rotate it
  before reusing it for future QA. No live credential was involved.
- The Dev NGN/Bachs route `b4c80000-0000-4000-8000-000000000002` was
  rechecked after replay and remains `DISABLED` at version 2.

### 2026-11-18 — Fresh refund finalization on the corrected Dev webhook

- The existing Dev QA custom order `f4170000-0000-4000-8000-000000000001`
  had a settled NGN 102.00 Bachs sandbox charge
  `ch_d452b06c05164cce8ba8b3e2df0e9ed8`. A new refund was submitted
  through Dev `refund-order-payments` after `bachs-webhook` v85 deployed.
  The function returned HTTP 202 and saved claim
  `1f0170be-b0bd-4a9d-99f7-942cb73255fb`, attempt
  `3a6876b6-c289-4ae0-ad24-e4ce8638994c`, and provider refund
  `rfnd_ppKiYeB05Zf9coxD`.
- The Bachs **Sandbox** payment page showed “Refund completed” for NGN
  102.00. In Supabase **Dev**, the claim and attempt both reached
  `SUCCEEDED`; payment `4d35b88e-abf5-44b0-b2a1-d4d6a70f2e6d` reached
  `REFUNDED` with `refunded_amount=10200` minor units. The signed
  `refund.paid` event `evt_79d390d54a1f3b24dbfec58f9c2569e6` was
  recorded once in inbox row `82eac2fd-10ed-4339-8145-c1be7abd9fd3`.
  Its payload has `requested_amount="102.000000000000000000"` and
  `refunded_amount="102.00"`. The claim and attempt's provider evidence
  both name this event and retain those exact strings. The v85 webhook's
  identity matcher accepted the padded requested amount; otherwise it
  would have recorded `refund_identity_needs_ops_review` before reaching
  the outcome RPC.
- The inbox row was received at **2026-11-19 02:34:38.400583 UTC** and
  processing began at **02:34:38.649 UTC**. The claim and attempt were
  updated to `SUCCEEDED` at **02:34:38.876246 UTC**, before the webhook
  marked the inbox row processed at **02:34:39.011 UTC**. This was the
  webhook's own `record_bachs_payment_refund_attempt_outcome` RPC: it sets
  the attempt and claim status and calls
  `record_confirmed_order_payment_refund` for the payment. The handler then
  re-read the now-refunded payment and recorded `refund_already_finalized`.
  Thus that result describes an intra-webhook second-finalization guard,
  not a prior synchronous refund response or reconciler. The earlier
  failed-closed claim remains separate history.
- This proof used sandbox money only. No Production function, route, key,
  order, or payout was changed.
- The receiving-tailor **web** screen for the confirmed ready-made order
  had already passed in the Stage 1 run above: the unpublished QA recipient
  saw the order and its NGN 109.65 succeeded payment. This follow-up did not
  add an Android receiving-tailor pass. A fresh local Dev Ops attempt was
  stopped before login: Next.js Turbopack could not start an FSEvent stream;
  the webpack fallback hit `EMFILE: too many open files, watch` and did not
  serve `/ops/my-work`. A non-watching build served locally, but its generated
  CSP still pointed at the Production Supabase project and required Cloudflare
  Access, so it was not used to inspect Dev records. Polling-based webpack
  then served the **development** app with a Dev-only service role and the
  existing `founders+ops-qa@drapeon.co` workforce principal through its
  named local dry-run bridge. The UI showed the `DEVELOPMENT` badge and the
  QA identity. On order `b075928d-33db-4be9-a8e5-b5ed4ec74eac`, Ops
  displayed Bachs NGN 109.65 `Succeeded` and the Local Handoff 80 / Local
  Settled 20 tranches at NGN 80.00 / NGN 20.00, both `Locked`. On order
  `f4170000-0000-4000-8000-000000000001`, Ops displayed Bachs NGN 102.00
  `Refunded` with NGN 102.00 refunded; its linked Money Desk view contained
  zero requests. This closes the order/tranche/refund **Dev Ops visual**
  check. It is a local QA dry-run session, not proof of Production Ops
  authentication or of an MFA-backed Dev session.
- The Android API 35 emulator ran the Dev client against the current #249
  branch and signed in as the approved QA customer. Its ready-made order
  `b075928d-33db-4be9-a8e5-b5ed4ec74eac` opened as Order Placed. The
  payment receipt `DRP-2026-00000039` showed NGN 100.00 item subtotal,
  NGN 2.15 payment processing, free **Fulfillment**, NGN 7.50 Nigeria VAT and
  NGN 109.65 captured, matching the provider charge. The live component
  initially showed the custom-order subtotal label; #249 was extended at
  `73c7e174` to read the order kind and use the shared ready-made label.
  Fast Refresh then showed **Item subtotal** on the same Android receipt.
  This is Dev-client coverage, not coverage of the installed Play binary,
  which points to Production. The QA customer credential was rotated in
  Dev after its saved password proved stale and is stored in local Keychain;
  no password is in this repository or evidence.

#### Stage 2 owner and readiness snapshot

| Gate | Owner | State at this follow-up |
| --- | --- | --- |
| Live account country, ticket `#154675279` | Bachs | Resolved: Bachs reports the live account is now NG; sandbox was already NG. The adapter still sends explicit `country=NG` for bank lookup. Foreign-card and withdrawal questions remain separate gates. |
| Live Bachs keys and signed webhook subscriptions | Founder | Not configured by this Dev-only pass; no live request made. |
| First real Nigerian tailor, hosted KYC and payout destination | Founder and tailor | Pending; sandbox synthetic recipient is not live evidence. |
| NG tax-policy signoff | Founder and tax adviser | Pending recorded review before a live route. |
| Named two-person Ops enablement | Founder | Two distinct live approvers still need to be named and verified. |
| Bachs health, stuck-transfer reconciliation and Slack alerts | Engineering | Signed sandbox money proof exists; the Dev stale-tranche recovery exposed a missing bounded reconciliation schedule. This remains an implementation/verification gate. |
| Kill switch and 72-hour monitoring | Engineering and Ops | Route disablement and the controlled proof runbook exist; an on-call owner and monitored live window remain to be assigned. |

Stage 3 live proof and every route enablement remain on hold. The internal
mobile candidate and Dev screenshots do not satisfy the live gates.

### 2026-11-19 — Bachs fee, refund-recovery, and withdrawal findings

2026-11-20 sandbox credential follow-up: replacement key created and set as
Dev `BACHS_SANDBOX_API_KEY`; `GET /v1/reference/banks?country=NG` returned 200.
The exposed key was revoked in the sandbox dashboard at approximately
2026-11-20T15:50:00Z. The old value is not retained, so a direct 401 replay
has not been independently observed. No key material is recorded here.

This work makes no Production request, uses no live credential, performs no
provider money movement, and does not change any payment-route status.

| Topic | Confirmed finding | Implementation / remaining work |
| --- | --- | --- |
| Settlement fee field | Bachs documents `fees.amount` on payment retrieval and `fee` on payment list results. The settlement reader uses `payment.fees.amount`; the field mapping is correct and this ticket item is closed. | Keep the account-specific rate open. The published 2% is only the standard NGN-card rate, not confirmation of Drapeon's negotiated/account rate. |
| Refund with short platform balance | Bachs' documented refund behavior is asynchronous; its 400 `Insufficient balance to refund` is treated as an authoritative no-movement refusal. Code records a terminal reconciled attempt with `INSUFFICIENT_PLATFORM_REFUND_BALANCE`, creates a critical Money Desk case, and returns an explicit review-required response rather than a generic processing result. | Focused tests cover the safe error classification, no-movement evidence, and case payload. The Dev-only two-person Money Desk preparation/execution path pins the original claim, case, payout destination, and exact tailor share. Its three changed Edge functions are deployed in Dev, but the six-step provider proof has not passed. A new unpublished synthetic tailor's Bachs onboarding returned provider `403 FORBIDDEN`; the temporary Dev onboarding flag was restored to false. No recovery transfer was sent. |
| Transfer recovery | Bachs documents that a transfer cannot be reversed. Recovery is a new connected-account-to-platform transfer, using `X-Account-Id` and `destination: "self"`, and only against currently available connected-account balance. The branch adds an idempotent adapter helper and an audited, two-person Dev-only Money Desk workflow. | Pure preparation, provider-identity lookup and adapter tests pass. A submission marker is committed before provider I/O; the returned transfer ID is saved immediately; an interrupted/pending request can be reconciled from Ops by listing provider transfers, without another POST. The sandbox key has been rotated, but no Dev integration or provider event proof exists yet. When the recipient has withdrawn the funds and the connected balance cannot cover recovery, the customer refund is a Drapeon-funded loss and needs an explicit legal/business policy. |
| Withdrawal fee | The founder approved funding the connected-account payout fee with a separate platform-to-recipient top-up, booked as a platform cost, and requiring the actual `fee` and `total_debited` from the payout response to reconcile. Bachs' general fees page states ₦50 as the standard local bank-withdrawal fee; its Payouts example shows a 100 fee on a 7,000 payout. | The actual payout fee is returned after `POST /v1/payouts`; the same-currency API docs provide no preflight quote. Therefore code cannot safely know the top-up amount before the payout request or guarantee “fail closed before movement” when the actual fee differs. The Dev runtime has no caller of `createBachsPayout`; no top-up, platform-cost ledger entry, or payout was run. Keep all Bachs payouts blocked until Bachs provides a usable fee quote/preflight or confirms the account-specific fee and an audited payout implementation can reserve that exact amount. Do not hardcode ₦50 or ₦100. |
| First payout review | Bachs says the first payout from an account it creates is held for a one-time review, while a recipient-only account registered purely as a payee is not held. A payout may nevertheless remain `pending`; only `payout.paid` and `payout.failed` are terminal. `payout.created` maps to `PENDING`, which neither clears an earlier failure nor creates a failure case on its own. | A focused unit test now covers a first pending event as normal. Keep written confirmation for Drapeon's specific recipient-only account as an open item; do not label pending as stuck without provider-specific evidence. |
| Payout initiation | Transfer-funded recipients do not use automatic payout schedules; a withdrawal must be started through the account-scoped `POST /v1/payouts` API. | The repository has API adapter and retrieval support, but no runtime caller was found. Each request must be started explicitly through the API; do not claim the product payout path is proven until an audited caller and Dev sandbox proof exist. |

The fresh unpublished Dev tailor used for the attempted recovery proof has
user ID `11e9cee4-6087-49d6-b93e-d6cf996db11d`, profile ID
`cab025a5-bdd8-41e7-bce2-2fe6dc4ec52c`, and Bachs onboarding claim ID
`0ff62189-b051-4e2c-ac4a-b708fdff9eae`. The claim remains `RESERVED` after
the sandbox account-creation request returned `403 FORBIDDEN`; there is no
provider account ID. The test user is unpublished, is not the Reference QA
Tailor, and has no order or transfer. Do not fabricate a provider identity or
reassign a different account to this claim. Dev has two `DISABLED` routes and
one `SANDBOX_ONLY` route, with zero `ENABLED` routes.
The Dev recovery functions are `refund-order-payments` v145,
`ops-money-action` v110, and `recover-bachs-refund-balance` v11. The Dev-only
onboarding flag has been returned to `false` after the provider refusal.
The six-step proof also needs two separately authenticated, fresh-MFA Dev Ops
principals: `ops-money-action` checks Cloudflare Access identity, the Dev
workforce registry, and the configured Money Desk approver list. Creating two
database rows alone would not prove independent approvals or satisfy the
endpoint gate. No such synthetic approvals were claimed.

Open Bachs questions remain non-blocking for this Dev work: Drapeon's actual
processing rate; the authoritative settled-net endpoint; written confirmation
of first-review behavior for this recipient-only account; and the ₦50 versus 100
fee discrepancy. Ticket `#154675279`'s country move is resolved: the live
account is now NG and sandbox already was NG. Bank lookup and
withdrawal requests must continue to send `country=NG` explicitly where
applicable. No route is enabled.

Primary references: [Bachs Transfers](https://docs.bachs.io/connect/transfers),
[Bachs Payouts](https://docs.bachs.io/connect/payouts),
[Bachs Processing Fees](https://docs.bachs.io/connect/processing-fees),
[Bachs Refunds](https://docs.bachs.io/guides/refunds), and
[Bachs Fees](https://docs.bachs.io/for-you/fees).

Bachs' transfer documentation says transfers cannot be cancelled/reversed and
recovery requires a second transfer from the connected account to `self`, limited
to available balance. Its payout documentation says `amount` reaches the bank,
`total_debited` includes the fee, and payout status is asynchronous. The published
NGN bank-fee schedule says ₦50, while the same payout documentation example returns
₦100 on a ₦7,000 withdrawal. The account-specific fee therefore remains unverified.
There is no payout-runtime caller in the repository; no ₦50 platform top-up,
platform-cost ledger posting, or sandbox withdrawal has been implemented or run.
Do not claim the fee-top-up flow is ready: the actual fee is returned after the
payout request, and the same-currency API docs do not describe a fee quote that
would let Drapeon verify the fee before creating that irreversible payout.

### 2026-11-19 — Stage 2 live-payment blockers and owners

This checklist supersedes the earlier owner snapshot where statuses have
changed. It is a planning record only: this Phase 4 lane made no Production
changes, configured no live credentials, and did not enable a route. Stage 3
has not started.

| Blocking gate | Owner | Readiness now | Evidence required to close |
| --- | --- | --- | --- |
| Production migration drift | Agent 1 (Production release owner) | Open; this lane did not inspect or change Production. Do not use a broad migration push. | Reconcile each missing history version against the actual Production schema; approve and apply only scoped forward repairs or proven history-only repairs; record exact versions and postflight. |
| PAY-003 / C2 integrity repairs, PR [#235](https://github.com/Drape-ltd/drapeon/pull/235) | Agent 2 (migration implementation); Agent 1 (Production) | Open at `35e2ff59`; Dev/local proof is recorded, but #198 review and a separately approved Production release remain. No Production apply is authorized by this PR. | Complete review; exact-version preflight and batches of no more than five; Production postflight for guards, ledger invariants, Advisors, and route state. |
| B2 forward-migration hold | Agent 2 (implementation); Agent 1 (Production promotion); founder/Bachs (account decisions) | Open in its separate lane. The launch-gate plan still requires exact Production versions and ledger/postflight verification. | Finish the B2 migration set in Dev, review exact scope, then separately approve each Production batch and verify its money-path invariants. |
| Production payment-readiness 503 | Agent 1 (Production runtime/release owner) | Open pending a fresh owner check. The last recorded release report observed one `service-health` 503 during deployment and six more in the preceding 30 minutes; this Phase 4 lane has not re-queried Production. | Agent 1 confirms current response and cause, then records a successful intended readiness result with routes still disabled; any code repair must be merged and released from `main`. |
| Historical Production dead jobs | Agent 1 / authorized Production Ops | Open pending a fresh owner check and an authorized Ops operator. The last recorded count was nine `DEAD` jobs (four account-event emails, four SMS jobs, one Ops verification email), five with Ops cases and four without; no active jobs were reported. They were not replayed or closed by this lane. | Recheck counts and relevance in Production; close or replay only through the audited Ops workflow with a reason and terminal outcome. Do not resend stale notifications. |

Other Stage 2 prerequisites remain open as recorded in
[`launch-gates.md`](launch-gates.md):

| Prerequisite | Owner | Current readiness |
| --- | --- | --- |
| Bachs account-country move, ticket `#154675279` | Bachs / founder | Resolved: live and sandbox account countries are NG. The adapter continues to send NG explicitly. Foreign-card acceptance remains a separate unanswered question. |
| Live Bachs key, webhook endpoint, event subscriptions, and rotation record | Founder / Bachs | Not configured; no live credential or request used here. |
| Nigeria tax-policy review | Founder / legal | Pending a recorded policy/effective date and checkout-gate result. |
| Two distinct least-privilege Production Ops approvers with MFA | Founder | Not named or verified. |
| Bachs balance/ledger reconciliation, stuck-transfer watchdog, provider synthetic, dead-letter alert, and deduplicated Slack delivery | Engineering / Ops | Partial; bounded reconciliation and alert-delivery proof remain. |
| NGN withdrawal-fee funding and customer receipt wording | Engineering / Bachs / founder | A configurable ₦100 reserve is under development. The existing staged transfer already funds the connected balance, so the bank-withdrawal workflow must top up only the fee reserve, then book the actual fee and sweep any excess. Bachs can debit a higher fee from other pooled earnings, so an exact account-balance guard is required before a payout; multi-earning accounts still need a reviewed account-level policy. No payout request or top-up was sent. |
| First live Nigerian tailor and payout destination | Founder / tailor | Pending voluntary hosted KYC and provider-confirmed capabilities; sandbox fixtures do not count. |
| Two-person enablement and kill-switch rehearsal | Founder / Ops | Pending two independent fresh-MFA approvals, deny-only checks, audit IDs, and kill-switch proof. |
| 72-hour live observation window | Ops / Engineering | Pending named on-call owners, thresholds, cadence, and rollback/disable criteria. |

#### Stage 1 close-out status at this update

#### 2026-11-23 — Dev private order-media bucket rehearsal

- Dev migration history was repaired using the supported CLI workflow only:
  generated policy markers `20261123171350` and `20261123173009` were marked
  reverted, and the equivalent source markers `20261123190000` and
  `20261123193000` were marked applied. No policy SQL was rerun.
- The isolated `20261123195000_make_order_photos_private` migration then made
  Dev `order-photos` private. Its generated API marker was immediately
  normalized through the same supported history-repair workflow to the source
  version; the bucket SQL ran exactly once.
- Postflight passed: the bucket is private; the authenticated party read and
  upload policies remain present; the database assertion covering the legacy
  brief bridge and receipt/fabric/Vision-QC prefixes passed in a rolled-back
  transaction. A real existing Dev object returned HTTP `400` from the public
  storage endpoint without downloading media.
- Dev payment routes remain two `DISABLED` and one `SANDBOX_ONLY`; zero routes
  are enabled. The remaining proof before any Production proposal is signed
  customer and tailor read coverage through the normal application flows.

- PR #253 was admin-merged at `e9f47d58`; no Production deploy was performed by
  this Phase 4 lane.
- PR #249 remains open at approved head `73c7e174`. Its CI is green, but the
  required exact-head customer web check was not completed: the in-app browser
  could not reach the local #249 server port, the only reachable local server
  was an older checkout, and the Workers Build did not publish a preview URL.
  Do not merge #249 until the requested breakdown is visibly checked on the
  exact head and recorded on the PR.
- The Android API 35 emulator is attached and has `com.drape.app` in the
  foreground, but this session does not expose an Android emulator window to
  the approved UI-control surface. The receiving-tailor screen and its NGN
  109.65 succeeded payment therefore remain unverified; no credentials were
  entered and no UI automation was attempted through ADB.
- PR #245 was rebased onto current `main` (`c4094176`) as head `dfb7b935` after
  the Production Explore release was confirmed merged. CI was pending at this
  update, so request review only after the checks complete green.
- The existing Android Dev customer receipt and local Dev Ops evidence do not
  substitute for the two screen checks above. No route was enabled and the
  scoped Bachs sandbox key was not reused.

#### 2026-11-20 follow-up (supersedes the older build and PR heads above)

- PR #249 is now at `06b1fb3d`; focused receipt tests (33), web/mobile
  typechecks, Node 22 launch contracts, and both PR checks pass. Web order
  detail uses the shared tax and free-fulfillment lines. Its requested visual
  proof with a **new** synthetic customer is still open. A valid paid fixture
  needs a provider-confirmed connected destination; no fake payment or route
  snapshot was written to manufacture the screenshot.
- A Dev Android debug APK built successfully from main `7b75357e`; SHA-256
  `80b9137f8dd35e01519be7fbc4bba68ca179d14152961241c18dfec86147ec47`.
  The native Worklets path issue was repaired only in the temporary build tree.
  The API 35 emulator binary exits with code 132 before boot on this Mac, so
  no new receiving-tailor screen pass is claimed. The temporary worktree and
  build credentials were removed; the APK was retained locally.
- Both Android EAS cloud build requests stopped at the monthly build quota;
  Expo reports a reset on 2026-12-01. Local release AAB generation is blocked
  because `GOOGLE_SERVICES_JSON` is a secret EAS file variable available only
  to Expo's hosted builders. The release variant has minification and resource
  shrinking enabled, but there is no release AAB, build-matched mapping or
  native-symbol upload, or Play internal submission from this attempt. Failed
  attempts advanced the remote Android versionCode to 42 without producing a
  build; the next successful build must report its actual versionCode.
- The payout fee reserve has a separate **draft** PR #273 at `3f310f76`.
  Twenty-seven focused tests pass for its reserve/fee rules and pending payout
  identity handling. It has no withdrawal caller, durable claim, fee ledger,
  sweep reconciler, or sandbox payout proof, and is not ready for review or
  deployment.

#### 2026-11-20 continuation: exact-head receipt and Android runtime

- PR #249 head `626be16a` now selects `orders.tax_region` as well as typing it;
  the shared tax test covers `Nigeria VAT` and a zero-tax line. Dev order
  `b075928d-33db-4be9-a8e5-b5ed4ec74eac` stores `Nigeria VAT`, `750`
  tax minor units, zero fulfillment and `10965` total minor units. The
  34 focused tests, web typecheck, production-mode local build and two PR
  checks passed. The paid order belongs to an older QA customer, while the
  required check uses a new synthetic customer. The current Dev NGN/Bachs
  route is `DISABLED`; no customer visual pass or new paid order is claimed.
- Updated the Android emulator from 37.1.11 to 37.4.1. The API 35 arm64
  emulator boots when launched outside the CPU-restricted command sandbox
  with software graphics. Installed the retained Dev APK built from
  `7b75357e`, served that same source with Metro, and signed in synthetic
  Dev tailor profile `c3278e33-3a3a-40e4-b742-136f9e9844e5` using a
  short-lived Dev Auth magic link that was never saved or logged. The app
  redirected this account to `Finish tailor profile` with four setup items;
  direct order entry returned to the same gate. Its trust status remains
  unapproved. This proves the emulator/app/auth path works, but does not
  prove its receiving-tailor order screen.
- The Bachs sandbox account-creation response remains a definite
  `403 FORBIDDEN`. The client intentionally discards raw provider messages;
  the exact provider message and key-scope cause are unverified. Existing
  synthetic destination `3300fa5b-e261-4e1b-b59e-aa07f40f3e20` remains
  available for a refund/payout proof. A forward migration adds a terminal
  `REJECTED` path for a definite 403, preserving the request key and claim
  history. It passed isolated Postgres apply, duplicate, rollback and reapply
  checks and six focused Deno tests. Dev recorded version `20261120173000`
  after correcting the Supabase tool's generated marker, and claim
  `0ff62189` is now `REJECTED` with no provider account ID. No account create
  was retried and no claim row was deleted. The larger paid Dev order's
  80/20 tranches remain
  `LOCKED`; a normal release and two-person Money Desk approvals must precede
  a valid short-balance recovery proof. No sandbox funds moved in this check.
