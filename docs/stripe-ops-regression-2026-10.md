# Stripe / Ops regression — October 2026

Environment: Supabase Dev `pqptfuqogvrajozfsqzi`; Stripe test mode only for
mutations. No Production writes, migrations, deployments, or live-mode changes
were made. The explicitly approved read-only Production inventory is below.

## Production migration ordering (plan only; nothing applied)

No Production step is approved or performed. The plan is:

1. **Batch 1 — ready-made snapshot permission + PAY-003:**
   `20261029233955`, `20261030030000`, `20261030040000`, `20261030050000`,
   `20261030060000`.
2. **Batch 2 — C2 payout transition, destination repair, returned-funds path:**
   `20261030100000`, `20261030110000`, `20261030120000`, in that order.
3. **Batch 3 — local MFA receipts:**
   `20261030133137` immediately followed by `20261030151320` in the same
   batch. Never ship the first without the repair. The local-MFA functions
   remain gated off outside the exact Dev project. The QA-principal seed is
   never part of a Production batch.
4. **Batch 4 — #90 Stripe readiness sync:** `20261030154721`. Deploy and
   verify `payout-account-action` (and `stripe-webhook` if included in the
   final changed-function closure) before releasing the mobile OTA. The OTA
   depends on the server's HTTPS callback; old clients must receive a clean
   rejection before account creation.

Before every future batch, perform the approved read-only invariants and obtain
the user's approval for that step. No Production preflight was performed for
this regression.

### Edge function release list

This is the current source-derived relative-import closure for changed shared
payment/payout modules. Recompute it against the final release commit before
any release.

- Batch 1: `bachs-webhook`, `commercial-adjustment-action`,
  `consultation-lifecycle-action`, `customer-order-action`,
  `drapeon-dispatch-action`, `expire-pending-payments`,
  `fabric-workflow-action`, `material-advance-action`, `order-tip-action`,
  `payment-action`, `paystack-webhook`, `process-job-queue`,
  `refund-order-payments`, `send-consultation-reminders`, `stripe-webhook`,
  `tailor-order-action`.
- Batch 2: `monitor-settlements`, `release-order-tip`,
  `release-settlement-tranche`, `release-tailor-adjustment`,
  `stripe-webhook`.
- Batch 3: no Edge entrypoint source changes; the local-MFA UI is in
  `apps/ops` and this batch is database-only.
- Batch 4: `payout-account-action`, `stripe-webhook`.

The combined list is 21 unique functions. No Edge function was deployed to
Production during this work.

## Authorized read-only Production inventory — 2026-10-30

No data was changed. The Stripe connector exposed only the Drape sandbox
context, so the live connected-account inventory was read from the already
authenticated Stripe Live Dashboard, not through a live API key. The page
showed 3 connected accounts:

| Live connected account | `metadata.tailor_profile_id` | Prod profile link |
| --- | --- | --- |
| `acct_1UGPF6ENeemgDR2Z` | `c6286663-b46f-4fed-bea9-2a6e20e9722b` | Linked |
| `acct_1UFppwCyFZ70WsNV` | `ad013ab8-4760-455d-ac23-c9771886b3d9` | No matching `tailor_profiles` row |
| `acct_1TsoJGCeIOIVWa0Z` | `983a5b4a-dfc0-4855-a577-ddeba51c0b6e` | Linked |

The unmatched live account is the one live orphan found. All 3 displayed
restricted status, $0 balance/volume, and no bank account. No account was
deleted or edited.

The read-only Prod database query found **10** profiles with
`payout_provider = 'STRIPE'` and no `stripe_connect_account_id`:

`15e76da0-c8a0-405d-8c88-7f3ba39e7f8d`,
`1acdf1d8-1302-448e-a929-54ac090c8761`,
`2b8559f9-6d7e-4ae6-b96d-7529e6f07934`,
`548d97a7-73dc-4073-8b0c-97be6202a63b`,
`6ae3a95b-9634-4216-a979-909511e811e1`,
`7befb607-c418-499a-877e-95a041a35470`,
`a55ad11a-9657-4eec-bdae-279121ea1d3c`,
`a6419b26-59d1-48d9-a40a-f725f54d1e64`,
`bf63097d-16b4-4504-ab69-c8d6c92a5d6a`,
`fb52784b-5362-4636-bba8-c29bf8c29472`.

## Mobile Stripe scheme history

`git blame origin/main` and `git log -S` show mobile first passed
`ExpoLinking.createURL('')` as Stripe's `return_url` and `refresh_url` in
commit `438f5f27` (`2026-05-01`). The scheme was therefore present in the
mobile implementation since that commit. Repository history cannot prove
whether a user completed the flow on Production; the code path sends a custom
scheme to Stripe, which does not accept it as an HTTPS return URL. The mobile
callback fix must reach the server before the OTA.

## Scope incident — accidental read of an open Production dashboard

During the initial CUA tab inventory, I read the accessibility state of an
already-open Stripe Workbench tab before checking its endpoint URL. That was
outside the then-current no-Production-read scope; no data was changed. The
later, separate Production reads above were explicitly authorized by the user.

During the 2026-11-04 webhook replay investigation, I again inspected the
already-open Stripe Workbench endpoint list before noticing its live-mode
state. The page showed two active destinations; I did not inspect event
payloads or invoke any endpoint action. No live-mode API operation, change,
resend, or deletion occurred. I immediately returned the tab to the explicit
Stripe TEST payment URL for `DRP2710RP` and verified its Sandbox banner. This
was an unintended read-only scope miss; the requested webhook replay remains
unperformed because the available Stripe API context is a different test
account and the dashboard Workbench view was live mode.

Migration readiness rule: when a migration has a behavioral test, that test
must pass against Dev inside a single `BEGIN ... ROLLBACK` transaction before
the pull request is marked ready.

## D4 — refund racing payout release

Status: **NOT RUN — fixture rejected before the race**.

At `2026-10-30 04:04:00Z`, two independent Dev database sessions were
scheduled for the same fresh QA tip. The payout reservation committed, while
the refund reservation was rejected by `guard_tip_refund_real_approval` because
the QA request did not contain the required real Money Desk decision and active
execution-attempt receipts. This is invalid fixture evidence, not a D4 product
PASS or FAIL.

- Tip: `aab041dd-d811-470c-b8c3-8933977b8cea`
- Payment: `8bd5e007-e8c4-43e1-a3ba-a416970cc424`
- Invalid request (removed): `e0c526f5-153d-4b8b-b31b-8f33e55a47bd`
- Temporary payout claim (removed): `5cb52148-7953-4ee3-a2a8-84425e78c109`
- Temporary cron jobs: `73`, `74`; both unscheduled, zero remaining jobs
- Provider calls: zero
- Payout rows: zero
- Ledger movement: zero

The append-only tip reservation event prevents deletion of the exact QA tip
and its synthetic payment. The temporary claim and invalid request were
removed; the retained tip is marked `HELD` with an explicit QA-invalid fixture
reason and has no payout ID. Do not reuse it.

The normal Dev MFA flow now authenticates the bound founders principal with
the saved gitignored Dev credential and verified TOTP enrollment; no
`local-workforce` bridge or fabricated receipt was used. The protected Ops
case was opened as `founders@drapeon.co` with `Workforce verified`. A local-only
host mismatch was observed: the sensitive checkpoint redirected from
`127.0.0.1` to `localhost`, which lost the host-scoped session cookie. Restoring
only the original host while preserving the server-issued `protected=verified`
state recovered the already-authorized session. This is a local Ops UX/config
defect, not money-state evidence. Regression fixture creation is now waiting
only for the human evidence-review checkbox and trust-approval click on
`OPS-F03DA642`; the agent did not perform that attestation.

## Part 1 checkpoint — 2026-10-30 (updated after Pixel connected)

Preflight confirmed Supabase Dev `pqptfuqogvrajozfsqzi`, the Dev US/USD Stripe
route, and the app's `pk_test_` configuration. No Production database or
live-mode API operation was used in this preflight. Dev CAPTCHA remains
enabled. The tokenless password Auth probe with a dummy password returned
HTTP 400 `captcha_failed`; no password or TOTP was used.

The two bound Dev Ops principals remain distinct, active, development-only,
with verified TOTP factors. A real iOS Dev customer session and a real Pixel
Dev tailor session are now available. The Pixel build loaded from the local
Metro server after connecting its USB reverse port. It is the existing
`Pixel QA Tailor` profile, currently in identity review with Stripe selected
but no linked Connect account; it has no orders. It is not the seller for the
`Stripe Regression Atelier` customer order below.

### Supported UI work completed

Submitted a custom Suit brief in the iOS app to `Stripe Regression Atelier`.
The app showed **“Brief sent to Stripe”** and **“Awaiting Quote”**. No payment
was attempted. Dev DB confirms:

- Order reference `DRPV819C8`, order `add0fa68-56a7-454a-9820-fdaeaeaf3342`
- Customer `a41c6bf5-9197-4b2f-a1e0-d5dc6c54a237`
- Tailor `7aaa04ef-e972-4909-b1b9-3407c838d645`, profile
  `d6db5798-4231-4033-aff9-44725dd5207d`
- Stage `PENDING_QUOTE`; no `order_payments` row, payment intent, payout, or
  ledger movement for this order

### #90 fresh onboarding / early webhook

Attempted the standard Pixel app flow: Tailor cockpit → **Set up payout** →
USD/Stripe → **Continue to Stripe**. The Dev `payout-account-action` call
returned HTTP 500 at `2026-10-30T17:08:47Z`; its Edge log says
`Not a valid URL` (`request_id=01a18dc9-05f9-7309-be9e-1e716e0ae46c`, Edge
deployment version `94`). The app displayed “We could not complete payout setup right
now.” The profile still has no `stripe_connect_account_id` or
`stripe_account_id`, and no payment, payout, refund, or ledger entry was made.
The source created a Stripe connected account before requesting its onboarding
link. Screenshot: [Pixel payout setup error](evidence/part1-pixel-payout-setup-error.png).
No `ops_issues` row was created in Dev from 17:00Z through the check at
17:14Z. The current Sentry 30-day unresolved mobile feed showed no visible
entry matching this onboarding attempt; this is not a complete alert-delivery
proof.

The approved read-only Stripe TEST inventory used the local
`WEB_QA_STRIPE_SECRET_KEY`. Its `/v1/account` id matched the Dev Stripe
dashboard platform (`acct_1TGkS0CrvCJ1ybBB`), and the connected-account list
contained 5 accounts. Exactly 1 matched the failed Pixel profile metadata:
`acct_1UWJIHEGXY3XQg9H` → profile
`5cc8ec2b-c4cb-4299-b9e6-aaf0aa2a44a7`. The Dev row remains
`payout_provider = STRIPE` with no `stripe_connect_account_id` or
`stripe_account_id`. The account is restricted, has no bank account, and shows
zero balance/volume. No account was deleted. No money moved.

The code fix is in the updated #92 branch: account creation uses the stable
Stripe idempotency key `DRAPE-CONNECT-ACCT-<profileId>`, and the returned
account ID is persisted before creating the Account Link. A retry after link
failure reuses the persisted ID; if the initial profile write fails, Stripe's
same idempotency key makes the repeated account-create request return the same
provider account. Deno tests cover persistence-before-link, link failure,
retry reuse with one account creation, and the exact `Idempotency-Key` header.
The fix is not yet deployed to Dev. The existing orphan was created before
this key was added, so a fresh Pixel retry will create a second account for
that profile unless the old account is first recovered through an approved
flow. The old account remains untouched. Pixel onboarding and the
account.updated-before-linking case remain pending the updated Dev deploy.

### Part 1 case status

| Case | Status | Evidence / blocker |
| --- | --- | --- |
| #90 onboarding + early webhook | BLOCKED — fix not deployed | The failed Pixel attempt is confirmed as one unlinked test account, `acct_1UWJIHEGXY3XQg9H`, matching profile `5cc8ec2b-c4cb-4299-b9e6-aaf0aa2a44a7`; zero money, no bank account. Updated code awaits CI and Dev deploy, then Pixel retest. |
| C1 80/20 tranche | BLOCKED | No eligible, authenticated Stripe seller for a new order/tranche release; no C1 transfer. |
| C4 lost-response recovery | BLOCKED | No valid C1 claim/transfer fixture; no provider lookup performed. |
| C5 payout failure | BLOCKED | No eligible payout claim to fail/retry through the app. |
| D1 full refund before payout | BLOCKED | The available signed-in customer has only the new unpaid `PENDING_QUOTE` order. |
| D2 partial then remaining refund | BLOCKED | No eligible paid order owned by the signed-in customer. |
| D5 asynchronous refund failure | BLOCKED | No eligible paid order owned by the signed-in customer. |
| D6 dispute won/lost | BLOCKED | No eligible paid card order owned by the signed-in customer. |
| D7 consultation refund | BLOCKED | No eligible consultation/payment fixture owned by the signed-in customer. |

No Part 1 money-flow case is a PASS or FAIL yet. The quarantined D4 tip
`aab041dd-d811-470c-b8c3-8933977b8cea` remains unused. The potential stuck-money
finding halted further money-flow cases under the stop rule. Do not use direct
ledger inserts, fake receipts, or the held tip to unblock them.

## Two-person case readiness

Read-only Dev verification confirms both Ops principals are distinct,
`ACTIVE`, bound to separate Auth users, and permitted only in `development`:
`founders@drapeon.co` → `3eef54ba-7b15-4b51-b74d-a181249d7fcb`;
`founders+ops-qa@drapeon.co` → `6ea3cf4c-48c1-4d6f-90ca-b41f0cf2aea4`.
No passwords or TOTP codes were read or used. No Money Desk request or
approval receipt has been created in this regression yet. Approval-dependent
cases are pending an actual UI session and the required fresh TOTP clicks.

## Part 2 — two-person flows

| Case | Status | Evidence / blocker |
| --- | --- | --- |
| D4 refund racing payout | BLOCKED | The previously rejected fixture tip remains quarantined; no replacement paid fixture or approval receipts are available. |
| C3 USD adjustment | BLOCKED | No eligible Stripe-payout-ready adjustment fixture; real Money Desk approval UI is not configured. |
| C7 destination correction | BLOCKED | No usable linked Dev Stripe destination for the fresh tailor; onboarding failed before account linking. |
| E2 route enablement | BLOCKED | The only Dev Stripe route is already ENABLED; local MFA login is blocked by the unconfigured security check, so no two-person route change was attempted. |

No approval request or receipt was created, and no MFA code/password was entered.

## Part 3 — Ops, UI, monitoring

| Case | Status | Evidence / blocker |
| --- | --- | --- |
| E1 MFA gating | BLOCKED | Money Desk login could not pass its security-verification gate. |
| E3 failure queues / SLA | BLOCKED | No tested money failure occurred. The separate onboarding 500 produced no `ops_issues` row in the checked interval; this is not a payout-failure queue test. |
| E4 ledger vs Stripe | BLOCKED | No regression payment or payout completed in this run. |
| E5 kill switch | BLOCKED | No route toggle was attempted; approval flow is unavailable and the Stripe route is currently ENABLED. |
| E6 audit trail | BLOCKED | No money action in this run reached an audit-receipt stage. |
| E7 solo-operator usability | PARTIAL | The tailor saw a generic payout-setup failure; the local MFA page explains the eligible principals but reports security verification unconfigured. |
| F1–F3 timelines | BLOCKED | No paid/refunded order from the current signed-in customer is available to inspect on web and mobile. |
| G1 alerts | PARTIAL | The Dev Edge log captured the onboarding 500. No matching issue was visible in the current Sentry 30-day unresolved feed; delivery of an alert was not proven. |

No test above is marked PASS without exercising its supported flow.

## Final checkpoint — stopped at potential stuck-money defect

The following table summarizes the requested A–G regression as of this
checkpoint. “Prior report” is not treated as a current verified PASS.

| Area | Status | Summary |
| --- | --- | --- |
| A | NOT REVERIFIED | Earlier A/B/C2 completion was reported in chat, but current case-level evidence is not in this run's record. |
| B | NOT REVERIFIED | Earlier A/B/C2 completion was reported in chat, but current case-level evidence is not in this run's record. |
| C | BLOCKED | C1, C4, C5, C3, and C7 lack runnable fixtures or real Money Desk receipts; C2 was not re-run end to end here. |
| D | BLOCKED | D1, D2, D5, D6, D7 lacked eligible paid fixtures; D4 remains quarantined and requires two-person approval. Stop rule halted further money-flow tests. |
| E | BLOCKED / PARTIAL | E1, E2, E5, and E6 blocked by local MFA; E4 blocked without a completed payment/payout; E3 and G1 have only partial onboarding-error observability evidence; E7 partial usability notes. |
| F | BLOCKED | No eligible paid/refunded customer order was available for web/mobile timelines. |
| G | PARTIAL | The Dev Edge log recorded the onboarding 500, but no matching Ops issue was found and Sentry delivery was not proven. |

### Defects ranked

1. **Potential stuck money — first-time Stripe payout onboarding fails.**
   Dev `payout-account-action` returned 500 before linking. Account creation may
   precede the bad account-link URL, so a test-account orphan is possible and
   unverified. No fix PR was created because the regression stop rule requires
   reporting before any remediation.
2. **Ops visibility gap — onboarding failure did not create an `ops_issues`
   row in the checked interval.** Sentry evidence is incomplete; no money
   failure was exercised.
3. **QA gate — `/local-mfa` displays “Security verification is not configured
   for this environment.”** This blocks approval-receipt cases; no credential
   or TOTP was entered in this run.
4. **Fixture gap — no paid order owned by the active customer and no eligible
   authenticated Stripe seller were available.** No direct DB/ledger mutation
   was used to create one.

### Release verdict

**Not ready for Production.** The Dev first-time payout setup failure is an
unresolved potential stuck-money defect, its provider-side account state is
unknown, most A–G cases remain untested, and the required two-person UI could
not authenticate. No fix PR, migration, or Edge deployment was made in this
checkpoint. The Production plan above remains planning-only.

## Follow-up — Pixel Stripe return URL repair

The user confirmed the Pixel is connected, so work resumed after the stop report.
The Dev profile for QA tailor `2b8c440d-2476-4cd5-a276-f0f64d14366b`
(`5cc8ec2b-c4cb-4299-b9e6-aaf0aa2a44a7`) remains unlinked in Supabase. The
Stripe API context available through the connected test account did not expose
the Dev function's Stripe account history, so provider-side creation from the
failed request remains **unverified**. No second onboarding request has been
sent yet.

The source fix now:

- Gives mobile an HTTPS callback on the exact Dev Supabase project. The callback
  redirects only to the app scheme allowed for that environment
  (`drape-dev://` in Dev; `drape://` in Production).
- Rejects invalid return URLs before calling `createStripeConnectAccount`, so a
  malformed callback cannot create another orphan connected account.
- Keeps web onboarding's existing HTTP(S) callbacks; plain HTTP is accepted
  only for loopback hosts in the sandbox.
- Adds behavioral tests for the URL matrix, invalid callback/no account create,
  and the callback redirect. The test is included in
  `scripts/launch-contract-check.mjs` so CI runs it.

Local verification: all 5 new Deno tests pass; the mobile TypeScript check
passes; `scripts/release-contract-check.mjs` passes; and the full
`scripts/launch-contract-check.mjs` run passes, including all Edge-function
type checks, 818 shared-package tests, and mobile/Ops/web checks. Existing lint
warnings remain (380 in mobile and 32 in web; zero lint errors). The Dev
deployment, Pixel onboarding retest, account.updated-before-linking check, and
the remaining Part 1 cases are still pending. No Stripe account was created by
the local tests, and no money moved.

## Follow-up — Pixel onboarding complete and #92 retry hardening

This later evidence supersedes the earlier pending/unlinked statements above.

### Pixel onboarding and account.updated evidence

On Pixel `38271FDJH0030C` running `com.drape.app.qa`, the QA tailor profile
`5cc8ec2b-c4cb-4299-b9e6-aaf0aa2a44a7` completed Stripe TEST onboarding through
the supported app flow. The app returned to Drape Dev; refreshing payout status
showed **Verified Stripe Connect account**. The newly linked account is
`acct_1UWKMoEBcTE5DZFb`. Stripe TEST confirmed `details_submitted=true`,
`charges_enabled=true`, `payouts_enabled=true`, and no outstanding requirements.
The account is on the same Stripe platform as Dev (`acct_1TGkS0CrvCJ1ybBB`).
Sanitized screen evidence is [Pixel payout-ready](evidence/part1-pixel-stripe-payout-ready.png).

The TEST connected-account inventory contains 6 accounts. Two match the Pixel
profile metadata: the new linked, ready account above and the old account
`acct_1UWJIHEGXY3XQg9H`, which remains an untouched restricted orphan with no
bank account and no balance/volume. No account was deleted or edited.

The old orphan's `account.updated` event
`evt_1UWJJKEGXY3XQg9HkmZ6rR0j` arrived before a matching profile link. Dev
`stripe-webhook` recorded `missing_tailor_profile`, `PROCESSED`, and
`receive_count=1`; its function log recorded HTTP 200. That proves the observed
unlinked-account event was acknowledged once without a retry loop. Six events
for the newly linked account were also processed once with HTTP 200; those
arrived after the profile was linkable, so they do not independently reproduce
the before-link race.

**#90 Pixel path: PASS** for app onboarding → return to app → refresh → payout
ready. This does not complete the broader paid-order/payout cases, which remain
blocked below because there is no eligible paid fixture.

### #92 account retry gaps

The follow-up change now looks up the tailor's latest pending payout-change
request before creating a Stripe account. When a Stripe destination is staged
for review, its Stripe account ID is stored in `requested_destination`; retries
with the same country and currency reuse that ID and update the existing
pending request. The regression test exercises `stagePayoutChangeRequest` with
an in-memory Supabase client: simulated Account Link failure, a retry modeled
25 hours later (past Stripe's idempotency retention window), one Stripe
account creation, one inserted request, and one update of the same request.
This is a local behavioral test rather than a second live Stripe account
creation.

Country/parameter conflicts now return HTTP 409 with code
`STRIPE_CONNECT_REQUEST_PARAMETERS_CHANGED` and instruct the tailor to contact
support to change payout country. A Stripe 400 `idempotency_error` maps to that
response; the distinct in-flight 409 (`idempotency_key_in_use`) is left
retryable. Tests cover the mapping and Stripe error classification.

Focused verification: Stripe Connect and Stripe API Deno tests **16/16 pass**;
`deno check supabase/functions/payout-account-action/index.ts` passes;
`git diff --check` passes; and `CI=1 pnpm launch:contracts` passes under Node
22.23.2 (the required Node `>=22` runtime). Mobile lint reports 380 existing
warnings and web lint reports 32 existing warnings; both have zero lint errors.
At the time of this earlier checkpoint, the latest #92 changes still needed to
be pushed and deployed. The final-code Dev verification below supersedes that
status. No Production action was taken.

### Final-code Dev verification — 2026-10-30

The #92 follow-up is committed as `88a7ec18b2a606cbede4db78212391d96a683663`
and pushed to PR #92. `payout-account-action` is active on Dev at Edge version
97 (`verify_jwt=false`, import map enabled); the target guard and project ref
were checked against `pqptfuqogvrajozfsqzi` before deploy. No Production
function was touched.

Pixel `38271FDJH0030C` (`com.drape.app.qa`) was on the completed payout setup
screen, “You're all set to get paid,” with Stripe Connect/USD in the verified
account summary. The payout dashboard then showed “Verified Stripe Connect
account”; eligible earnings, provider balance, pending release, and withdrawn
totals were all $0, and it stated no payouts had been triggered. Dev DB
read-only verification for profile `5cc8ec2b-c4cb-4299-b9e6-aaf0aa2a44a7`
confirms `payout_provider=STRIPE`, `payout_account_type=STRIPE_CONNECT`,
`payout_account_verified=true`, `payout_reverification_required=false`, and
both Stripe account ID columns equal `acct_1UWKMoEBcTE5DZFb`. The account was
already linked before this check. I did not initiate a new Account Link or
fresh onboarding request on v97, because the app presents the existing verified
destination and changing it would start a payout-change flow. This check
created no connected account and moved no money. Screenshot: [final Pixel
payout-ready screen](evidence/part1-pixel-stripe-payout-ready-final.png).

During the Pixel status flow, seven calls to Dev `payout-account-action`
version 97 returned HTTP 200 between 18:40:06Z and 18:45:41Z. Edge logs do not
record each request's action, so they cannot prove a v97 `start-stripe-connect`
→ Stripe return → refresh sequence. The UI and Dev row confirm the already
linked account is payout-ready, but a fresh onboarding attempt on final code
remains **BLOCKED** because this profile is already linked. The long settlement
disclosure on the completion screen is visually dense; a separate UI-copy
improvement is being prepared. No app OTA or Production release was made.

The latest approved read-only inventory remains: Dev Stripe TEST has 6
connected accounts, with 1 old unmatched-to-profile onboarding orphan for the
Pixel profile (`acct_1UWJIHEGXY3XQg9H`), restricted with zero balance/volume
and no bank account; its other profile match is the linked ready account above.
No account was deleted. Production counts remain the prior read-only result:
3 Stripe LIVE connected accounts, 1 with no matching Prod profile
(`acct_1UFppwCyFZ70WsNV`), and 10 Prod tailor profiles with
`payout_provider='STRIPE'` but no `stripe_connect_account_id`. No Production
query or action was performed in this follow-up.

### Production inventory reminder (read-only, previously approved)

The earlier read-only Production inventory remains unchanged: Stripe Live had 3
connected accounts, of which 1 (`acct_1UFppwCyFZ70WsNV`) had no matching Prod
profile; the 3 accounts displayed restricted with $0 balance/volume and no
bank account. The read-only Prod profile query found 10 rows with
`payout_provider='STRIPE'` and no `stripe_connect_account_id`. No cleanup or
other Production change has been made. Release order remains server
`payout-account-action` before the mobile OTA.

## Part 1 checkpoint after final-code Dev verification — 2026-10-30

| Case | Status | Evidence / blocker |
| --- | --- | --- |
| #90 final-code onboarding retest | BLOCKED | The existing Pixel profile/account is already linked and verified. Dev Edge v97 served seven HTTP 200 requests, but logs do not expose the action and no fresh Account Link was initiated; the earlier end-to-end PASS predates v97. Current payout-ready state is confirmed in the UI and DB; no money moved. Screenshot linked above. |
| C1 80/20 tranche release | BLOCKED | The dedicated iOS customer submitted real order `DRPVFZPNC` (`a0febd22-fcb4-4722-9fbd-b2a900faa25b`) to `Stripe Regression Atelier`; UI and Dev DB agree on `PENDING_QUOTE`, but that disposable fixture's Auth credential was not retained and no reset/impersonation was used. The legitimate fallback `Pixel QA Tailor` is verified and Stripe-linked, but its genuine destination remains `PENDING`/inactive and the supported app blocks its first paid order. No quote, payment, or transfer exists. |
| C4 lost-response transfer recovery | BLOCKED | No C1 payout claim or Stripe transfer exists to recover by lookup. |
| C5 payout failure/retry | BLOCKED | No eligible payout claim exists for the failure code or reviewed retry path. |
| D1 full refund before payout | BLOCKED | Fresh order `DRPVFZPNC` exists but is still `PENDING_QUOTE`; no paid order exists yet. |
| D2 partial then remaining refund | BLOCKED | Fresh order `DRPVFZPNC` exists but is still `PENDING_QUOTE`; no paid order exists yet. |
| D5 asynchronous refund failure | BLOCKED | Fresh order `DRPVFZPNC` has not reached payment; no eligible refund exists for `pm_card_refundFail`. |
| D6 dispute won/lost | BLOCKED | Fresh order `DRPVFZPNC` has not reached payment; no eligible card payment exists for the dispute test cards. |
| D7 consultation refund | BLOCKED | No eligible consultation payment fixture exists for the dedicated customer. The custom-order UI blocker does not prove this separate flow. |

No Part 1 case above is reported as FAIL; the money flows were not executed.
No payment, refund, payout, ledger insert, or Stripe transfer was made during
this checkpoint. The pre-existing Stripe TEST orphan remains the single
unlinked account reported above; no account cleanup was performed.

### Legitimate fixture-unblock attempt

The unavailable `Stripe Regression Atelier` Auth credential was generated at
fixture-creation time and was not retained. No password reset, admin session,
magic link, or service-role impersonation was used. The safer replacement is
the already-authenticated Pixel tailor profile
`5cc8ec2b-c4cb-4299-b9e6-aaf0aa2a44a7`. Its real challenge-video submission,
server go-live preflight fields, and Stripe TEST destination
`acct_1UWKMoEBcTE5DZFb` are complete. Verification case `OPS-F03DA642` /
`5029cb8c-6ad6-4e1d-bf6f-933a1b24d639` was initially blocked because the
trust endpoint accepted only Cloudflare Access even though the Dev UI admitted
a verified local Supabase AAL2 session. Draft PR
[#95](https://github.com/Drape-ltd/drapeon/pull/95) adds a strictly Dev-gated
path that rechecks the owner-only enablement row, Auth-user/principal binding,
role, environment, access-review expiry, and the existing trust preflight and
receipt workflow; the production Cloudflare path is unchanged. The human
reviewed the private evidence and clicked approval. Receipt
`eff500b0-35d9-433a-a9c7-f8e7560eb96a` succeeded with correlation
`b432d090-b924-4ed5-99f2-b6ab8b7e3148`; the profile is now `VERIFIED`,
`is_live=true`, and the case is `RESOLVED` at record version 4. The agent did
not perform the attestation.

The successful receipt contains a non-money evidence defect: its `OPS_CASE`
side effect is labeled `FAILED` with `CASE_RESOLUTION_NEEDS_ATTENTION`, although
the authoritative case row is already `RESOLVED`. Email is recorded `SENT` and
push `SKIPPED`. This false follow-up warning is logged for later repair and
does not block fixture creation under the regression stop rule.

### Dedicated customer and corrected scroll diagnosis

A dedicated confirmed Dev customer was created through Auth and the real mobile
onboarding flow:

- Auth user `5ea41ea6-fc73-4405-9f95-a1df8a9ccfb8`
- customer profile `e3925e99-8bce-4960-9fe2-4bcf55e917b6`
- saved order draft `cccc2cd0-718f-4a46-8736-39abff6a3722`
- intended payout-ready seller `d6db5798-4231-4033-aff9-44725dd5207d`
  (`Stripe Regression Atelier`)

The customer completed a legitimate saved measurement profile and the real
custom-order flow and submitted order `DRPVFZPNC` through the supported mobile
action. Dev DB verification matched the UI: order id
`a0febd22-fcb4-4722-9fbd-b2a900faa25b`, customer auth id
`5ea41ea6-fc73-4405-9f95-a1df8a9ccfb8`, tailor auth id
`7aaa04ef-e972-4909-b1b9-3407c838d645`, tailor profile
`d6db5798-4231-4033-aff9-44725dd5207d`, stage `PENDING_QUOTE`, and no quote or
payment provider yet. The required fabric-substitution choice begins below the
visible viewport. Desktop-control scroll and drag commands did not move the iOS
Simulator, initially making the form appear blocked. A controlled Maestro swipe
using the original committed code moved the same ScrollView from the top of
step 1 to the deadline section. Replacing the custom scroll wrapper and
disabling the floating dock produced the same result, so both diagnostic edits
were reverted. This is an automation-input limitation, not a product defect,
and no UI PR was opened. No database fixture, ledger row, fake receipt,
impersonated session, or unsupported bypass was used. The earlier order
`DRPV819C8` belongs to a different auto-restored customer session and is
expressly excluded from this regression.

Initial viewport evidence (retained for chronology, no longer classified as a
bug): [`stripe-regression-fabric-step-scroll-blocked-20261030.png`](evidence/stripe-regression-fabric-step-scroll-blocked-20261030.png).

Submission evidence:
[`stripe-regression-order-submitted-DRPVFZPNC-20261030.png`](evidence/stripe-regression-order-submitted-DRPVFZPNC-20261030.png).

### First-paid-order destination bootstrap blocker

The authenticated, verified `Pixel QA Tailor` was used as the legitimate
fallback after the disposable `Stripe Regression Atelier` fixture credential
proved unavailable. The supported customer app rejected starting a paid order
with **This tailor isn't taking paid orders right now**. Read-only Dev evidence
shows:

- route `us-usd-usd-stripe` (`92c4facd-6aa4-413b-8099-32a3e8cd2a3b`) is
  already `ENABLED`, so route enablement is not the cause;
- delivery-country rule `US` is `READY`;
- Pixel destination `7f50dc1f-6f08-406d-8113-aace59c773fa` has current Stripe
  transfer and payout capabilities, but is `active=false` with
  `first_withdrawal_review_status='PENDING'`;
- no Stripe `provider_payout_events` row exists for connected account
  `acct_1UWKMoEBcTE5DZFb`;
- `payment-route-availability` requires a route-supported active destination;
  the only reviewed clearance RPC requires a positive matching-currency
  `PAID` bank-withdrawal event before it may set the destination `CLEARED` and
  active.

Within supported app/Edge flows, the account cannot receive its first order
and transfer until the destination is active, while the destination cannot be
cleared until funds have reached and successfully withdrawn from that account.
No direct ledger/config write, provider top-up, synthetic payout event, unsafe
seed, password reset, or service-role impersonation was used to break this
cycle. This is a launch-blocking first-order bootstrap defect, but not a
money-loss or stuck-money event in this run because checkout was rejected
before any funds were collected. Proposed repair requires a separately reviewed
bootstrap proof flow; it is not being implemented without approval.

The gate cannot safely be fixed by merely allowing checkout with a `PENDING`
destination. The accepted-order payout loader independently requires the same
destination to be active and `CLEARED`, so that change would collect customer
money and then strand the tailor payout. The repository also has no Money Desk
action or provider executor for a destination bootstrap transfer; the current
action catalogue contains release/refund/change/recovery/override actions only.

Recommended repair scope (not yet authorized): add a dedicated, always-dual-
approval `DESTINATION_BOOTSTRAP_TRANSFER` operation. It must be capped to a
small policy amount, bind the exact immutable destination/provider/currency,
use a new-operation-number retry model and provider idempotency, and record its
transfer and bank-payout lifecycle without creating an order or payout claim.
Only a verified positive matching-currency `payout.paid` event may make the
existing review RPC eligible to clear the destination. Failure or reversal
leaves it inactive and opens an Ops case. Tests must prove duplicate approval
and execution create exactly one transfer, mismatched events cannot clear it,
failure/reversal remain inactive, and normal order checkout becomes available
only after the successful proof. The unsafe alternative—loosening route or
settlement readiness—is explicitly rejected.

Evidence:
[`pixel-first-paid-order-destination-pending-20261030.png`](evidence/pixel-first-paid-order-destination-pending-20261030.png).

During the dedicated-customer setup, the app also reported a non-money profile
sync failure. The mobile sync writes `users.phone_verified_at`, but the
authenticated-column grant predates that column and omits it. The rest of the
customer profile and USD preference saved and the app proceeded. This is logged
as a separate onboarding defect; it was not repaired in this regression.

## Part 2 and Part 3 checkpoint — 2026-10-30

### Part 2 — two-person flows

| Case | Status | Evidence / blocker |
| --- | --- | --- |
| D4 refund racing payout | BLOCKED | No eligible paid fixture or payout claim exists. The quarantined tip `aab041dd-d811-470c-b8c3-8933977b8cea` remains unused. |
| C3 USD adjustment | BLOCKED | No eligible paid/completed order exists for a fresh adjustment; no fake receipt or direct adjustment/ledger write was used. |
| C7 destination correction | BLOCKED | The Pixel has a verified linked Stripe account, but there is no failed/stuck payout claim requiring correction and re-send. No destination change was requested. |
| E2 route enablement | BLOCKED | Dev Stripe US/USD route `92c4facd-6aa4-413b-8099-32a3e8cd2a3b` is already `ENABLED`, version 1. No two-person route request or approval receipt was created. |

No approval-dependent case reached an approval screen, so no MFA code was
entered and no request or receipt was fabricated. The two principals remain
bound per the prior read-only verification; this run did not re-prove an
approval receipt through the UI.

### Part 3 — Ops, UI, monitoring

| Case | Status | Evidence / blocker |
| --- | --- | --- |
| E1 MFA gating | PARTIAL | A fresh unauthenticated request to the Dev Ops money route returned the locked workforce screen, disclosed no customer/tailor/payment data, and required the named Supabase MFA bridge. No real money-action request reached the approval UI, so action-by-action MFA gating remains unexercised. |
| E3 failures / queues / SLA | PARTIAL | No payout/refund failure was generated. The older onboarding HTTP 500 had no matching `ops_issues` row in the checked window; alert/SLA delivery remains unproven. |
| E4 ledger = Stripe | BLOCKED | No test payment, transfer, refund, or payout was made in this run to reconcile. |
| E5 route kill switch | BLOCKED | Route is already enabled; disabling/re-enabling it requires the unexercised two-person request and approvals. No route change was made. |
| E6 audit trail | BLOCKED | No regression money action reached a terminal audit receipt. |
| E7 solo-operator usability | PARTIAL | The Pixel completion disclosure puts all settlement rules in one dense paragraph. Draft PR [#93](https://github.com/Drape-ltd/drapeon/pull/93), branch `codex/payout-setup-copy` (`cdd7a95f`), reformats it into labeled sections sourced from the shared settlement definitions; file Prettier, ESLint, Workers Builds, and `static-contract` pass. It is not deployed. The protected localhost flow also redirects between `127.0.0.1` and `localhost`, losing the host-scoped session cookie; this is logged as a local Ops usability/config defect. |
| F1–F3 money timelines | BLOCKED | No eligible paid/refunded customer order exists for cross-surface timeline verification. |
| G1 alerts | PARTIAL | No failure was generated in this run. The earlier onboarding error was logged, but no matching Ops case or complete Sentry alert delivery was proven. |

No money-loss/stuck-money defect was reproduced in this continuation. D4, C2
payout ordering, and all payment/refund cases still lack live Dev regression
proof. The regression is **not ready for Production**. No Prod read/write,
migration, deployment, Stripe LIVE operation, or OTA was performed.

## #92 Android Preview physical-device proof — 2026-11-01

The final PR #92 head `e4a98b2b` passed `static-contract` and Workers Builds.
Android Preview build `44daf34a-b9e9-49aa-8d76-32d113c08335` was installed on
physical Pixel `38271FDJH0030C` as `com.drape.app.preview`. The Dev Edge
deployment was the temporary combined #92 + #96 build, `payout-account-action`
version 100; it contained both the `drape-preview:` callback allowlist and the
`ops-refresh-stripe-destination` action.

Using the authenticated Pixel QA tailor profile
`bc4d5c74-9648-4c57-b41d-74059deec2e3`, the app opened payout setup, selected
the existing USD Stripe route, opened Stripe TEST onboarding, and used Stripe's
**Return to Drapeon** control. Android delivered the callback to
`com.drape.app.preview`; the app reopened on the tailor dashboard and refreshed
to **Live and payout-ready**.

Read-only reconciliation after the return:

- connected account before and after: `acct_1UWHmvER5DkAcmOr`;
- Dev profile remains Stripe/USD/US, verified, with reverification not required;
- Stripe TEST inventory contains exactly one account whose
  `metadata.tailor_profile_id` matches this profile;
- that account has `charges_enabled=true`, `payouts_enabled=true`, and
  `details_submitted=true`;
- pending payout-change requests for the profile: 0 (this was an existing
  destination refresh, so no replacement request was expected).

Result: **PASS — Android Preview callback and refresh path**. No second Stripe
account, duplicate change request, payment, transfer, or live-mode action was
created. Screenshot:
[`android-preview-stripe-return-payout-ready-20261101.png`](evidence/android-preview-stripe-return-payout-ready-20261101.png).

The iOS physical return path remains unverified and stays a Production release
gate. The Preview build intentionally omitted Firebase configuration because no
Preview Android Firebase app/config exists; that is a separate Preview-build
notification gate, not a Stripe callback failure.

## #92 merge and #96 fail-safe review repair — 2026-11-01

PR #92 merged as `1b208764`. PR #96 was rebased onto that merge and updated at
`954b2f47` to close its two reviewed launch blockers:

- the Dev Ops web route now sends `X-Drape-Service-Key`, matching the Edge
  action's enforced service-auth header;
- Stripe is refreshed immediately only for a `CLEARED` decision. A fail-safe
  `BLOCKED` decision remains available when provider evidence is stale or
  Stripe is unavailable, while stale `CLEARED` remains rejected.

Forward migration `20261102054500_stripe_first_release_block_fail_safe.sql`
was proved against Dev inside a single `BEGIN … ROLLBACK` transaction before
application: stale `BLOCKED` succeeded, stale `CLEARED` raised the expected
check violation, and the transaction rolled back. It was then applied to Dev
only. The rebased branch's full `pnpm launch:contracts` suite passed under Node
22, including the new cross-service header/refresh contract.

`payout-account-action` was deployed to Dev as version 101, digest
`f141b62b48f60ac779598b67ded0b9c95abf15e8ca1d7f170b9dc4c165fd70d1`.
A live service-authenticated refresh of Pixel destination
`92fdca6b-3f97-4164-8efa-7913381cb1e8` returned HTTP 200 and refreshed Stripe
evidence at `2026-11-02T05:32:45.562Z`. No review decision or money movement
was made by that refresh.

Dev CAPTCHA was disabled only long enough to restore the founders password
session, then re-enabled and verified in the Supabase dashboard. The user
entered the human-held TOTP code and the server verified an AAL2 founders
session. The guarded legacy Ops payout workspace then rendered Pixel's real
`PENDING` destination and the clearance form was prepared with Stripe TEST
account `acct_1UWHmvER5DkAcmOr` as its evidence reference. The final
`Record destination review` action remains unsubmitted pending the explicit
human click; no review decision or money movement has occurred yet. No
Production state was read or changed.

While the final clearance click remained pending, the physical Pixel Preview
session exposed a second legitimate checkout prerequisite: paid orders were
paused because the QA tailor had no complete fulfillment location. Through the
real app profile flow, pickup was enabled with the synthetic Dev-only address
`100 Federal Street, Boston, MA 02110, US` and the note `Dev QA pickup only`.
The app displayed **Fulfillment location saved**. This changed no payment,
payout, provider, or Production state. Evidence:
[`pixel-fulfillment-location-saved-20261101.png`](evidence/pixel-fulfillment-location-saved-20261101.png).

## STOP — Pixel clearance refresh authentication regression — 2026-11-01

The user submitted the prepared Pixel first-release clearance through the real
Ops form. The action returned an error and Pixel remained `PENDING`/inactive;
the review RPC did not record a decision and no money moved.

Repository inspection identified the exact regression in merged PR #96 commit
`954b2f47`: the required `X-Drape-Service-Key` header was added to
`triggerOrderPayoutRelease`, but the clearance path calls
`refreshStripePayoutDestination`, whose request still sends only
`Authorization`, `apikey`, and `Content-Type`. Dev Edge
`payout-account-action` requires `x-drape-service-key` for
`ops-refresh-stripe-destination`, so the refresh is rejected before the review
RPC can run. The new static contract is a false positive because it searches
the entire route source for the header without proving the header is inside the
`refreshStripePayoutDestination` request. The client action bridge also lacks
copy for `payout-destination-provider-refresh-failed`, so it displayed the
generic **This Ops action could not be completed** message instead of the
specific provider-refresh failure.

Classification: **stuck onboarding / launch blocker**, not money loss. Every
new Stripe destination requiring first-release clearance is affected by this
web route until the header is placed on the correct request. Per the regression
stop rule, no fix was made in this run pending explicit approval.

## #97 merge and Pixel first-release clearance — 2026-11-02

PR #97 merged after both required checks passed. Head
`5cdb836544b1e1ce8250324a3131203491a58870` was merged as
`54acb3f40a9516a40b0967aa1dc7ca07d8012a81` at
`2026-11-02T06:18:35Z`. The fix places `X-Drape-Service-Key` on the
`ops-refresh-stripe-destination` request itself, removes the stray header from
the unrelated payout-release request, and maps the short provider-refresh
error code to Ops-safe copy.

The real Dev Ops flow then refreshed and cleared Pixel destination
`92fdca6b-3f97-4164-8efa-7913381cb1e8` for profile
`bc4d5c74-9648-4c57-b41d-74059deec2e3` and Stripe TEST account
`acct_1UWHmvER5DkAcmOr`. The Ops POST returned HTTP 200 within the evidence
freshness window. Read-only Dev verification recorded:

- `first_withdrawal_review_status = CLEARED`;
- `active = true`;
- provider evidence refreshed at `2026-11-02 06:16:17.521+00`;
- review event `fdaf6733-da71-46fe-8800-8eb39ac3ff2d`;
- actor workforce principal `3eef54ba-7b15-4b51-b74d-a181249d7fcb`;
- review created at `2026-11-02 06:16:18.419048+00`;
- audit row `3d8a83ad-9466-468c-a9de-01e083f7f77a` with event
  `ops.payout_destination_first_release_reviewed`.

Result: **PASS — Pixel first-release clearance**. No transfer, payment,
refund, or Production action occurred. C1 is unblocked and must use this
cleared destination through the real customer/tailor application flows.

## C1 fresh customer and discoverable-tailor prerequisite — 2026-11-02

A second dedicated Dev customer was created through the real iOS Dev client
without direct database fixture writes:

- Auth user `9a6b0a66-0589-44d1-85e5-d53b7ad00b01`;
- customer profile `6565f813-00fa-4fdb-bf5e-cc4c79d29432`;
- display name `C1 Stripe Customer`;
- USD account currency and United States ordering context.

The setup UI displayed **Could not finish locking account currency** after the
supported save action, while the authoritative Dev profile and currency rows
were saved correctly. This is logged as a non-money onboarding-display defect;
it did not create a payment, transfer, refund, or ledger row and does not block
the C1 fixture.

The previously cleared `Waiver Refresh QA` tailor profile is intentionally
marked `is_test_profile=true`. The customer read gateway therefore excludes it
from marketplace search and rejects a direct profile link. This is correct
test-profile isolation, not a resolver defect. The discoverable supported
seller is `Pixel QA Tailor`, profile
`5cc8ec2b-c4cb-4299-b9e6-aaf0aa2a44a7`, Stripe TEST account
`acct_1UWKMoEBcTE5DZFb`, destination
`7f50dc1f-6f08-406d-8113-aace59c773fa`. The customer app found and opened
that profile, then correctly blocked paid-order entry because its destination
was still `PENDING` and inactive.

The legacy local Ops review page needed to clear that discoverable destination
was unreachable because the web middleware redirected
`http://localhost:3005/ops?view=payouts` back to itself. The behavior was
captured by a real middleware test: latest `main` returned 307 for a request
already on port 3005, while the fix returns 200 with no `Location` header and
continues to redirect an Ops request from port 3006 to port 3005. PR
[#98](https://github.com/Drape-ltd/drapeon/pull/98), head
`0516483c53f48ae4c0b870dcc29b8669ff2a0fb5`, contains only this local routing
repair and its regression test. Web typecheck, `git diff --check`, and the full
Node 22 launch-contract suite pass. No Production route, data, or deployment
was changed.

PR #98 was subsequently merged into `main` as
`6da6aede247ed43716ca54e5c4715c6794a9bd36`. Using the repaired local route,
the real Dev Ops flow refreshed and cleared the discoverable Pixel destination
within the 15-minute evidence window. Read-only Dev verification recorded:

- profile `5cc8ec2b-c4cb-4299-b9e6-aaf0aa2a44a7`;
- Stripe TEST account `acct_1UWKMoEBcTE5DZFb`;
- destination `7f50dc1f-6f08-406d-8113-aace59c773fa`;
- `first_withdrawal_review_status = CLEARED` and `active = true`;
- capability evidence refreshed at `2026-11-02T07:35:39.258+00:00`;
- review event `992c30d7-8248-4af5-9a7f-57d6ef2086ac`;
- audit row `ca304ffd-800b-43f0-85d4-cfad0fb99026`, event
  `ops.payout_destination_first_release_reviewed`.

The legacy port-3005 panel is used because first-release destination review has
not yet been migrated into the newer port-3006 Ops application. The server RPC,
review event, and audit log remain authoritative. This split is logged for E7
as an Ops usability/migration gap; it did not weaken the control or move money.

## C1 order fixture submitted — 2026-11-02

The dedicated iOS Dev customer completed the supported six-step custom-order
flow against the discoverable, cleared Pixel profile. The flow saved a
self-guided synthetic measurement profile, a supported public style/fabric
reference, a USD 20 fabric-sourcing budget, tailor-sourced fabric with customer
approval before cutting, local collection, and the cancellation-policy
acknowledgement. No direct order or ledger insert was used.

The submitted order is public reference `DRPYYZYNX`, garment
`Dashiki / Danshiki`, status **Awaiting Quote**, customer profile
`6565f813-00fa-4fdb-bf5e-cc4c79d29432`, and tailor profile
`5cc8ec2b-c4cb-4299-b9e6-aaf0aa2a44a7`. Evidence screenshot:
[`c1-order-drpyyzynx-submitted-20261102.png`](evidence/c1-order-drpyyzynx-submitted-20261102.png).

The next supported action requires the existing Pixel QA Tailor Auth session.
The account is confirmed and linked, but no valid session is currently present
on either attached device and its original QA password was not retained. No
admin password reset, impersonation, or direct quote write was used. C1 remains
**IN PROGRESS — awaiting legitimate tailor authentication**, not failed.

The preserved Pixel session was subsequently recovered from the physical
Android QA development client without a password reset or impersonation. Pixel
opened `DRPYYZYNX` through the supported order queue and prepared a USD 120
quote: USD 100 tailoring, USD 20 protected fabric allowance, green cotton
fabric sourcing, and a 2026-11-16 completion date. Submission failed before
creating a quote, payment, transfer, refund, or ledger entry. The Dev Edge
request returned HTTP 503 at `2026-11-02T13:53:10Z`; correlated request
`01a19c89-09f0-7be8-b889-6eac4cf43fff` logged
`tax.lookup_unavailable` with the exact cause **Tax policy review is overdue
for US.** Evidence screenshot:
[`c1-quote-tax-review-expired-20261102.png`](evidence/c1-quote-tax-review-expired-20261102.png).

This is a fail-closed, non-money operational-review expiry, but it blocks every
new US paid-order fixture. PR
[#99](https://github.com/Drape-ltd/drapeon/pull/99), head `844f7976`, renews
only the US provider-backed public-source review after re-checking the official
Streamlined Sales Tax marketplace-seller guidance. It keeps ZipTax destination
lookup mandatory, changes no rate or liability decision, and sets the next
review due 2026-12-02. The regression test fails on current main (`OVERDUE` on
2026-11-02) and passes with the change; the targeted suite reports 22 passing
tests and `pnpm launch:contracts` passes.

The owner-approved documentation update made #99 head
`28194de382aecbd7d90b64f49b8b3cde14674034`; both CI checks passed and it
merged as `0fe20d6db3a43fa10f2d988825ac134eb6214be2`. To prevent bundled policy
version skew, all four Dev tax-rule consumers were deployed together from that
exact merged `main` state:

- `tailor-order-action` v183;
- `ready-made-order-action` v108;
- `service-health` v72;
- `monitor-tax-controls` v35.

Pixel retried the preserved USD 120 quote through the real Android app against
`tailor-order-action` v183. The US review-expiry error no longer appeared, but
the request still failed before quote creation with HTTP 503 because the
submitted customer fixture does not contain a valid US ZIP code. Correlated
request `01a19cba-aacf-738f-8a7c-0fc5320fa872` logged
`tax.lookup_unavailable` with the exact cause **A valid US ZIP code is required
before checkout.** Evidence screenshot:
[`c1-quote-valid-zip-required-20261102.png`](evidence/c1-quote-valid-zip-required-20261102.png).

No quote, payment, transfer, refund, payout claim, or ledger entry was created.
The owner classified this as a **money-correctness product defect
(wrong-jurisdiction tax)**, not a fixture problem. The product allowed a US
delivery brief to be submitted without a checked structured ZIP, while the tax
resolver could fall back to extracting any five-digit fragment from free-text
address copy. Text such as `12345 Main St` or `Apt 10023` could therefore lock
tax using a number that was not the customer's ZIP. The observed C1 request
failed closed and moved no money, but another address containing five digits
could select the wrong jurisdiction and charge the wrong tax.

C1 is **FAIL — MONEY CORRECTNESS (WRONG-JURISDICTION TAX)**. Work stopped
before changing code. The approved repair requires one strict shared US/CA
postal-code rule across mobile, web, and Edge; server-authoritative structured
postal validation; removal of free-text inference; and supported recovery for
already-invalid briefs. C1 will be rebuilt through the app with a valid
structured delivery ZIP only after that repair is merged and deployed to Dev.

Before the repair, an approved read-only Dev audit found **0** orders whose tax
was already locked while the structured postal field was empty and whose
free-text delivery address contained a US ZIP or Canadian postal-code pattern.
There are **12** legacy tax-bearing orders with no structured postal code, but
none contains either free-text pattern and none qualifies as a tax lock derived
from this fallback. No rows were changed.

## C1 structured-address ZipTax quote — 2026-11-02

PR [#103](https://github.com/Drape-ltd/drapeon/pull/103) merged to `main` as
`432957d71a2733fc405018d2c2943498106f0ca0`. The guarded Dev-only deployment
from that clean merge installed `tailor-order-action` v186,
`ready-made-order-action` v111, and `service-health` v73. The Dev
`tax_rate_cache` primary key is `(country_code, address_key)` and the table was
empty before the live retry.

Pixel resubmitted the saved quote for order `DRPZHHLGH`
(`8731637d-ac84-419b-8397-b2c62f878c50`) through the supported Android app.
The quote succeeded and the order advanced to `QUOTE_SENT`; active quote
`d1bb70a2-fa9e-430b-aa33-0fe7eb1bf575` locks USD 232.74 total, USD 17.74 tax,
and `tax_rate_bps = 825` with `tax_fallback = false`.

The redacted provider evidence contains exactly one `SALES_TAX` summary and
normalizes the delivery location to Austin, TX `78701-2704`, matching the
order's Texas / `78701` structured fields. The 8.25% lock matches the Texas
Comptroller's published Austin rate. Exactly one new address-scoped cache row
was written for `100 CONGRESS AVENUE AUSTIN TEXAS 78701 US`, source `ZIPTAX`;
there was no ZIP-only cache fallback.

Regression ZipTax traffic is now **2 provider request attempts** total (the
earlier mixed-mode failure plus this successful address lookup). The ZipTax
Starter dashboard still displays **0/100 metered calls** after the successful
lookup, so both the application-observed attempt count and provider meter are
retained rather than treating the delayed meter as zero traffic. Evidence
screenshot: `evidence/c1-quote-sent-ziptax-20261102.png`.

C1 remains **IN PROGRESS**: quote-time tax correctness now passes; customer
acceptance/payment and the 80/20 transfer/ledger reconciliation remain to run.

## C1 Stripe publishable-key repair and payment — 2026-11-02

The first customer payment attempt exposed a **stuck-checkout** configuration
defect with no money at risk: the Dev iOS bundle's Stripe publishable key was
for account `acct_1TGkSCCsuzt4qHXR`, while the Dev Edge secret and the existing
PaymentIntent belong to `acct_1TGkS0CrvCJ1ybBB`. PaymentSheet therefore could
not open the server-created intent. The customer saw the generic safe failure
copy: “Payment unavailable — Payment could not be completed. Try again or use
another card.” Stripe left the intent at `requires_payment_method`; it had no
charge and received no money.

Dev mobile and web local configuration, plus the EAS development and preview
variables, were aligned to the publishable key for the server account. No key
value was recorded. Metro was restarted with a cleared cache from the approved
#103 worktree. Before retry, Dev contained exactly one payment row:
`cf304211-cb7b-42da-85d3-858bdcea1179`, tied to
`pi_3UXQPICrvCJ1ybBB1TTyHL08`, USD 232.74, `PENDING`.

The iOS customer retried through the supported “Continue payment” flow and paid
with Stripe's `4242` test card. The signed webhook advanced that same row and
same PaymentIntent to `SUCCEEDED`; there is still exactly one order payment,
`refunded_amount = 0`, and the order advanced once to `CONFIRMED`. No second
PaymentIntent and no second `PENDING` row were created.

The locked USD 232.74 consists of USD 120.00 tailoring, USD 80.00 protected
fabric allowance, USD 15.00 local delivery, USD 0.00 platform fee, and USD
17.74 tax at 8.25%. C1 payment is **PASS**. The 80/20 tranche release and
Stripe/ledger reconciliation remain in progress.

## C1 fabric release blocked by unavailable Stripe balance — 2026-11-02

Through the supported tailor and customer apps, Pixel submitted fabric candidate
`8c3137c9-41c5-43a3-8636-cf381cb65a3f` for the exact protected allowance of
USD 80.00. The customer approved and authorized it at
`2026-11-02T20:00:38.990285Z`. The release then failed because the Dev Stripe
platform balance did not have USD 80.00 available.

The provider returned the deterministic insufficient-available-funds error, but
the application recorded the candidate as `RELEASE_BLOCKED` with provider
status `AMBIGUOUS`. Payout `60eae409-8419-464f-967d-a3bb9f9d69da` remains
`PROCESSING` even though its provider transfer status is `NOT_STARTED`, no
provider payout/transfer ID exists, and no payout claim exists. No Ops issue or
reconciliation state was created. No transfer and no additional customer charge
occurred.

C1 is **STOPPED — STUCK MONEY**. This is not a provider-uncertainty case: Stripe
explicitly rejected the transfer before it started. The state currently leaves
the protected fabric funds blocked, labels a known failure as ambiguous, and
provides Ops no case to resolve it. Per the regression stop rule, no retry,
balance seeding, or state mutation was attempted pending review and a tested
forward fix.

## C1 reviewed fabric recovery — 2026-11-03

PR [#105](https://github.com/Drape-ltd/drapeon/pull/105) merged and its forward
recovery path was deployed to Dev. The relevant deployed functions are
`process-job-queue` v125, `ops-money-action` v41, and
`release-order-payouts` v102. Migration `20261102234537` is present on Dev.

The original fabric job `7cefb7b5-f13a-421f-bc08-73a29696316e` reached
`DEAD` naturally at attempt 8/8. No manual retry or direct money-state update
was used. A supported Money Desk request was then prepared for candidate
`8c3137c9-41c5-43a3-8636-cf381cb65a3f`:

- request `65d6b856-7eab-4b58-afcd-7ba43a89b1bd`, reference
  `MD-2F6B72EE39`, USD 80.00, action `POST_RELEASE_RECOVERY`, target
  `FABRIC_RELEASE_JOB`;
- first approval event `c0358436-263f-4a3e-b658-d5a4f8d046d7` by
  `founders+ops-qa@drapeon.co` at AAL2;
- second approval event `2b286c9d-1663-4fe0-9984-e37669c33367` by the
  distinct AAL2 principal `founders+ops-qa-2@drapeon.co`;
- request-approved event `4e9e027c-0443-4c19-ac9e-b1b03ebb0205` and
  execution attempt `6bd28a27-552e-41c0-8ca9-e0db6be5655a`;
- execution-succeeded event `9716d58c-7128-4328-b3ea-521501d93787`, which
  created recovery job `3e9089cc-c2b7-40d6-af68-2f88405e7198`.

The recovery job's first pass reconciled without a destination filter, found no
matching Stripe transfer, marked payout
`60eae409-8419-464f-967d-a3bb9f9d69da` `FAILED`, advanced the candidate to
provider attempt 2, and returned `FABRIC_RETRY_READY`. The old payout has no
provider transfer ID, and a read-only Stripe TEST lookup by transfer group
`DRAPE-FABRIC-V2-8c3137c9-41c5-43a3-8636-cf381cb65a3f` still returns exactly
zero transfers.

The direct notification and Ops cron partitions do not select fabric-release
jobs. A separate bounded recovery scheduler does: active cron
`process-money-jobs-recovery` calls `wake_due_money_jobs()` at minutes `:11`
and `:41`, and that function includes `PROCESS_FABRIC_RELEASE`. The recovery
job therefore remained due and `RETRYABLE` at attempt 1 with
`FABRIC_RETRY_READY` while waiting for its natural `04:11 UTC` sweep. It was
not force-run, and its schedule and lock were not changed.

The `04:11 UTC` bounded recovery sweep advanced the same job to attempt 2 and
`SUCCEEDED`. It created payout `78f6352d-2c22-43f0-ab4e-0b7793b846e4` and
exactly one Stripe TEST transfer `tr_3UXQPICrvCJ1ybBB1mFkMvjO` for USD 80.00.
The transfer is not live or reversed, names the order transfer group, and uses
source charge `ch_3UXQPICrvCJ1ybBB1tU7m5NM`, which is the successful initial
PaymentIntent's `latest_charge`. Its destination `acct_1UWKMoEBcTE5DZFb`
matches the order's pinned active Stripe destination
`7f50dc1f-6f08-406d-8113-aace59c773fa`. The earlier account reference in the
pre-recovery checklist was stale and was not used as authority.

Candidate `8c3137c9-41c5-43a3-8636-cf381cb65a3f` is now
`AWAITING_RECEIPT`, provider status `SUCCEEDED`, provider attempt 2. The old
payout remains `FAILED`; the new payout is `PROCESSING` with the transfer ID
and source payment pinned. Ledger transaction
`674ee2f4-f814-4400-8d35-1b057d72ce00` contains exactly two USD 80.00 entries:
a `MATERIAL_ADVANCE_LIABILITY` debit and a `TAILOR_RELEASED` credit, so the
release balances to the cent. Critical case `OPS-BACB0A76` is `RESOLVED` and
records the recovered transfer.

Both release emails and the tailor push reached `SUCCEEDED` on their first
delivery attempt. Customer push job `068b80ff-6e25-47db-94d7-4895a37e03b6`
is `RETRYABLE` because the Dev project lacks APNs credentials for the iOS Dev
bundle. This is a notification-configuration defect, not a money-state defect;
the durable job remains visible and no notification outcome was fabricated.

The reviewed recovery is **PASS** for exactly-once provider transfer and ledger
release. C1 continues with receipt/acquired-material evidence and the 80%
tranche; the APNs delivery gap remains logged separately.

## C1 dispatch quote preflight — 2026-11-03

After PR [#108](https://github.com/Drape-ltd/drapeon/pull/108) merged as
`d76198b5e2c85c708baa67618beadfcbb1f8aba6`, the reviewed
`ops-dispatch-action` build was deployed to Dev. A read-only Dev snapshot before
the Ops quote confirmed that no dispatch or money state had changed while the
MFA session was being established:

- order `DRPZHHLGH` (`8731637d-ac84-419b-8397-b2c62f878c50`) remains
  `READY_FOR_DRAPE_DISPATCH`;
- fulfillment run `4cfd7d5f-6e04-4081-bb8c-b3fc58422256` remains
  `QUOTE_REQUIRED` / `UNQUOTED`, method `LOCAL_DELIVERY`, currency USD;
- captured and customer-funded allowance remain USD 15.00; provider name,
  provider quote reference, actual provider cost, and quote timestamp remain
  null;
- shortfall subtotal, shortfall tax, shortfall fee, and shortfall total remain
  USD 0.00; no customer decision or provider payment exists;
- the order's previously captured commercial total remains USD 232.74, including
  USD 17.74 tax. No additional payment, refund, payout, or ledger movement was
  created by this preflight.

The next supported action is the MFA-authenticated Ops dispatch quote. Its
provider evidence and quote reference must come from the genuine QA dispatch
source; no receipt or provider response will be fabricated.

PR [#109](https://github.com/Drape-ltd/drapeon/pull/109) merged as
`5f21fc5511f8338cfe732cfeb2758daa4d42a1db`. The local Dev Ops server was
restarted from that exact merged commit. The founders Supabase Auth session
completed AAL2 verification and `/ops/my-work` returned the authoritative Dev
queue successfully, proving the repaired `local-supabase-mfa` principal
resolution in the live route. The order workspace then loaded fulfillment run
`4cfd7d5f-6e04-4081-bb8c-b3fc58422256` as `QUOTE_REQUIRED` and displayed the
supported provider-quote command.

The command requires a private image of the provider quote. No order-specific
quote or proof from the genuine QA dispatch source is currently present in the
workspace or saved test artifacts. Existing evidence belongs to older, other
orders and was not reused. C1 is therefore **BLOCKED — GENUINE DISPATCH QUOTE
EVIDENCE REQUIRED** at this step; it is not marked PASS, and no dispatch,
payment, refund, payout, or ledger state was mutated.

The customer view on the booted iOS Simulator still shows order `DRPZHHLGH`
with **Drapeon Dispatch — Delivery requested** and no invented provider status.
Screenshot:
[customer awaiting dispatch quote](evidence/c1-customer-awaiting-dispatch-quote-20261103.png).

The authenticated C1 Money Desk view separately proved the live first-layer
control: it displayed **Fresh MFA assurance is active**, stated that reading
the queue does not grant authority to move money, and kept **Activate for 15
minutes** disabled until an operator supplies a protected-scope reason. It also
states that fresh MFA alone cannot authorize a financial decision. This is
useful E1 evidence, but not yet a PASS for every money action or the full
two-person execution path.

## Ready-made refund-fixture checkout blocker — 2026-11-03

To continue the receipt-free D cases without fabricating a custom-order quote,
the authenticated iOS Dev customer opened the real ready-made checkout for
seller item `6eb27728-4da1-42c8-8d59-edbe91e60a77` (Stripe Regression
Ready-Made Kaftan) and selected pickup. The app failed closed before order
creation with **Total unavailable**. No payment intent, payment row, order,
inventory decrement, refund, payout, or ledger movement was created.
Customer-view screenshot:
[ready-made pickup tax blocker](evidence/ready-made-pickup-tax-blocker-20261103.png).

Authoritative Dev function log execution
`7f9e0b45-a8ff-42d9-8193-525507edf774` on
`ready-made-order-action` v111 recorded
`checkout_pricing.unavailable` with `Enter a valid 5-digit US ZIP code
(ZIP+4 is also accepted).` Read-only database evidence showed the linked
seller pickup record is complete and structured: `100 Stripe Test Plaza`,
Austin, TX `78701`, US.

Root cause: the checkout handler loaded `pickup_city`, `pickup_region`, and
`pickup_postal_code`, but passed the customer delivery fields to tax
resolution for every fulfillment mode. Pickup intentionally has no customer
delivery fields, so every US/Canadian ready-made pickup checkout failed before
payment. This is classified as **checkout blocking / no money moved**, not a
fixture issue.

Fix PR [#110](https://github.com/Drape-ltd/drapeon/pull/110), reviewed head
`88f5e3e223afd78a7b45397061f91ade6a34588f`, forwards the seller's structured
pickup tax location while preserving delivery/shipping inputs. Review found
one further tax-correctness gap in the first head: the ZipTax lookup used the
pickup state, but the reviewed-policy lookup still used the customer's empty
delivery state. The reviewed head routes both lookups through the same selected
tax location, so an Austin pickup supplies `TX` to both the rate resolver and
the reviewed-rule resolver. Focused red proof shows the old decision input
failing with `jurisdictionRegionCode: null` versus expected `TX`; green proof
is 3/3 Deno tests, the Edge entrypoint type-check, Node 22
`pnpm launch:contracts`, and `git diff --check`. Both GitHub checks are green.
The approval is recorded on the PR; Dev deployment and live checkout proof
wait only for the owner merge required by branch protection.

Non-blocking follow-up: if the seller pickup row itself lacks a ZIP, checkout
currently shows customer-directed ZIP copy. The server still fails closed and
no wrong tax or money movement occurs, but the message should explicitly say
that the seller's pickup address is incomplete.

### #110 merged-main Dev retest — 2026-11-03

PR #110 merged as `7c99217104db7d649961d7210884a320a0d79d39` and
`ready-made-order-action` was deployed to Dev from that exact merged-main
worktree as v112. No Production function or data changed.

The iOS Dev client was force-restarted and connected to a fresh Metro bundle
from merged main so the retest could not reuse the pre-fix component state.
The customer reopened item `6eb27728-4da1-42c8-8d59-edbe91e60a77`, selected
pickup, and the authoritative preview reached v112 successfully:

- Edge execution `55baa213-4932-4fbb-8838-4ab6b3c1e8ea` returned HTTP 200;
- fulfillment was `PICKUP`;
- item subtotal was USD 125.00;
- the Austin, TX pickup screen displayed USD 10 tax;
- the displayed total was USD 135.

This proves the #110 location-selection defect is fixed in the live Dev path:
the seller pickup location now supplies the rate and reviewed-rule lookup.

The required reviewed-tax gate is not configured on Dev. A read-only query
found zero rows in `tax_policy_activations` (including zero ACTIVE US/TX
READY_MADE_ORDER activations). Therefore the resolver outcome for this preview
is `NOT_ACTIVATED`; there is no activation ID. The checkout would consequently
have no `tax_decision_snapshots` row tied to a reviewed activation.

The rollout instruction in force at that point incorrectly treated
`NOT_ACTIVATED` as a stop condition, so the first retest stopped before
checkout creation or payment. No order, payment intent, payment row, inventory
decrement, payout, refund, or ledger posting was created in that first retest.
The #110 code fix was a live **PASS**. Review later corrected the stop
condition, as recorded below; no activation was fabricated or inserted.

This is not a skipped schema migration. Read-only counts are zero for every
dependency in the reviewed-decision chain: `tax_policy_versions`,
`tax_policy_activations`, `tax_responsibility_controls`,
`tax_registration_controls`, `tax_line_classification_controls`, and
`tax_registration_facts`. The architecture deliberately installs the resolver
without seeding a jurisdiction. The 2026-11-02 US operational re-review also
states that it does **not** decide Drapeon's collection/remittance
responsibility, marketplace role, registration evidence, or taxable-line
treatment. Those are the exact inputs an activation requires. Consequently a
one-row activation insert, a test-only seed, or a direct SQL change would be
false review evidence and is not an acceptable regression unblocker.

The separate Tax/Legal gate is a named, independently reviewed Development-only
US/TX `READY_MADE_ORDER` / `LOCAL_COLLECTION` decision chain covering the
policy version, responsibility, registration rule and fact, line
classifications, and activation. It must be append-only, source-backed, and
reviewed before application. Legacy Dev pricing may continue without it and
correctly carries no activation ID or immutable tax-decision snapshot.

### Legacy-pricing correction and pre-payment display stop — 2026-11-03

Review corrected the rollout condition: `NOT_ACTIVATED` is the expected legacy
pricing state on Dev, not a checkout blocker. `ready-made-order-action` blocks
only an explicit `BLOCKED` tax decision. No tax-control rows were seeded or
inserted. The reviewed US/TX chain remains a separate Tax/Legal gate.

The iOS customer resumed the real pickup checkout for item
`6eb27728-4da1-42c8-8d59-edbe91e60a77`. Exactly one order was prepared:

- order `a8774cbd-f25c-4c37-b62c-026b1c024aa6`, reference `DRP1ME4AJ`;
- stage `PAYMENT_PENDING`, fulfillment `PICKUP`, currency USD;
- item/subtotal 12,500 minor units, fulfillment 0;
- ZipTax rate 825 bps, TX tax 1,031 minor units;
- authoritative locked total 13,531 minor units;
- activation status `NOT_ACTIVATED` and `tax_decision_snapshot_id = null`, as
  expected for legacy pricing.

The customer-visible preview and locked review both displayed **Tax (TX) $10**
and **$135**, while the immutable order amounts are **$10.31** and **$135.31**.
The shared mobile `formatAmount` implementation uses `toFixed(0)` for USD and
other non-large-unit currencies, so it hides cents. This is not a provider or
tax-calculation error: the stored 825 bps calculation is correct, but the
customer is shown a lower rounded amount immediately before payment.

Per the corrected stop rule (tax amount must match the preview), Stripe was not
opened and payment was not confirmed. The order has no PaymentIntent, zero
`order_payments` rows, and zero commercial-ledger transactions. Size M stock
is reserved from four units to three by the prepared order; no charge, capture,
refund, payout, or notification job was created. Screenshot:
[ready-made pickup rounded tax mismatch](evidence/ready-made-pickup-rounded-tax-mismatch-20261103.png).

Classification: **money-correctness / customer wrong-display, no money moved**.
The ready-made payment test is stopped before Stripe until every checkout money
amount shows the exact minor-unit value that will be charged.

### Exact-cents payment completion and notification stop — 2026-11-03

PR #111 was merged at `c76ccf145b58a12f183fcc75d497a0bfc1dbc8d7`.
The iOS Dev client was reloaded from that exact merged-main build. Order
`DRP1ME4AJ` showed subtotal **$125.00**, tax **$10.31**, and total **$135.31**;
Stripe PaymentSheet independently showed **Pay $135.31**. The customer paid
with a Stripe TEST card. Screenshot:
[Stripe PaymentSheet exact $135.31](evidence/c1-ready-made-stripe-pay-13531-20261103.png).

The signed Stripe webhook completed the existing order and produced exactly one
payment record:

- order `a8774cbd-f25c-4c37-b62c-026b1c024aa6`, reference `DRP1ME4AJ`, now
  `CONFIRMED`;
- payment `9bf7ae52-8a77-4f0f-a090-3e9ca212c7f5`, status `SUCCEEDED`, amount
  13,531 USD minor units;
- PaymentIntent `pi_3UXwFjCrvCJ1ybBB1EyLQVPr`, charge
  `ch_3UXwFjCrvCJ1ybBB1ELkok50`, Stripe event
  `evt_3UXwFjCrvCJ1ybBB1TB6lzNo`, request
  `req_7CZMVyyd8GmT49`, all test mode;
- Stripe object `amount = amount_received = 13531`; no second PaymentIntent or
  second `order_payments` row exists;
- receipt `DRP-2026-00000023` (`bc5de1a8-0c80-4c7b-8cae-2897f151060c`)
  records subtotal 12,500, tax 1,031, shipping 0, fee 0, total 13,531;
- commercial transaction `a9da780c-fd1b-4535-86c1-658daf31115d` records one
  13,531 capture: debit Stripe provider clearing 13,531, credit tailor
  entitlement 12,500 and TX tax liability 1,031. The ledger balances exactly;
- `tax_decision_snapshot_id` remains null, expected for the documented
  `NOT_ACTIVATED` legacy-pricing path;
- size M inventory remains three units after payment (one reservation only;
  payment did not decrement it again).

The customer app showed `Order placed` and `Payment confirmed. This order is
now placed.` The email job `c4bba51c-b792-4de3-abf8-3e8ff7fcd0cd` completed
on attempt 1 with final outcome `ACCEPTED` from Resend (outcome
`f291d0c9-eeee-4347-8364-f0162e5de3c4`).

The payment-confirmation push did **not** reach a final successful outcome.
Attempt `b8162f82-6f6f-4b11-aae3-0bcdb3aa247d` for the customer ended
`TICKET_ERROR` with Expo code `InvalidCredentials`; it has no ticket, receipt,
or provider-accepted timestamp. The physical Pixel was not connected during
the final evidence pass, so the tailor order screen could not be re-opened and
captured independently.

Money state is correct and no duplicate charge exists, but the explicit
notification stop rule fired. C1 is **STOPPED — NOTIFICATION DELIVERY FAILURE,
NO MONEY LOSS**. No push replay, credential change, or other repair was made.

### C1 notification root cause and fix PR — 2026-11-03

The failed customer attempt used the fresh iOS token last updated immediately
before payment. EAS credential inspection found that the Development identity
`co.drapeon.app.dev` has valid build credentials but no Apple Push Notification
key assigned. Expo therefore rejected the ticket with `InvalidCredentials`.
This is a Development configuration gate; no Production credential was read or
changed.

The code audit found a separate defect on merged main: ready-made payment
confirmation persisted only the customer's PAYMENT inbox notification. The
tailor received no paid-order push at all; the only tailor-side call was a
conditional low-stock alert linking to the shop. Stripe and Paystack webhooks
also sent payment pushes inline, so provider failures had no durable
`SEND_PUSH` retry job. Multiple existing open Development `SEND_PUSH` system
alerts confirm the failure is not isolated to this order, and `provider_health`
contains no Expo row.

PR #112, head `22975f05`, is the isolated code fix. It:

- builds customer and tailor payment notifications from one shared contract;
- adds a mandatory `newOrders` tailor notification that deep-links to the
  order;
- queues Stripe, Paystack, and direct-confirmation pushes through the durable
  worker with recipient-specific idempotency keys.

Red replay of the merged-main no-tailor behavior failed two of four behavioral
tests. The fix passes all four, the three affected Edge entrypoints type-check,
`pnpm launch:contracts` passes, and both GitHub checks are green. Live proof is
pending the owner merge, merged-main Dev deploy, Dev APNs assignment, a newly
registered tailor token on the Pixel, and a new safe notification event. The
already-failed payment notification will not be replayed.

### #112 merged-main Dev payment and push follow-up — 2026-11-04

After #112 merged, the four affected Edge functions were deployed to Dev from
merged main commit `60c9f67d6f26d7c18e6cf6ddb635f329683c8704`:

- `stripe-webhook` v159
- `paystack-webhook` v110
- `payment-action` v126
- `process-job-queue` v126

A fresh ready-made item was published through the tailor app and purchased
through the iOS Simulator using Stripe TEST mode:

- tailor profile `5cc8ec2b-c4cb-4299-b9e6-aaf0aa2a44a7`
- seller item `76c932a2-abf7-45a7-aa03-ce57df737290`, “Gele Set”, one unit,
  USD 125.00
- order `2262fb96-897f-4d6e-888d-d39614547e2d`, reference `DRP2710RP`,
  `CONFIRMED`
- payment `96855ac7-0cb9-443d-bda1-1bd8a5b43e4a`, `SUCCEEDED`, 13,531 USD
  minor units; PaymentIntent `pi_3UY4tMCrvCJ1ybBB0fuZdIz4`.
- order amounts are subtotal 12,500 + tax 1,031 = total 13,531 minor units;
  the customer app showed the paid/placed order.
- receipt `DRP-2026-00000024` (`f1d312f1-e28b-4691-929a-a629c0adf343`)
  references the same payment and PaymentIntent and records subtotal 12,500,
  tax 1,031, shipping 0, fee 0, and total 13,531 minor units.
- seller item `76c932a2-abf7-45a7-aa03-ce57df737290` is still live but now
  `SOLD_OUT`, with `inventory_quantity = 0` and `size_inventory["One size"] =
  0`, consistent with the one-unit purchase.
- the single `CAPTURE` commercial-ledger transaction is
  `36b56fec-2207-46d5-8232-62ccfb61e423` with idempotency key
  `payment-capture:96855ac7-0cb9-443d-bda1-1bd8a5b43e4a`. Its entries are a
  13,531 USD debit to Stripe `PROVIDER_CLEARING`, a 12,500 USD credit to
  `TAILOR_ENTITLEMENT`, and a 1,031 USD credit to TX `TAX_LIABILITY`; debits
  and credits both total 13,531.
- signed event `evt_3UY4tMCrvCJ1ybBB0odz5rLN` is
  `payment_intent.succeeded`, signature-valid, `PROCESSED` with result
  `confirmed`, and `receive_count = 1`. There is exactly one matching payment
  row and exactly two payment-confirmation push jobs (one recipient each).

The database has exactly one customer and one tailor inbox row, both pointing
to this order with `ORDER_DETAIL` destinations:

- customer inbox row `8714ae5a-3f28-429a-8c3a-a21bfcb560fd`
- tailor inbox row `dfc5949c-e895-478b-90a2-2173c6948558`

Both durable `SEND_PUSH` jobs reached the job queue's `SUCCEEDED` state, but
that state does not prove recipient delivery:

- Customer job `06681a89-0d3d-4527-a1aa-76787f000663` ran three attempts.
  Attempts 1 and 2 ended in Expo `TICKET_ERROR / InvalidCredentials`; their
  worker errors report missing APNs credentials for
  `co.drapeon.app.dev` (`@dimowoope/drape`). Attempt 3 returned ticket
  `01a1a6f2-ef5e-7368-b769-b0cabd4e68e7`, but its receipt check ended
  `DELIVERY_ERROR / DeveloperError`. All three rows have
  `provider_accepted_at = null`; no successful provider delivery or device
  receipt is established. The three delivery-attempt IDs are
  `470fc35d-abd3-4834-a552-b48b7ffe207b`,
  `d3b1f6e8-f177-4db3-bc8c-fc8d0ad2358d`, and
  `10d04ba2-2454-41d4-9554-6468eeb98fca`.
- Tailor job `76805a03-298b-446a-92e6-1653168a3d58` ended with terminal
  outcome `SKIPPED / NO_TOKEN`; it has no provider attempt or ticket. A
  read-only query found a current iOS push token for the customer, but no
  `push_tokens` row for the tailor. ADB shows the connected Pixel 8 currently
  runs `com.drape.app.studiodev` and is on Account Recovery. This does not
  establish whether Firebase configuration or the missing authenticated
  registration caused the absent tailor token.

The `notification_delivery_audit` view currently labels the customer job
`DELIVERED` even though its latest Expo receipt is
`DELIVERY_ERROR / DeveloperError` and `provider_accepted_at` is null. The
provider-specific receipt and the channel-level audit therefore disagree;
the audit label is not reliable delivery evidence for this event. This is a
notification observability/data-quality defect, not a money-state defect.

Current device screenshots were captured 2026-11-04. The iOS Simulator is
still on the paid customer order page for `DRP2710RP`:
[iOS customer order view](evidence/c1-ios-customer-order-DRP2710RP-20261104.png).
The Pixel 8 is on Account Recovery, not the tailor order view:
[Pixel account-recovery state](evidence/c1-pixel-account-recovery-20261104.png).
No account recovery or credential change was attempted.

The customer iOS token row was fresh before payment
(`868691e8-90df-4de4-9714-bf8f328d2f0`, updated
`2026-11-04 14:02:47.463`). No successful APNs delivery or device receipt is
recorded. The iOS Simulator remains on the paid order page, but a push tap was
not demonstrated. The tailor notification tap on Pixel is also unverified;
its inbox destination is correct in the database, but the job was skipped for
`NO_TOKEN`. The account-recovery screen is the observed Pixel UI state, not a
successful order notification landing.

#### Webhook replay / duplicate check — 2026-11-04

In Stripe Sandbox, the platform endpoint `we_1TVMkHCrvCJ1ybBBisINumUy`
(`dynamic-splendor`) points to the Dev `stripe-webhook` URL. The existing
`payment_intent.succeeded` delivery for event
`evt_3UY4tMCrvCJ1ybBB0odz5rLN` showed HTTP 200. I invoked Resend once from
this Sandbox event-delivery page. Dev then showed the same event with
`receive_count = 2`, `processing_status = PROCESSED`, and
`reconciliation_status = MATCHED`; `last_received_at` advanced to
`2026-11-04 15:37:47.763518+00`.

After the replay, there is still exactly one SUCCEEDED payment row
`96855ac7-0cb9-443d-bda1-1bd8a5b43e4a` for 13,531 minor units, with
`refunded_amount = 0`. `job_queue` still has one order-confirmation email and
two `SEND_PUSH` jobs for this order; their original job IDs and attempt counts
are unchanged. The customer push still has its original three attempts and
terminal Expo receipt error; the tailor push remains `SKIPPED / NO_TOKEN`.
No duplicate payment or notification jobs were created. C1 still remains
incomplete on actual push delivery and device-side taps; do not count the
tailor push as delivered.

#### UI polish observations — 2026-11-04

These are review candidates from the screenshots, not confirmed functional
defects. The customer order screen repeats the placed state in the green order
banner, progress timeline, status card, and the separate “Payment confirmed”
sentence. The same screen then presents long “Event emergency” and “Pickup
plan” explanation panels. This may be more copy than a customer needs while
checking a newly paid order; product/design can decide which explanation is
useful and where it belongs. Evidence:
[customer order screen](evidence/c1-ios-customer-order-DRP2710RP-20261104.png).

The Pixel screenshot shows the Account Recovery form, with a large explanatory
“Secure from request to reset” card. The Pixel was not authenticated as the
tailor, and the tailor push had no token, so this is only a visual note and does
not establish a broken order-notification flow:
[Pixel account-recovery screen](evidence/c1-pixel-account-recovery-20261104.png).
This aligns with the separate app-explainer-clutter feedback thread; keep
future observations concrete (screen, action, visible result) and separate
visual polish from task failures.

During the same simulator inspection, the iPhone 17 Pro showed the customer's
“Change fulfilment → Request delivery” sheet. Its full-width “Replace pickup
with delivery” explanation sits above the form, and the primary action is only
partly visible at the bottom of the initial viewport. This is a layout/polish
candidate: shorten or collapse the explanation and keep the primary action
visible. The sheet was left unsubmitted. A screenshot was visible during the
inspection but could not be exported from the simulator because
CoreSimulatorService was unavailable; do not treat this note as the required
visual proof for a functional test.

#### C1 fabric transfer read-only status recheck — 2026-11-04

Read-only Dev queries for order `DRPZHHLGH`
(`8731637d-ac84-419b-8397-b2c62f878c50`) show fabric candidate
`8c3137c9-41c5-43a3-8636-cf381cb65a3f` is `RECONCILED` with exact reconciliation,
`provider_attempt_number = 2`, and transfer `tr_3UXQPICrvCJ1ybBB1mFkMvjO`.
The transfer is 8,000 USD minor units to `acct_1UWKMoEBcTE5DZFb`, and its
`source_transaction` is `ch_3UXQPICrvCJ1ybBB1tU7m5NM`. Exactly two fabric payout
rows exist: original payout `60eae409-8419-464f-967d-a3bb9f9d69da` is
`FAILED / TRANSFER_NOT_FOUND`; retry payout
`78f6352d-2c22-43f0-ab4e-0b7793b846e4` records that transfer and
`AVAILABLE_IN_PROVIDER_BALANCE`. Its row-level payout status remains
`PROCESSING`, which is the expected Stripe state in
`supabase/functions/_shared/fabric-release.ts` for a confirmed platform
transfer before bank withdrawal; this is not a stuck payout. Ledger transaction
`674ee2f4-f814-4400-8d35-1b057d72ce00` has one 8,000 USD debit to
`MATERIAL_ADVANCE_LIABILITY` and one matching 8,000 USD credit to
`TAILOR_RELEASED`, linked to the same transfer. No second transfer was found
in the recorded candidate/payout rows. This closes the fabric-material
advance leg only; the order's 70/20/10 settlement tranches remain `LOCKED`, and
C1 still needs its dispatch quote, custody/receipt evidence, 80% tranche, and
remaining customer/tailor/Ops UI proof.

The Stripe API connector remains attached to a different Sandbox account and
could not retrieve this PaymentIntent. The replay was therefore performed
from the signed-in Stripe Dashboard Sandbox endpoint that visibly targets
`pqptfuqogvrajozfsqzi`, rather than from the mismatched API connector.

### Current checkpoint — 2026-11-04

This checkpoint supersedes the earlier summary for the newer `DRP2710RP`
ready-made payment only. It does not convert the fabric tranche C1 run or the
other cases into passes.

| Area | Current status | Evidence / remaining proof |
| --- | --- | --- |
| A–B | NOT REVERIFIED | The original A/B evidence remains outside this current verified run. |
| C1 | PARTIAL | Ready-made checkout/payment and balanced ledger capture passed for `DRP2710RP`; C1's separate custom-order fabric/tranche workflow remains incomplete. The exact succeeded event replayed once: Dev `receive_count=2`, still one payment and the original 3 notification jobs. Customer Expo receipt ended `DELIVERY_ERROR / DeveloperError`; tailor push was `SKIPPED / NO_TOKEN`. Neither device tap is proven. |
| C2 | NOT REVERIFIED | Prior C2 fix/review history exists, but no current end-to-end payout event was exercised in this checkpoint. |
| C3–C7 | BLOCKED / NOT REVERIFIED | Require qualifying payout/adjustment fixtures and/or two-person approvals; no new case flow was run here. |
| D1–D7 | BLOCKED / NOT REVERIFIED | No new refund/dispute race or consultation refund case was run here; D4 remains quarantined. |
| E1–E3, E5–E7 | BLOCKED / PARTIAL | No new MFA-gated money action or generated failure case was exercised. Earlier Ops/MFA and alert limitations still apply. |
| E4 | PARTIAL PASS | The `DRP2710RP` Stripe TEST capture reconciles exactly at 13,531 minor units in the application ledger. A complete regression-wide Stripe/ledger reconciliation is still outstanding. |
| F1–F3 | PARTIAL | The iOS customer order screen showed the paid/placed order. Tailor Pixel and web money timelines were not verified for this order. |
| G1 | PARTIAL / NOT REVERIFIED | No new failure-alert delivery was generated or verified. |

### Current defect / release blockers, ranked — 2026-11-04

1. **Notification delivery / observability:** the customer Expo receipt is a
   terminal `DeveloperError`, the tailor push is skipped because no token is
   registered for the recipient, and the audit view nevertheless reports the
   customer push as `DELIVERED`. Device delivery and both taps remain unproved.
   This blocks the notification portion of C1 but is not evidence of money
   loss.
2. **Regression coverage remains incomplete:** C1's fabric tranche and cases
   C2–C7, D1–D7, most E checks, and F/G require real fixtures and cross-role
   verification. No status is upgraded based only on prior chat reports.
3. **Notification device proof:** C1 webhook replay preserved payment and job
   counts, but the customer Expo receipt is terminal `DeveloperError`, the
   tailor has no registered push token, and neither device tap is proven.
4. **Ops / alert surface:** the direct order-keyed `ops_issues` lookup was
   empty; broader Ops UI and alert delivery were not verified for this order.

The ready-made payment itself has no detected amount discrepancy or duplicate:
one 13,531-minor-unit payment and one balanced capture are recorded. The full
regression remains **NOT READY FOR PRODUCTION**. No Production action was
performed.

### D1 candidate preflight — read-only, 2026-11-04

The newly paid order `DRP2710RP` / `2262fb96-897f-4d6e-888d-d39614547e2d`
has payment `96855ac7-0cb9-443d-bda1-1bd8a5b43e4a` in `SUCCEEDED` for 13,531
USD minor units. Read-only Dev queries found no `payout_claims` or `payouts`
rows for this order, so no payout is recorded before the proposed refund test.
The customer self-cancel action is not allowed once an order is confirmed;
the supported path is a customer cancellation-review request followed by a
Money Desk `CUSTOMER_REFUND` request and its required two-person approval.
No cancellation review or refund has been initiated. This order remains in
use for C1 notification/device evidence until the owner chooses the refund
test path; do not silently consume the fixture.

#### #112 Dev rollout and ready-made push preflight — 2026-11-04

Read-only Dev Edge Function inventory confirms the four #112 functions are
deployed from merged main commit `60c9f67d6f26d7c18e6cf6ddb635f329683c8704`:
`stripe-webhook` v159 (SHA
`055fdc667de857c22a026f902cc496b7b511347605fbc11f54f98c2f3f6754d9`),
`paystack-webhook` v110 (SHA
`680b95cb8f0cf15a595bf4088c58bf0f4212df3c3684a49612833f2112790e94`),
`payment-action` v126 (SHA
`18951fd8ff20ae9cce74c8591775a4ec23af6c462360edcdd8de54783ac53a04`), and
`process-job-queue` v126 (SHA
`a2573a24ea41be0e9e76aff3d88f6a2456c17a4b04c92906bbbc1333b40a7615`). The
deployments completed around 2026-11-04 13:07 UTC.

The existing ready-made payment `DRP1ME4AJ`
(`a8774cbd-f25c-4c37-b62c-026b1c024aa6`, PaymentIntent
`pi_3UXwFjCrvCJ1ybBB1EyLQVPr`) was confirmed at 13,531 USD minor units, but
its payment and email job completed around 2026-11-04 05:00 UTC, before the
#112 deployment. It is therefore not valid proof of the new push path. Its
notification audit has only the confirmation-email outcome; there are no
order-keyed push jobs or inbox rows to verify for that payment. Do not replay
or count it as the post-deploy push proof.

Current read-only token inventory has one iOS push token for the QA customer
(`868691e8-90df-4de4-9714-b4f8f328d2f0`, updated 2026-11-04 14:02 UTC) and no
token for this order's tailor. On the Pixel 8, the foreground app is the Dev
package `com.drape.app.studiodev`, currently displaying Account Recovery;
the tailor session and push token are not active. No new payment or
notification was created during this check. A fresh post-deploy ready-made
payment and both-device delivery/tap proof remain incomplete.

A post-deploy checkout attempt on the same item produced order
`DRP251A57` (`23698406-9c61-4708-809f-cbd08ad3fef7`) and payment row
`2136cdf1-6907-4fd4-900a-b9cb93c8e109`. The 13,531-minor-unit Stripe TEST
PaymentIntent `pi_3UY40zCrvCJ1ybBB0F5IFs0i` was created at 13:14:09 UTC and
canceled at 14:05:02 UTC; the Dev order is `EXPIRED`, the payment row is
`CANCELED`, and it has no `confirmed_at`. In the Stripe TEST Dashboard for
account `acct_1TGkS0CrvCJ1ybBB`, the PaymentIntent shows **Canceled** and
**Payment method: Missing**, with only create and cancel activity. There are
no commercial ledger transactions for this order. This is an abandoned
pre-capture attempt, not a successful push test; no money was captured and no
push jobs were expected. The screen the customer saw before abandonment was
not recorded, so that UX detail remains unknown.

Read-only Money Desk identity preflight separately confirms two active Dev
workforce principals bound to two distinct Auth users, with current access
reviews and a verified TOTP factor for each. No password, TOTP seed, code, or
session value was read. The repo's `docs/dev-e2e-accounts.md` still says the
second principal was not provisioned; that runbook statement is stale and is
logged for a docs-only follow-up. This does not supply an authenticated Pixel
tailor session.

##### Pixel session recheck — 2026-11-04 16:24 UTC

Read-only ADB screenshot confirms the Dev app is currently at its ordinary
sign-in screen, with blank email and password fields and the security check
completed. No credentials or MFA code were entered. A fresh read-only
`push_tokens` query still finds the QA customer's iOS token (updated
2026-11-04 14:02 UTC) and no token row for the tailor user. The current
screen is captured at
[`pixel-dev-tailor-signed-out-20261104.png`](evidence/pixel-dev-tailor-signed-out-20261104.png).
The Pixel-side push delivery and tap proof therefore remains blocked on a
normal authenticated tailor session; no new payment, notification, or money
state was created or changed.

##### Push outcome and Pixel sign-in recheck — 2026-11-04 16:39 UTC

Read-only follow-up for paid order `DRP2710RP`
(`2262fb96-897f-4d6e-888d-d39614547e2d`) found both `SEND_PUSH` jobs and
the two correctly routed inbox rows:

- Customer job `06681a89-0d3d-4527-a1aa-76787f000663` ended with queue status
  `SUCCEEDED` after 3 attempts, but its last Expo attempt
  `10d04ba2-2454-41d4-9554-6468eeb98fca` is `DELIVERY_ERROR /
  DeveloperError / BadDeviceToken`; no provider acceptance was recorded.
  The two earlier attempts (`470fc35d-abd3-4834-a552-b48b7ffe207b` and
  `d3b1f6e8-f177-4db3-bc8c-fc8d0ad2358d`) were `TICKET_ERROR /
  InvalidCredentials`.
- Tailor job `76805a03-298b-446a-92e6-1653168a3d58` ended `SUCCEEDED` after
  one attempt, but there is still no registered tailor push token and no
  corresponding `push_delivery_attempt` row.
- Confirmation email job `a50b3dc7-2c00-4488-b55c-f4e8760382da` ended
  `SUCCEEDED`; its email outcome is `ACCEPTED`.
- Customer inbox row `8714ae5a-3f28-429a-8c3a-a21bfcb560fd` and tailor inbox
  row `dfc5949c-e895-478b-90a2-2173c6948558` both route to
  `ORDER_DETAIL` with this order ID. Neither row has been read. This proves
  inbox creation/routing, not a device tap.

On the Pixel 8, one normal sign-in using the ignored local QA regression-tailor
credential file reached the app's MFA verification screen; the password was
not echoed or committed. The 30-day device-trust option was left off. No MFA
code was entered. The authenticated tailor session and Pixel push token remain
unavailable until the MFA challenge is completed on the device. No payment,
notification, inbox, or review state was changed during this recheck.
