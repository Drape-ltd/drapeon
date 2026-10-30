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
