# Phase 4 Bachs NGN live-readiness progress

This log records evidence for Phase 4. It is not authority to move money or
enable a route. Production writes, deployments, secrets, route rows,
enablement, and merges remain separately approved release units.

## Stage 2 — live prerequisites (prepared; no live calls)

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
- Bachs Compliance still needs to change the live platform account country
  from US to NG. Drapeon nevertheless always sends explicit `country=NG` for
  Nigerian bank discovery/resolution; it never relies on the account default.
- Latest written status in support ticket `#154675279` (2026-11-12): Bachs has
  passed the requested live and sandbox country changes to its internal team,
  will report whether it needs anything else, and explicitly instructed Drapeon
  to keep sending `country: "NG"` meanwhile. The ticket remains in progress.

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

- Prepared `20261112200000_phase4_seed_disabled_bachs_ngn_route.sql` and its
  scoped rollback. It creates only route `ng-ngn-ngn-bachs` version 1 with
  provider Bachs, NGN charge/payout, Drape Marketplace Limited, platform fee
  collector, fee schedule `ngn-card-provider-cost-2pct-v1`, no confirmed
  foreign issuer countries and status `DISABLED`.
- The migration is idempotent only for the exact immutable row and fails on any
  conflicting pre-existing route. Its rollback refuses to remove a route with
  snapshots or approval evidence. It has not been applied to Dev or Production.
- Local disposable-Postgres rehearsal passed: first apply created one exact
  route and one audit event; second apply was a no-op; rollback removed the
  unused route and left its guard enabled; reapply succeeded. Shared Dev and
  Production were not touched.
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

