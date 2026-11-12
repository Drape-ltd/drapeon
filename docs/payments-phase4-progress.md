# Phase 4 Bachs NGN live-readiness progress

This log records evidence for Phase 4. It is not authority to move money or
enable a route. Production writes, deployments, secrets, route rows,
enablement, and merges remain separately approved release units.

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

