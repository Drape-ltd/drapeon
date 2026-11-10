# Stripe / Ops regression — October 2026

Environment: Supabase Dev `pqptfuqogvrajozfsqzi`; Stripe test mode only for
mutations. No Production writes, migrations, deployments, or live-mode changes
were made. The explicitly approved read-only Production inventory is below.

## Production migration ordering (plan only; nothing applied)

The later source-derived [November readiness draft](stripe-ops-production-readiness-draft-2026-11.md) inventories all merged migrations through #134. An owner-approved read-only Production check on 2026-11-10 confirmed the 12 `20261029*` versions, zero later source versions, zero route rows, and zero candidates in the four scoped backfill previews. The draft is **not** a release authorization; repeat the preflight against the final merge SHA before any batch.

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

The authorized read-only inventory found **3** Stripe LIVE connected accounts:
**2** linked to Prod tailor profiles and **1** unmatched orphan. All 3 were
restricted, with $0 balance/volume and no bank account. The Prod database
had **10** profiles with `payout_provider = 'STRIPE'` and no saved
`stripe_connect_account_id`. Account and profile identifiers are retained
only in the private Ops ledger. Nothing was deleted or edited.

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
case was opened as `founder Ops principal` with `Workforce verified`. A local-only
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
`founder Ops principal` → `3eef54ba-7b15-4b51-b74d-a181249d7fcb`;
`first QA Ops principal` → `6ea3cf4c-48c1-4d6f-90ca-b41f0cf2aea4`.
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
(`[Prod orphan connected account; private Ops ledger]`), and 10 Prod tailor profiles with
`payout_provider='STRIPE'` but no `stripe_connect_account_id`. No Production
query or action was performed in this follow-up.

### Production inventory reminder (read-only, previously approved)

The earlier read-only Production inventory remains unchanged: Stripe Live had 3
connected accounts, of which 1 (`[Prod orphan connected account; private Ops ledger]`) had no matching Prod
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
  `first QA Ops principal` at AAL2;
- second approval event `2b286c9d-1663-4fe0-9984-e37669c33367` by the
  distinct AAL2 principal `second QA Ops principal`;
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

Both durable `SEND_PUSH` jobs reached `SUCCEEDED`:

- customer job `06681a89-0d3d-4527-a1aa-76787f000663`, attempt 3; Expo ticket
  `01a1a6f2-ef5e-7368-b769-b0cabd4e68e7` was `TICKET_ACCEPTED`, provider
  accepted at `2026-11-04 14:25:01.465897+00` after two
  `InvalidCredentials` ticket errors.
- tailor job `76805a03-298b-446a-92e6-1653168a3d58`, attempt 1; it completed
  without a `push_delivery_attempt` or provider ticket. This is not proof of
  push delivery. The Pixel Preview app has no Firebase client configuration
  for `com.drape.app.preview`, so it has no registered token.

Current device screenshots were captured 2026-11-04. The iOS Simulator is
still on the paid customer order page for `DRP2710RP`:
[iOS customer order view](evidence/c1-ios-customer-order-DRP2710RP-20261104.png).
The Pixel 8 is on Account Recovery, not the tailor order view:
[Pixel account-recovery state](evidence/c1-pixel-account-recovery-20261104.png).
No account recovery or credential change was attempted.

The customer iOS token row was fresh before payment
(`868691e8-90df-4de4-9714-bf8f328d2f0`, updated
`2026-11-04 13:12:07.252`). APNs ticket acceptance is recorded, but device
receipt and tap-to-order navigation have not been proved. The tailor
notification tap on Pixel is also unverified. Its inbox link is correct in the
database, but this does not satisfy physical-device delivery and tap
verification.

Webhook replay/no-duplicate verification remains pending; no replay was
performed in this follow-up. C1 remains incomplete on notification delivery
and device-side proof. Do not count the tailor push as delivered.

The connected Stripe MCP test context exposes enabled endpoint
`we_1TGm93Csuzt4qHXRpwUiNjzU` at the expected Dev URL
`https://pqptfuqogvrajozfsqzi.functions.supabase.co/stripe-webhook`, with
`payment_intent.succeeded` enabled. However, that account returns “No such
payment_intent” for `pi_3UY4tMCrvCJ1ybBB0fuZdIz4`, and likewise did not resolve
the Dev event ID. The endpoint listing therefore confirms its URL/config only;
it does not establish that this is the platform account that processed this
order. No event resend was attempted from the mismatched context.

### Current checkpoint — 2026-11-04

This checkpoint supersedes the earlier summary for the newer `DRP2710RP`
ready-made payment only. It does not convert the fabric tranche C1 run or the
other cases into passes.

| Area | Current status | Evidence / remaining proof |
| --- | --- | --- |
| A–B | NOT REVERIFIED | The original A/B evidence remains outside this current verified run. |
| C1 | PARTIAL | Ready-made checkout/payment and balanced ledger capture passed for `DRP2710RP`; C1's separate custom-order fabric/tranche workflow remains incomplete. Customer APNs ticket accepted, but device receipt/tap, tailor provider push/tap, notification terminal outcomes, and webhook replay are outstanding. |
| C2 | NOT REVERIFIED | Prior C2 fix/review history exists, but no current end-to-end payout event was exercised in this checkpoint. |
| C3–C7 | BLOCKED / NOT REVERIFIED | Require qualifying payout/adjustment fixtures and/or two-person approvals; no new case flow was run here. |
| D1–D7 | BLOCKED / NOT REVERIFIED | No new refund/dispute race or consultation refund case was run here; D4 remains quarantined. |
| E1–E3, E5–E7 | BLOCKED / PARTIAL | No new MFA-gated money action or generated failure case was exercised. Earlier Ops/MFA and alert limitations still apply. |
| E4 | PARTIAL PASS | The `DRP2710RP` Stripe TEST capture reconciles exactly at 13,531 minor units in the application ledger. A complete regression-wide Stripe/ledger reconciliation is still outstanding. |
| F1–F3 | PARTIAL | The iOS customer order screen showed the paid/placed order. Tailor Pixel and web money timelines were not verified for this order. |
| G1 | PARTIAL / NOT REVERIFIED | No new failure-alert delivery was generated or verified. |

### Current defect / release blockers, ranked — 2026-11-04

1. **Notification delivery proof / Android configuration:** the tailor push
   job for `DRP2710RP` completed without a provider attempt because Pixel
   Preview has no Firebase client for `com.drape.app.preview`; the customer
   APNs ticket has no device receipt or tap proof. This is currently a test
   configuration blocker, not evidence of money loss.
2. **Regression coverage remains incomplete:** C1's fabric tranche and cases
   C2–C7, D1–D7, most E checks, and F/G require real fixtures and cross-role
   verification. No status is upgraded based only on prior chat reports.
3. **Webhook replay proof:** the event is recorded once in Dev and source
   deduplication is present, but an authenticated resend of this exact Stripe
   event to the Dev endpoint has not been performed.
4. **Ops / alert surface:** the direct order-keyed `ops_issues` lookup was
   empty; broader Ops UI and alert delivery were not verified for this order.

The ready-made payment itself has no detected amount discrepancy or duplicate:
one 13,531-minor-unit payment and one balanced capture are recorded. The full
regression remains **NOT READY FOR PRODUCTION**. No Production action was
performed.

### D1 refund follow-up — read-only Dev verification, 2026-11-08

This section supersedes the earlier D1 stop status above. The customer
cancellation review was later completed through the two-person Money Desk
flow. No SQL money-state edit was used for the refund.

- Order `DRP1ME4AJ` (`a8774cbd-f25c-4c37-b62c-026b1c024aa6`) is
  `REFUNDED`; its total is **13,531 USD minor units**.
- Payment `9bf7ae52-8a77-4f0f-a090-3e9ca212c7f5`, Stripe TEST
  PaymentIntent `pi_3UXwFjCrvCJ1ybBB1EyLQVPr`, is `REFUNDED` with
  `refunded_amount = amount = 13,531`.
- There is exactly one `CONFIRMED` provider refund,
  `re_3UXwFjCrvCJ1ybBB1vkJGeJu`, for 13,531; one commercial refund
  journal; and one capture journal. Each journal has 13,531 in debits and
  13,531 in credits. There are **zero** payout rows for the order.
- A direct read-only Stripe TEST retrieval on 2026-11-08 confirms that
  `re_3UXwFjCrvCJ1ybBB1vkJGeJu` is `succeeded` for 13,531 USD minor
  units, attached to the recorded PaymentIntent and charge
  `ch_3UXwFjCrvCJ1ybBB1ELkok50`. Listing that charge's refunds
  returned exactly one row (`has_more = false`), so Stripe has no
  duplicate refund for this charge. No provider write was made.
- The first Money Desk request, `MD-190E7F7F03`, remains `FAILED`.
  The supported replacement `MD-C156312F3D` has two approvals and is
  `SUCCEEDED`. The `ORDER_REVIEW` and false `REFUND_FAILED` Ops cases
  are both `RESOLVED`. All 12 order-keyed notification jobs currently
  read `SUCCEEDED` in Dev. The delivery audit reports seven email
  `ACCEPTED` outcomes, two push `DELIVERED` outcomes, and three push
  `SKIPPED` outcomes with `NO_TOKEN`. The skipped outcomes are terminal
  and explicit; real notification taps were not reverified.
- The iOS Simulator customer order view shows **Refunded** and the
  135.31 USD amount:
  [customer refund screen](evidence/d1-ios-customer-refunded-DRP1ME4AJ-20261108.png).
  Its explanatory paragraph exposes internal QA wording ("Dev Stripe
  TEST D1") and an operator rationale. Log this as a display/copy defect;
  it does not change money state.

**D1 status: PARTIAL / NOT VERIFIED.** The tailor Pixel view, Ops UI,
receipt, and real device taps still need current screenshots or receipts.
Do not promote D1 to PASS from the provider and database counts alone.
## C1 dispatch-refund replay guard rollout — 2026-11-08

PR #123 was already merged as `e33f1932d5b9683199762d3ff7ae7e549248f6d5`. Its shared refund code was deployed to Dev from that exact merged commit through the development target guard. The affected Edge versions and deployment digests are:

| Function | Dev version | Digest |
| --- | ---: | --- |
| bachs-webhook | 25 | `147b701e9a89174abd175f7d84f8d2174c45f02b93473e73ab4e2be9ac9cade7` |
| consultation-lifecycle-action | 45 | `686594db5200e3ad8fa7ae833b4520a00caba29ce9478356448174609c10bd54` |
| customer-order-action | 160 | `8af03c03d2384c5051b8066fc17ffbbd4d974d1c73becb9a5e3214ea8dbfb90f` |
| drapeon-dispatch-action | 46 | `3374f537feee1e8ea78bcac85a2f3c67262efce8e2e1d07b2875032ade06bf6d` |
| ops-money-action | 43 | `97374ba9b2055cc9031d01599002f6198c9eb49fcb4400bbb6ff2d252b7385dc` |
| paystack-webhook | 114 | `81a15de2a34c46a38a65129f587d69295da92490965b52ece53d8db0bfb46947` |
| process-job-queue | 131 | `5e0ca39ae16ef0b39e88dc0420db7ec78881a836c6615f30a1a24ba711ebac13` |
| refund-order-payments | 82 | `89a55ae9138522ae225000a54490793d11f93ed0400b61a557f87ab631acf869` |
| send-consultation-reminders | 70 | `74d7bd51282a83097e3017d8e24250e74c36e73c05caa005e80d530962994ce0` |
| stripe-webhook | 164 | `9709ba63ee756f970b0dd8d4d22983b606cab791105bf8b0f7ba631603452551` |
| tailor-order-action | 189 | `bd1e3fbdb21ae6a997ca73485bf50488fc483e02141c9d9a0644a674d4a5c5d7` |

The existing `PROCESS_DISPATCH_REFUND` job `fa285adc-d1f1-4062-ae33-12fad1bddfb5` was still `PENDING` at attempt 0/8 after deployment. No wake migration has been applied and no refund was manually retried. The separate worker-lane PR #124 remains the gate before this queued $3 Stripe TEST refund can run naturally.

### D1 Ops UI follow-up

A read-only check of the existing Dev Ops browser session found that the new Ops Orders page denied the founder workforce role before loading the order projection. The older Money Desk page reported its internal data service unavailable. Neither page established an Ops-side D1 view. The Mac was locked, so the iOS Simulator and Pixel screens were not rechecked in this pass. D1's remaining UI and device-tap evidence stays **NOT VERIFIED**; the completed Stripe TEST, payment, refund, and journal checks above are unaffected. No protected action was attempted.

On a second browser pass, the new Money page also showed the role-denied screen. My Work returned `AUTHORITATIVE READ UNAVAILABLE` with reference `3570531346`, including after its one safe retry. A Dev database read confirmed the bound principal is `ACTIVE`, has the `admin` role, and has a current access review; the repository's area policy lists `admin` for both Orders and Money. This rules out a missing role assignment, but does not yet isolate whether session freshness or the Ops data gateway caused the denial. No access policy or principal was changed.

The local runtime inventory then showed port 3006 serving the older `deploy-106` checkout and port 3005 serving `deploy-115`; neither was a current-main UI proof. A separate Dev Ops server was started from merged main `e33f1932` on port 3009. It loaded the expected local MFA sign-in gate, so the next UI pass requires a fresh user sign-in there. No protected request or money state was changed during this runtime check.

The founder completed MFA on that merged-main port 3009 runtime. Its order page for `DRP1ME4AJ` showed **Refunded**, payment **$135.31 refunded**, both 80/20 payout controls **Locked**, and no escrow release. This establishes the current Ops order and payment display. The linked `ORDER_REVIEW` case `OPS-02DEFF37`, however, still displayed **New** and an active next action despite its timeline showing **Order Cancellation Refund Completed**. A read-only Dev row check found `ops_issues.status = 'RESOLVED'` and `resolved_at` populated, but `canonical_status = 'NEW'`. The cancellation finalizer changes the legacy `status` without changing `canonical_status`, leaving the canonical queue wrong. D1 therefore remains **NOT VERIFIED** and this case-state defect must be repaired through a reviewed fix; no manual case mutation was made.

Draft PR [#126](https://github.com/Drape-ltd/drapeon/pull/126), head `1f67dafd21e2cc0ddfe9332dead1ce6476697841`, contains the forward finalizer fix and a separate bounded Dev data repair. The finalizer change and its exact rollback passed real isolated PostgreSQL tests for dispute and review paths, pending recovery, and replay; the repair passed an eligible/ineligible/replay fixture. Node 22 launch contracts passed. A read-only Dev preview found **85** legacy-resolved `ORDER_REVIEW` rows with canonical status drift, but only **one** met the strict completed cancellation-refund proof for this repair. The other 84 remain outside this fix. Neither migration has been applied to Dev or Production; D1 remains **NOT VERIFIED** pending review, merge, Dev repair and the remaining receipt/device checks.

The connected Pixel 8 was still signed into the C1 tailor and showed custom order `DRPZHHLGH`. Its Active list contained that order and two other paid ready-made orders; its Completed list did not contain `DRP1ME4AJ`. A read-only Dev order lookup explains why: D1's ready-made order has a **different tailor profile ID** from the C1 order shown on this Pixel. The absent D1 card is therefore not evidence of a listing defect. D1 tailor UI remains **NOT VERIFIED** until the correct seller session is available. The Pixel was returned to the C1 order detail; no order action was taken.

The booted iOS Simulator remained signed into the D1 customer order. Its in-app payment receipt `DRP-2026-00000023` showed **Payment captured $135.31**, tailor work **$125.00**, fulfillment **Free**, TX tax **$10.31**, and total paid **$135.31**, matching the locked payment and ledger to the cent. The receipt explicitly says refunds appear separately; it does not by itself prove a refund receipt or a notification tap. The order page still displayed **Refunded** with internal QA rationale in the customer-facing text. D1 remains **NOT VERIFIED** pending the canonical case repair, correct tailor session, refund-specific customer proof and device-tap checks.

## Current A–G checkpoint — 2026-11-09

This supersedes the 2026-11-04 table. It is a progress snapshot, **not** the final regression report. `NOT VERIFIED` means the full case-level proof in the goal is missing, even where a narrower payment or database assertion passed.

| Case | Status | Current evidence / next proof |
| --- | --- | --- |
| A, B | NOT VERIFIED | Earlier reports are not a current case-by-case, device-and-ledger replay. Bachs is blocked; Paystack legacy-only cases are N/A for new routes. |
| C1 | NOT VERIFIED | The recovered $80 fabric release, synthetic $12 dispatch quote, and one $3 allowance refund are recorded. The 70% custody tranche released exactly $84 once to Stripe, with a balanced journal. Merged-main Pixel earnings now matches Dev at $286 pending and $84 with Stripe. The $24/$12 policy tranches, delivery evidence, exact-order push tap, and genuine courier quote/booking remain open. |
| C2–C7 | NOT VERIFIED | C2's fix history exists, but no complete current Stripe TEST payout event was re-run; C3/C7 need real two-person receipts and eligible fixtures. C4–C6 also lack complete provider/ledger/UI replay. Bachs scenarios remain N/A while its route is blocked. |
| D1 | NOT VERIFIED | Stripe TEST refund, payment status, provider-refund count and balanced journal reconcile at 13,531 minor units. #126 closed the canonical `ORDER_REVIEW` case with one transition event. The iOS customer refund record shows $135.31. The correct tailor session and exact-order tap remain open; two historical refund push jobs falsely say DELIVERED despite Expo `DeveloperError` receipts. |
| D2–D7 | NOT VERIFIED | No complete current refund/dispute/consultation fixture and cross-role proof. D4's earlier synthetic tip fixture was rejected and remains quarantined. |
| E1–E7 | NOT VERIFIED | Some Money Desk and audit assertions passed in D1, and E4 has narrow exact-cents captures. Full MFA, failure queue, route switch, regression-wide ledger reconciliation, audit and solo-operator passes remain. |
| F1–F3 | NOT VERIFIED | Some customer mobile order/refund screens were seen. Customer, tailor and web money timelines with matching amounts and readable statuses remain incomplete. |
| G1 | NOT VERIFIED | No full Sentry/alert delivery and recovery verification for the tested failure set. |

### Ranked open defects and gates

1. **Stuck money — definite claimed-payout rejection recovery:** #104's reviewed close-out can leave an earning blocked with no supported new-operation path. A separate reviewed Money Desk retry is required before Production; no new provider transfer is authorized by this note.
2. **Notification proof:** tailor/customer device receipt and exact-order tap are incomplete. A terminal job or Expo/APNs acceptance alone is insufficient. Any dead-letter or wrong money-event audit remains a stop condition.
3. **Production release readiness:** the owner-approved, read-only 2026-11-10 inventory confirmed the twelve `20261029*` prerequisites, zero later migrations, disabled routes and zero candidates in four bounded backfills; counts and plan shapes are in `stripe-ops-prod-readiness-2026-11.md`. Missing batch rollbacks, fresh pre-batch checks and explicit release approval remain open. The worksheet is not a release approval.
4. **Display/copy:** the D1 customer refund screen exposes internal QA wording. This is logged for a later UI correction, with no money impact observed.
5. **Other canonical Ops drift:** #126 repaired the one D1 case with completed-refund evidence. The other 84 legacy-resolved `ORDER_REVIEW` rows in the preview were outside that bounded repair and need separate triage before any broad correction.

Read-only Dev follow-up on the definite-rejection gate found **zero** `FAILED_RECONCILED` payout claims at the time of inspection; the only terminal claims returned were one `BLOCKED` order earning and one `BLOCKED` adjustment. The live `start_payout_attempt(uuid,text)` function returns `BLOCKED` for every `FAILED_RECONCILED` claim. The reviewed snapshot-correction RPC is designed for a failed settlement tranche with a **different**, freshly ready destination and confirmed returned-funds evidence. A Stripe `NOT_SENT:<code>` definite rejection with the same corrected account therefore lacks a supported reviewed retry. This is a pre-Production stuck-money path, not evidence that a current Dev earning is stuck. Its fix needs a distinct reviewed retry authorization and a new provider key without reusing operation 1 or weakening the existing destination-correction gate.

**Additional read-only guard finding, 2026-11-10:** The live `a0_claimed_replacement_refund_race_guard` trigger fires on every provider-operation insert after operation 1. Its function requires `source_kind = ORDER_EARNING` and claim status `BLOCKED`. The reviewed snapshot-correction RPC instead inserts operation 2 for a `SETTLEMENT_TRANCHE` claim in `FAILED_RECONCILED`, so that insert would be rejected before a corrected payout could start. No Dev correction request or money state was changed to test this; the conclusion follows from the live trigger definition and the RPC body. Treat destination correction for failed tranches as **NOT VERIFIED / stuck-money defect** until a separate reviewed fix and real Postgres proof exist.

**Proposed guard repair, still awaiting review:** Draft [PR #138](https://github.com/Drape-ltd/drapeon/pull/138) at `24d43471a723bc84d8b41c60a9dc71a9d7447292` adds a narrow guard branch for a reconciled failed settlement tranche and preserves the existing order-earning branch. Its isolated real-Postgres test is red against the live guard and green with the proposed migration; it also covers replay, accounted delivery refund, unsafe funding/refund/dispute states, and exact rollback. `pnpm launch:contracts` and `git diff --check` passed. The rollback file's MD5 matches the Dev live function (`b461ae6ddaa9a6a154a5b6b499d936f0`). The migration has **not** been applied to Dev or Production, and the complete Money Desk correction RPC has **not** been exercised with a failed payout. C7 remains **NOT VERIFIED**.

**Definite not-sent retry, still awaiting review:** Draft [PR #139](https://github.com/Drape-ltd/drapeon/pull/139) at `984d3db6a510e18f7fe6e89b9ee59fea85e1c85e` proposes a distinct two-person reviewed operation 2/3 for a claimed settlement tranche whose prior Stripe operation was definitely not sent. The local Postgres baseline is red on main; the Dev-shaped green fixture reserves and finalizes operation 2, posts one synthetic $84 tailor release, completes its Money Desk attempt, and replays without a duplicate ledger posting. A combined local run applies #138 first and confirms that rolling #139 back preserves #138's guard. This is database proof with a synthetic provider result. No real Stripe TEST transfer, notification delivery, or Ops/tailor UI has been proved for this retry; no Dev or Production migration or function has been deployed. The path remains **NOT VERIFIED** and is not a reason to retry an existing blocked payout yet.

**Dev-only read-only recheck, 2026-11-10 12:53 UTC:** D1's order and single Stripe payment remain `REFUNDED` for 13,531 USD minor units, with `refunded_amount = amount`. The one provider-refund row is `CONFIRMED` for 13,531; both order-linked Ops issues are `RESOLVED`. Money Desk still has one `SUCCEEDED` request and the earlier `FAILED` request. No payment, refund, case, request, or ledger state was changed by this check. The current device session and push receipt were not tested, so D1 remains **NOT VERIFIED**. A count-only inventory of orders created in the prior 14 days found two `PENDING_QUOTE` orders with no payment and three `CONFIRMED` orders with a succeeded payment; none was reused as a D2/C fixture because a fresh app-created fixture and its identity/provenance are required.

**C1 tranche read-only follow-up, 2026-11-10:** The 8,400-cent `SHIP_CUSTODY_70` tranche remains `RELEASED`. The 2,400-cent `SHIP_DELIVERY_20` and 1,200-cent `SHIP_PROTECTION_10` tranches remain `LOCKED`, each with no `eligible_at`, payout or blocked reason. This query moved no money and does not count either remaining tranche as tested.

## C1 natural dispatch refund after #124 — 2026-11-09

PR #124 merged as `c87b27e810d791b8a48ac87b80f7eac0c0dba864`. Dev rollout followed the reviewed order: the 11 affected Edge functions from merged main, retry schema migration `20261108224000`, the same function build and Ops web, then wake migration `20261108224518` last. Both migrations are recorded under their repository versions in Dev. The Ops web served a 200 from the merged-main build; no Production deployment occurred.

| Dev Edge function | Version | Digest |
| --- | ---: | --- |
| customer-order-action | 162 | `e34b2a826f3863c7aa637cab0d4acc89d105ff35dab1307c039a0b2b10d6857b` |
| tailor-order-action | 191 | `ff6e0b67581c1b260d4d7fded5d4c6fa605bb07ebbf83daf3607b95a138ebc96` |
| stripe-webhook | 166 | `6666231658f555d257bd9c851cc694055caec04e0d9820e875bd497e1bf64bf7` |
| paystack-webhook | 116 | `a4df06e732da83467d8c37b1e9a6ff2aa7209b7bdb9c5d88eb25f0b50b73ab51` |
| refund-order-payments | 84 | `086fbbe902402e333c929e0619d34031a97dc0e7773e8779b9da2607d13d8bed` |
| send-consultation-reminders | 72 | `3624d692286aab8b53aa2a2b7d3278893e0a750b5d25cdb7549606d899cf56f3` |
| process-job-queue | 133 | `b86986c0218355be0a74624494ccaec3b9dab3336dd8eaf3db7b4c136e7c900f` |
| consultation-lifecycle-action | 47 | `dc4a32fa4a1ff481484696c93554eee6dee37a6c508cbdf9234c81d303ae8ede` |
| drapeon-dispatch-action | 48 | `b1bbeeced843409d3cf7e1158cd5339c4d442c004c0c9793fcb5226ceae5710a` |
| ops-money-action | 45 | `16a91c7fda16db522b00e674b78a921f2443634a03382ac4173281fca73f814e` |
| bachs-webhook | 27 | `04d473f23637690c22616c08c63eff31f83a83e487ade99f5c6ed3dcc00a1b1d` |

Before the wake migration, job `fa285adc-d1f1-4062-ae33-12fad1bddfb5` was PENDING at attempt 0/8, run `4cfd7d5f-6e04-4081-bb8c-b3fc58422256` was QUEUED for 300 USD minor units, and payment `cf304211-cb7b-42da-85d3-858bdcea1179` had zero refunded. There was no provider-refund row, refund journal or reviewed retry operation. No manual job retry or refund was made.

The existing `process-money-jobs-recovery` cron ran at 02:41 UTC. The queued job finished SUCCEEDED on attempt 1, and the run became SUCCEEDED with `customer_provider_refund_id = re_3UXQPICrvCJ1ybBB1ntZClPO`. Direct read-only Stripe TEST retrieval found that refund succeeded for 300 USD minor units on the original PaymentIntent. Listing refunds for that PaymentIntent returned exactly one refund with `has_more = false`. Dev has one CONFIRMED provider-refund row for 300, the payment is PARTIAL_REFUND with `refunded_amount = 300`, and exactly one REFUND journal for 300 whose debits equal credits to the minor unit. The retry-operations table has zero rows for this run.

The customer refund email and push jobs each completed SUCCEEDED on attempt 1; their initial send results were ACCEPTED. Subsequent Expo receipt reconciliation changed the push's terminal outcome to DEAD / DeveloperError; see the correction below. The signed Stripe `refund.created` and `refund.updated` events were processed. A supported resend of the same TEST `refund.created` event increased its receive count from one to two. After replay, Dev still had refunded amount 300, one provider-refund row, one refund journal and zero retry operations; a fresh Stripe TEST list still returned exactly one 300-cent refund. **The dispatch-refund worker gap is fixed and the $3 refund money check passes.** The customer push delivery check fails. C1 as a whole remains incomplete: custody, tranche release, device taps and genuine courier booking still need proof. #126's Dev changes were held until this result was reported.

## D1 canonical review closure after #126 — 2026-11-09

PR #126 had merged as `4bc350b77fc1b2ee23349ba59708d5ab5a0d37ed` before the C1 result was reported; its Dev migrations were held until after the C1 refund proof above. Before apply, Dev's live `finalize_ops_order_cancellation_refund(uuid,uuid,text,text,text)` retained the dispute-ID, order-UUID and null `resolved_by` fixes, and lacked the canonical close. A read-only preview of the repair's complete eligibility predicate selected exactly one issue.

Dev-only migrations `20261109013000` (forward finalizer) and `20261109013500` (one-row data repair) were applied in that order and recorded under their repository versions. The live finalizer now has the canonical close and still has all three earlier fixes. D1 issue `bfafd1d7-1918-4945-a183-18baba113d57` now has both `status` and `canonical_status` RESOLVED. Exactly one `ops_case_events` STATE_TRANSITION records NEW → RESOLVED under the repair idempotency key. The repair created zero new provider-refund rows and zero new notification jobs for the order. This clears the canonical Ops-case defect; D1 still needs the remaining receipt, correct tailor session and device-tap checks before a whole-case PASS.

The booted iOS Simulator was rechecked after the case repair. The Dev customer Completed list still labels `DRP1ME4AJ` **Refunded** at $135.31; its [order detail](evidence/d1-ios-customer-refunded-after-case-close-20261109.png) shows the same status. The Receipt control opens the original **Payment captured $135.31** receipt with $125.00 tailoring, free fulfillment and $10.31 TX tax, and says refunds appear separately. It is not a refund-specific receipt or a notification-tap proof. The customer-facing cancellation rationale still includes internal Dev QA wording. D1 remains **NOT VERIFIED** for the refund-specific customer proof, correct seller view and device taps.

## C1 synthetic booking and custody handoff — 2026-11-09

With the founder's fresh Dev MFA session, the Ops dispatch queue recorded a clearly labeled synthetic BOOKED event for `DRPZHHLGH` at 02:57:52 UTC. The provider remains `Drapeon Test Courier (synthetic)`; reference `SYNTH-C1-BOOK-20261109T025743Z` and tracking number `SYNTH-C1-TRACK-001` are test-only. The customer and private Ops notes explicitly say no real courier was contacted or booking made. Fulfillment run `4cfd7d5f-6e04-4081-bb8c-b3fc58422256` moved READY_TO_BOOK → BOOKED. The event idempotency key is `ops:dispatch-event:8731637d-ac84-419b-8397-b2c62f878c50:BOOKED:2ed3a744978e2b7df4d40976`. Its two push and two email jobs all reached SUCCEEDED on attempt 1, with terminal ACCEPTED delivery outcomes. Both pushes carry `ORDER_DETAIL` and the exact order ID. A real device receipt/tap is still unverified.

The locked settlement plan for this order is `SHIP_CUSTODY_70` $84.00, `SHIP_DELIVERY_20` $24.00 and `SHIP_PROTECTION_10` $12.00, all still LOCKED before custody. This is the actual 70/20/10 snapshot; older C1 wording of “80/20” does not describe this order's saved plan. The next form is prepared with a PNG labeled **SYNTHETIC TEST CUSTODY — DEV ONLY / NO PHYSICAL HANDOFF**. No custody event or tranche release has been recorded yet. Genuine courier booking and physical custody proof remain separate prelaunch gates.

### Synthetic custody acceptance — 03:08 UTC

The owner submitted the prepared Dev Ops `CARRIER_ACCEPTED` update. Event `246c132d-cc41-45b5-9d04-06270686b785` and settlement evidence `8f88c1e4-4f7f-4394-9585-d35bd6c2045a` were recorded at 03:08:10 UTC, using the synthetic tracking reference and proof. The fulfillment run is now `IN_TRANSIT` with `custody_accepted_at = 2026-11-09 03:08:10.853+00`. A read immediately after the click briefly returned the previous `BOOKED` projection; a subsequent read returned the new state and timestamp. No repair or replay was performed.

The $84 `SHIP_CUSTODY_70` tranche `e338e2ee-c4c6-4feb-b987-7a5d0bb34a5c` is `ELIGIBLE`, with `eligible_at` equal to the custody time. It has no payout or Money Desk request yet. The $24 delivery and $12 protection tranches remain `LOCKED`. All four custody email/push jobs reached `SUCCEEDED`; real device receipt and exact-order taps remain unverified. No $84 transfer has been sent. The next step is the supported two-person `PAYOUT_RELEASE` request for this eligible tranche, followed by Stripe TEST, ledger, notification and replay checks. This is still **C1 NOT VERIFIED**, and genuine courier booking and physical custody remain separate launch gates.

### Reviewed custody release prepared — 03:29 UTC

The founder reverified Dev MFA after the prior Ops session expired; an earlier elevation attempt created no grant, request, payout or transfer. A fresh 15-minute Money Desk grant was issued through the Ops UI at 03:28:39 UTC. The same UI prepared `PAYOUT_RELEASE` request `MD-F6EAF5DCEC` (`89314aab-9f69-4ed1-9534-a7e8605c546c`) for only the eligible $84.00 USD custody tranche, with an explicit synthetic-proof reason. Read-only Dev verification found `PENDING_APPROVAL`, 0 of 2 approvals, no tranche payout, and no transfer. The founder is the preparer and cannot approve this request; two distinct eligible QA approvers must decide it through MFA before execution. No money action has executed.

### C1 handoff recheck — 2026-11-09

A later read-only Dev check still found `MD-F6EAF5DCEC` at `PENDING_APPROVAL`, 0 of 2, for 8,400 USD minor units. Tranche `e338e2ee-c4c6-4feb-b987-7a5d0bb34a5c` remained `ELIGIBLE` with no payout or linked request. The 15-minute preparation elevation has expired; it does not substitute for the two independent decisions or a fresh execution elevation. No transfer has been sent. C1 is **NOT VERIFIED** pending the two QA approvals, supported execution, Stripe TEST and ledger reconciliation, replay, and device taps.

At this recheck, `adb devices -l` listed no connected Pixel. The restricted shell initially could not connect to CoreSimulatorService, but a direct local check confirmed the iPhone 17 Pro Simulator was booted. In the signed-in Dev customer app, `DRPZHHLGH` appeared in Active orders at $232.74 with an **Out for Delivery** label. Its detail showed **Drapeon Dispatch — On the way**, **Fabric complete**, and the explicit synthetic-custody note. The [customer custody screen](evidence/c1-ios-customer-custody-DRPZHHLGH-20261109.png) records that state. An initial `Network request failed` development toast cleared and the order detail finished loading; this observation alone does not prove a persistent network defect. This is a direct customer-screen check, **not** a push receipt or tap. Pixel receipt and exact-order tap proof for C1 and D1, and the remaining D1 refund-specific view, remain **NOT VERIFIED**.

### Android preview Firebase gate — 2026-11-09

The `preview` EAS profile uses package `com.drape.app.preview` and the Dev Supabase project. EAS has a `GOOGLE_SERVICES_JSON` variable in its preview environment, but the prior preview build showed that its Firebase client list does not include that package. The Firebase console required a fresh Google sign-in during this recheck, so no registration or credential change was made. The Firebase CLI was logged in but could not list projects; that does not establish whether the account has project access.

Owner console steps, confined to the **Dev Firebase project**: (1) open [Firebase console](https://console.firebase.google.com/), select the Dev project and use **Project overview → Add app → Android**; register the exact package `com.drape.app.preview`; (2) download the updated `google-services.json` from that app's settings; (3) in the Drapeon Expo project's **Environment variables**, replace only the preview `GOOGLE_SERVICES_JSON` file value with that downloaded config; (4) in **Project settings → Credentials → Android**, select or add `com.drape.app.preview` and attach the existing Dev-project FCM V1 service-account key if one is already available, otherwise follow the reviewed key-creation process; (5) rebuild the Android preview APK from merged main and verify token registration and a real push tap. The config and any service-account key stay out of Git and chat. These steps follow [Firebase Android registration](https://firebase.google.com/docs/android/setup), [Expo environment files](https://docs.expo.dev/eas/environment-variables/manage/), and [Expo FCM V1 credentials](https://docs.expo.dev/push-notifications/fcm-credentials/). **Preview push remains NOT VERIFIED** until the rebuilt app proves it.

## Dev rollout order and notification correction — 2026-11-09

The Dev migration registry confirms #124's `20261108224000` and `20261108224518`, followed by #126's `20261109013000` and `20261109013500`. The registry has no application-time column and Postgres commit timestamps are disabled, so exact migration-application times cannot be recovered from it. #124 merged at 02:21:04 UTC; its wake migration was in place before the natural dispatch-refund job completed at **02:41:03 UTC**. The run recorded the refund at **02:41:05 UTC**. #126 merged at 02:21:45 UTC, but its **Dev application was held until after the $3 refund proof**; its one-row repair was verified before the 02:50 UTC evidence commit. Thus #126 was merged before the refund finished but applied to Dev after it. No exact per-migration application timestamp is claimed.

Read-only Dev recheck confirms the C1 run `4cfd7d5f-6e04-4081-bb8c-b3fc58422256` is SUCCEEDED with one confirmed Stripe TEST refund of 300 minor units (`re_3UXQPICrvCJ1ybBB1ntZClPO`), and its payment remains PARTIAL_REFUND with `refunded_amount = 300`. The refund job finished SUCCEEDED on attempt 1. There are zero reviewed dispatch-refund retry operations. The refund journal transaction `d10e47a4-e00e-4197-ab92-132f0d559155` has a 300 debit and a 300 credit. The earlier signed-webhook replay left one provider-refund row and one journal, with no second provider refund.

**Correction to the earlier notification claim:** the customer refund email job `ad7282da-68d0-40a1-8629-0dba704e9b62` is SUCCEEDED with terminal delivery **ACCEPTED**. The push job `54eaf17c-82ec-4fc8-ae65-fdddd0fdd458` is marked SUCCEEDED by the queue, but Expo receipt reconciliation later set its delivery outcome to **DEAD / DeveloperError** at 03:13:01 UTC. Its one delivery attempt targeted an iOS token and recorded APNs `BadDeviceToken` (HTTP 400); no token value is recorded here. The earlier ACCEPTED value represented the initial send result, not the final receipt. This establishes a failed iOS delivery, not a second refund or an amount mismatch. C1 remains **NOT VERIFIED**, and the notification stop rule is active. No notification replay or money action was attempted during this recheck.

The #126 D1 repair remains bounded: case `bfafd1d7-1918-4945-a183-18baba113d57` has both statuses RESOLVED and exactly one STATE_TRANSITION event. The Dev recheck found no later D1 ledger entry or notification job; the prior bounded repair proof found no new refund, payout, transfer or survey. D1 still lacks its refund-specific customer proof, correct tailor view and exact-order device taps, so it remains **NOT VERIFIED**.

Both local Dev web runtimes were restarted from the same merged-main commit `e2b2a8b51e9dae43a0b84da9758c5d079a216c0b` in a new isolated checkout. Ops on `127.0.0.1:3006` started at **2026-11-10 02:06:12 UTC** using `dev:mfa` settings; web Ops on `127.0.0.1:3005` started at **02:06:24 UTC**. Both returned HTTP 200 and their listening processes have working directories in that checkout. Earlier UI observations from the stale port-3006 checkout do not count as current-build proof and require repetition. No Production operation or Dev money mutation occurred in this restart.

The booted iPhone 17 Pro Simulator was rechecked on the D1 customer order after the restart. It still shows **Refunded** for `DRP1ME4AJ`; its Receipt control opens the original **Payment captured $135.31** document, which says refunds appear separately. No separate refund receipt was visible in that control. The order status card still exposes the internal Dev QA rationale to the customer. This confirms the display gap, not a new payment discrepancy. `adb devices -l` found no connected Pixel, so the correct seller view and real device notification tap remain unverified. The 15-minute local MFA session was not renewed for this read-only pass, so current-build Ops UI proof also remains open.

The existing $84 C1 Money Desk request `MD-F6EAF5DCEC` remains PENDING_APPROVAL at 0 of 2, with no decisions. Its founder preparer is distinct from the bound QA principal used for an earlier attempted approval, but that QA elevation has since expired. The previous generic UI error did not leave a decision receipt; its exact cause is not established by the read-only rows. No further MFA prompt or approval attempt should be made until the current-build UI can show the specific failure and the grant is freshly renewed. A read-only Ops-case lookup found no case linked to the failed refund push job; G1 alert coverage is unverified.

### C1 resumed with iOS push gap — 2026-11-09

The founder authorized C1 to resume in Dev despite the terminal iOS `BadDeviceToken` receipt. This is a known **iOS push NOT VERIFIED** gap; it does not change the reconciled $3 refund or authorize a Production release. The Pixel 8 is connected and accepted by ADB for the Android/customer and tailor checks.

Read-only Dev search of `ops_issues` found **no alert for the 2026-11-09 receipt** under the title `Push provider rejected beta notification deliveries` or the `push-receipt-errors:` dedupe prefix. It found only the older, RESOLVED case `OPS-189D3FA7` from 2026-09-08 with `DeveloperError` and aggregate counts. The current `process-push-receipts` alert metadata contains error codes and counts, but no attempt, job or order identifiers. G1 alert coverage for this receipt therefore remains NOT VERIFIED. Two follow-up defects are recorded without a fix in this regression: repeated `BadDeviceToken`/`DeveloperError` failures do not mark the token suspect, and the alert cannot identify the affected money event from its metadata. Do not delete tokens automatically on a generic DeveloperError, which could reflect an APNs configuration failure affecting many devices.

Unified Dev logs show `process-push-receipts` ran at 03:13 UTC and reconciled seven receipts (three accepted, four errors). The issue writer logged `issue.prelaunch_routine_suppressed` for the push-receipt `DeveloperError` alert. The absence of a new Ops case is therefore explained by the prelaunch `DRAPE_ROUTINE_OPS_CASES_ENABLED` switch, which suppresses routine automated issues from `process-push-receipts`; it is not proof that the receipt was accepted or that alerting works with the switch enabled. The alert coverage and token-handling gaps remain open.

**Launch gate:** failed push receipts for money events must open a linked Ops case. Enable `DRAPE_ROUTINE_OPS_CASES_ENABLED` at launch or exempt money-event pushes from that switch, then prove alert creation, deduplication and recovery. Keep the separate token-retirement and event-linking defects open; a generic `DeveloperError` must not silently retire a token.

D1 remains NOT VERIFIED because its customer receipt is the original capture only. The customer needs a lasting refund record from authoritative refund rows with amount, date, status and a Drapeon reference; the internal QA rationale on the status card also needs tracing. These are product display defects, not a new money movement.

Draft PR #128 (`f3139d76`) addresses the D1 display defect. A Dev `BEGIN`/behavioral test/`ROLLBACK` showed the customer-only RPC returns the existing confirmed, journaled refund while another user sees none; the function was absent again after rollback. The customer-facing stage note came from `order_stage_updates`: the refund finalizer appended the internal Ops reason to a `REFUNDED` note, which mobile and web rendered verbatim. The PR replaces that display with fixed customer copy and adds the refund amount, date, status and Drapeon reference on customer mobile and web. **No migration or app build from #128 is live yet**, so D1 remains NOT VERIFIED pending review, Dev apply and device proof. Production web can merge ahead of schema without showing a new error because the new UI treats a missing RPC as absent until the approved DB release.

For this D1 order, read-only Dev counts are **zero payouts**, **zero commercial adjustments**, and **one refund journal**. The matching tailor view should therefore show no released earnings or adjustment; a device view is still required to prove that presentation.

### C1 $84 custody tranche execution stop — 2026-11-10

Two distinct Dev QA principals completed fresh Supabase MFA and activated separate 15-minute Money Desk scopes on the restarted merged-main Ops app. Each approved `MD-F6EAF5DCEC` for the `SHIP_CUSTODY_70` tranche of `DRPZHHLGH`, USD 84.00. Read-only Dev verification showed `APPROVED`, 2 of 2, at 02:44:11 UTC. The second QA principal made one supported Execute click at 02:45 UTC. Ops rejected it: **“Accepted payout destination is not currently ready”** (correlation `cd921768-b38e-48e1-b2c3-8ed3531e9ef9`). The request and execution attempt ended FAILED with no provider reference. The order's pinned Stripe destination remains active, transfers and payouts enabled, and first-release review CLEARED, but its `capability_checked_at` was 2026-11-02 07:35:39 UTC, far outside the database's 15-minute freshness rule. This is the immediate cause of the rejection, not evidence that Stripe disabled the account. Read-only Dev counts show **zero USD 84.00 payout rows and zero USD 84.00 payout claims** for this order. The existing USD 80.00 fabric payout is unrelated. No second Execute click, direct SQL mutation, provider transfer, or request replacement was attempted. **C1 is STOPPED / stuck-money risk** pending a reviewed recovery plan: refresh the pinned destination through the supported Stripe path, then prepare a new request rather than reuse this terminal FAILED one, with fresh evidence and independent approvals. Verify the provider state and ledger before any new execution.

For Pixel proof, the previously foregrounded Preview package was installed on 2026-11-01 and is too old to count as merged-main evidence. A new **Android development** EAS build `5e63cc81-d42b-494c-b837-31c1d5ab10e7` was started from clean `e2b2a8b5` with the Dev project ref; installation, fresh token and exact-order tap are pending its completion. The connected Pixel is visible to ADB.

### 2026-11-10: #129 release-time readiness refresh rollout

The founder explicitly authorized the administrator review bypass for #129 only. The approved head `00bc9969` merged as `df6d84c9`. Dev migration `20261110030000_money_desk_release_readiness_evidence` added `money_desk_execution_attempts.provider_readiness_checked_at`; the applied version and column were verified. Dev `ops-money-action` was deployed from the merge commit as **v46**, digest `9d5bec4af2320221702b8361c716e46cbf16bcef19ce583fc39756844975212e`, with its existing `verify_jwt=false` setting preserved. Local Dev Ops on port 3006 and web Ops on port 3005 were restarted from the same `df6d84c9` checkout and both returned HTTP 200. Production received the main web merge; no Production migration or Edge deployment was made.

The old C1 $84 Money Desk request `MD-F6EAF5DCEC` stays FAILED and untouched. A new reviewed request, fresh Stripe readiness evidence, provider transfer and journal have **not yet been produced**. C1 remains BLOCKED until that new request is approved and executed through the supported flow.

The Android development build `5e63cc81-d42b-494c-b837-31c1d5ab10e7` from `e2b2a8b5` finished and was installed on the Pixel after replacing an incompatible older Dev signature. Metro was restarted from merged main `df6d84c9` with Dev-only public configuration. The welcome screen renders, but reinstalling cleared the QA login. Fresh push token, exact-order tap, customer view and tailor view remain NOT VERIFIED.

Draft #128 was rebased onto merged main and pushed at `ec6f7d16`. Its Dev rollback behavioral fixture and local contracts passed; both PR checks are green. It remains unmerged and unapplied pending owner review. The current Ops sessions expired after the local restart, so preparing the replacement $84 request requires a fresh QA MFA sign-in. The email and factor ID are prefilled; no money action is queued or executed by this sign-in.

The QA preparer then completed fresh MFA and activated a Dev Money Desk scope on both merged-main Ops surfaces. The attempt to prepare a **new** $84 `SHIP_CUSTODY_70` request through the web Money Desk failed with `Money Desk idempotency key was reused with different values.` The route hard-codes `settlement-tranche-release:<tranche id>` for every request on that tranche. The existing terminal `MD-F6EAF5DCEC` owns that key, and the replacement has a new reason and preparer. A read-only Dev query confirmed no new $84 request was created. The old failed request remains untouched; no payout, claim, transfer or ledger release was attempted. **C1 STOPPED again: stuck-money defect in the reviewed retry preparation path.** A forward fix must give each independently reviewed replacement operation a distinct key while still deduplicating a repeated click on that same operation; it needs a behavioral test of failed request → new request and same-click replay. Do not reuse the failed request or alter its key directly.

### C1 accounted delivery refund blocks the replacement tranche — 2026-11-10

After #130 merged, a new Dev Money Desk request `MD-46786EDA45` for the same $84 `SHIP_CUSTODY_70` tranche received two independent approvals. One supported Execute click failed with `Tranche source payment is not fully available` (correlation `311011ab-7de3-4e99-b236-512d66bea3d0`). The execution attempt ended FAILED. Read-only Dev verification found no new $84 payout, payout claim, Stripe TEST transfer or `TAILOR_RELEASED` ledger posting. The tranche remained ELIGIBLE and unclaimed. Both terminal requests, `MD-F6EAF5DCEC` and `MD-46786EDA45`, remain untouched. **C1 remains BLOCKED; no $84 moved.**

The source payment is PARTIAL_REFUND because the confirmed $3 dispatch allowance refund reduced the customer charge from 23,274 to 22,974 cents. The REFUND journal debits only `FULFILLMENT_LIABILITY` and credits `PROVIDER_CLEARING`; it does not debit `TAILOR_ENTITLEMENT` or `TAILOR_ELIGIBLE`. The active plan's tailor entitlement is 12,000 cents, with 8,000 cents of fabric allowance. The claim guard and later tranche gates nevertheless required a SUCCEEDED payment with zero refunded amount. This is a launch-relevant stuck-money defect for any order with a non-tailor delivery refund.

Review PR #131 contains the accounting classification fix. Its Postgres test fails on the prior functions, passes on the proposed migration, and returns to the prior rejection after rollback. A Dev `BEGIN`/helper evaluation/`ROLLBACK` on the real C1 payment, plan and tranche returned `true`; a subsequent query confirmed the helper did not remain installed. No #131 migration was applied. The two legacy Stripe/Paystack finalizers that exist only on Dev have no database dependents or function-body callers; #131 leaves those drifted functions untouched and records them for a separate cleanup. A refund of unused fabric allowance is not classified by #131 and will fail closed; test and review that case before relying on a later tranche after such a refund. A third $84 request must wait for owner review, merge and Dev application of #131.

**2026-11-10 Dev rollout:** #131 merged at `390a0b473df0abd8c85f91d804fda016b1562fa3` from approved head `baf24930d4e950b68a88758935eef4a10b87b86a`. The Dev migration was applied with Supabase CLI from an isolated directory containing that approved SQL and history-only placeholders for the 983 already-applied Dev versions. Dev records exactly one row under repository version `20261110042832`; no migration-history edit was needed. The installed `tranche_source_payment_available` helper returns `true` for C1's actual source payment, active plan and $84 tranche. Read-only post-apply checks found the tranche `ELIGIBLE` for 8,400 cents, with no payout, Money Desk link, release ledger transaction or payout claim. The two failed requests remain untouched. C1 stays BLOCKED until the supported two-person release and Stripe TEST/ledger proof finish.

The QA2 preparer then used the Dev Ops Money Desk to prepare the third review, `MD-6050D9521C`, for exactly 8,400 USD cents. It is `PENDING_APPROVAL` at 0 of 2. Its idempotency key ends in `:after:<the second failed request UUID>`, and the first two requests remain `FAILED`. No provider action was taken. Founder and QA1 approver sign-in tabs are prepared with their email and factor IDs; passwords and authenticator codes remain with the owner.

The founder and QA1 recorded distinct approvals, taking `MD-6050D9521C` to 2 of 2. The owner then clicked Execute once in the legacy web Money Desk. The attempt failed at 2026-11-10 05:30 UTC with `EXECUTION_ADAPTER_BLOCKED`, summary `Accepted payout destination is not currently ready`, correlation `d9412284-e3a4-4ea0-8b82-0c3800e953e1`. The accepted destination was active, CLEARED, and transfers/payouts enabled, but its `capability_checked_at` was over an hour old. The attempt has no `provider_readiness_checked_at` or provider reference. The tranche remains `ELIGIBLE`, with null payout, request and release-ledger links and zero payout claims. No release ledger or provider transfer is evidenced. **C1 remains BLOCKED; do not retry this terminal request.**

Root cause from merged-main code: the newer `apps/web/lib/money-desk-execution.ts` and `ops-money-action` paths call `refreshPinnedStripeDestinationForRelease` before tranche execution, but the legacy `apps/web/app/ops/action/route.ts` `money-desk-execution` branch directly calls `triggerSettlementTrancheRelease` with no refresh. That old route remains exposed by the port-3005 Money Desk and can fail any reviewed Stripe tranche after the 15-minute readiness window. The database's fail-closed rejection prevented money movement. A reviewed route-parity fix is required before another C1 request or MFA round.

### D1 refund receipt Dev migration — 2026-11-10

Merged #128's customer-refund-receipt migration was applied to Dev as repository version `20261110031000`. The migration tool initially recorded a generated version; the history row was corrected to the reviewed version, with no second schema apply. The function is present, anonymous EXECUTE is denied and authenticated EXECUTE is granted. The committed synthetic isolation fixture ran inside a rollback transaction without error. A read-only check using the real D1 customer's Auth claim returned exactly **one** `COMPLETED` receipt for **13,531 minor units**. No refund, payment, ledger or review state was changed by this check. D1 remains **NOT VERIFIED** pending the customer receipt display, tailor view, Ops view and exact-order device proof on current Dev builds.

Both local Dev web runtimes were restarted from a clean checkout of merged main `0d107d675ac52c5597bebb61e20f9cad9af116c1` after #128. The web app on `127.0.0.1:3005` and Ops app on `127.0.0.1:3006` each returned HTTP 200, and their listening processes have working directories in that checkout. This establishes current-code availability for UI proof; it does not establish a logged-in customer, tailor, or Ops view. The connected Pixel is on the signed-out welcome screen, and the iOS Simulator service was unavailable during this check. No device tap is claimed.

The iOS Simulator service was restored and Metro restarted from the same merged-main checkout after generating its ignored Studio document with `pnpm studio:build`. The existing signed-in Dev QA customer session loaded `DRP1ME4AJ` from the Completed orders list. Its order detail shows **Refund records → Refund completed → $135.31**, dated November 8 with a Drapeon `DRF-` reference. The Refunded status card uses fixed customer copy and no longer exposes the internal QA reason. [Fixture screenshot](evidence/d1-ios-refund-record-20261110.png). This proves the current-code iOS customer display; the tailor and Ops screens and a real notification tap remain unverified, so D1 is still **NOT VERIFIED**.

### C1 release-time Stripe preflight follow-up — 2026-11-10

Read-only code tracing found a third Money Desk executor in the legacy web Ops route and a snapshot-correction release call in the Edge executor. Both can reach `release-settlement-tranche` without the adapter-level refresh added by #129. Draft [#132](https://github.com/Drape-ltd/drapeon/pull/132), head `b90b8d309d675c72404c6d467efefdeee0f489bc`, places the refresh at the `release-settlement-tranche` and `release-tailor-adjustment` Edge entry points, before payout reservation. A fake-client behavioral test verifies refresh-before-claim and no claim on network failure, disabled capability or a mismatched pinned destination. The caller inventory test fails against pre-fix code and passes on the branch; Node 22 launch contracts and both Edge typechecks pass locally. The PR is unmerged and no Dev Edge deployment or fourth Money Desk request has occurred. The three failed requests remain untouched. **C1 is BLOCKED.**

The connected Pixel currently shows the signed-out welcome screen. Its customer/tailor exact-order push tap and D1 tailor view remain **NOT VERIFIED** until the owner signs in on the device. The canonical Production Ops host is the standalone `apps/ops` Worker at `ops.drapeon.co`; the legacy `apps/web` executor remains a follow-up consolidation item. Production route activation was not inspected in this Dev-only pass.

**#132 Dev rollout, 2026-11-10:** The owner approved head `b90b8d309d675c72404c6d467efefdeee0f489bc` and explicitly authorized the GitHub review bypass after both checks passed. It merged as `2e6490625902d05baf3b991adea082353d63c84d`. From a clean checkout of that merge commit, `release-settlement-tranche` was deployed to Supabase Dev `pqptfuqogvrajozfsqzi` as v63, digest `c3a8feeeed4986481e8402ecb845c73e7e12a420022c1ccd9027ccf4d5681403`; `release-tailor-adjustment` was deployed as v21, digest `d5d8a25cce80ceaf9ad8575c0c2cf930b3265cca55e8959de081654b7995beca`. Both are ACTIVE with their prior `verify_jwt=false` setting and their service authentication remains in the function body. No Production Edge or database change was made.

The Dev Ops app on port 3006 was restarted from the same merge commit with its Dev MFA gate. File-watcher exhaustion initially made that local runtime return 404; restarting with polling restored HTTP 200 for `/local-mfa` and `/ops/my-work`. The port-3006 `apps/ops` Execute action routes through `apps/web/lib/money-desk-execution.ts` to `release-settlement-tranche`, which now performs its own Stripe refresh before reservation. A read-only Dev check after deployment found the three previous requests still FAILED, while the $84 tranche remains ELIGIBLE and the plan ACTIVE with no payout ID, linked request, release journal, or payout claim. No fourth request or transfer exists yet. QA2 sign-in is the next supported step for preparing a new reviewed request; C1 remains **BLOCKED** until that request is approved, executed and reconciled.

### C1 $84 custody tranche release — 2026-11-10

The current-main Dev web preparation page and newer port-3006 Ops app both ran from merge `2e6490625902d05baf3b991adea082353d63c84d`. A third QA principal prepared the fourth request, `MD-98496EAEC9`, for `SHIP_CUSTODY_70` tranche `e338e2ee-c4c6-4feb-b987-7a5d0bb34a5c` on Dev order `DRPZHHLGH`, exactly 8,400 USD minor units. Its key was `settlement-tranche-release:<tranche>:after:<third failed request UUID>`. The founder and first QA principal supplied distinct approvals, bringing it to APPROVED 2 of 2 at 2026-11-10 06:07:04 UTC. The three earlier failed requests remained untouched. The first QA principal executed the approved request once through the newer Ops app. The Money Desk attempt `948615da-6048-4ecf-98aa-70ac86dffc3a` recorded provider readiness at 06:08:40.706 UTC, after execution started at 06:08:39.574 UTC and before it completed at 06:08:48.076 UTC. The request and attempt are SUCCEEDED with provider reference `tr_3UXQPICrvCJ1ybBB1iqSYoR6`.

Read-only Stripe TEST retrieval confirmed the transfer is 8,400 USD minor units, `livemode=false`, source charge `ch_3UXQPICrvCJ1ybBB1tU7m5NM`, and destination `acct_1UWKMoEBcTE5DZFb`. The destination matches both the order's locked Stripe account and its tailor profile. The older Pixel connected-account ID in earlier setup notes is a different account and is not the order's pinned destination. Stripe lists exactly two transfers for this order: the existing $80 fabric transfer and this one $84 custody transfer. There is exactly one transfer of 8,400 for this tranche. Dev has one payout claim (`f7ea43f1-84f8-4b5b-835b-770fdc9a8977`, TRANSFERRED), one payout row (`c96d73af-dd4b-4e25-877f-1698bcfa9f8a`) and one release journal (`9a58131b-2906-49ac-a65c-daa6072339c6`). The tranche is RELEASED and links all three. The journal debits TAILOR_ELIGIBLE 8,400 and credits TAILOR_RELEASED 8,400 in USD, balanced to the cent. The payout row is PROCESSING with transfer status AVAILABLE_IN_PROVIDER_BALANCE; external bank settlement is not yet proven. No second execution or provider replay was issued; the one-claim/one-payout/one-transfer counts are the post-execution baseline, not replay proof.

**C1 status: NOT VERIFIED.** The $84 custody transfer and ledger subcase PASS. Android Pixel 8 is connected but the app is signed out, so the tailor earnings screen and push tap remain unverified. The iOS push receipt remains DEAD / BadDeviceToken. The $24 delivery and $12 protection tranches and the genuine courier booking/physical custody gates remain open. Do not treat this synthetic quote and custody path as real provider proof.

### C1 Pixel earnings display after transfer — 2026-11-10

The Pixel 8 QA tailor signed in through the normal Dev app flow and opened **Payments & payouts** after the $84 transfer. The page first showed “Loading earnings history…” and then crashed with `Cannot read property 'destination' of undefined` in `TailorEarningsScreen`, at `blockedPayoutAction`. The screenshot is [c1-pixel-earnings-render-error-20261110.png](evidence/c1-pixel-earnings-render-error-20261110.png). The shared `payoutBlockRecovery` switch has no default for an unrecognized `blockedReason`; the mobile screen dereferences its result. **Wrong-display defect: FAIL.** The $84 Stripe transfer and balanced ledger remain confirmed independently, but Pixel earnings display and payout-status copy were **NOT VERIFIED** on merged main. No additional transfer or money action was attempted. The initial device error overlay also reported an Expo asset download failure because ADB port 8081 had not been reversed after reconnect; `adb reverse tcp:8081 tcp:8081` restored the app, after which the earnings render error was reproducible.

Read-only Dev diagnosis confirmed the unrecognized reason was `TRANSFER_NOT_FOUND` on an older failed $80 fabric attempt. The same candidate has a later $80 payout with a Stripe transfer, its candidate is RECONCILED, and there is exactly one $80 `TAILOR_RELEASED` ledger credit. That failed row is historical; no $80 earning is stranded behind it. Draft PR #133 at `ed94526a` made the Pixel earnings page open with that row present. The page correctly showed the new $84 transfer as **In Stripe balance**, matching its Stripe TEST amount. The tailor web earnings page also opened on the same branch and rendered “The provider could not find this transfer” in place of the raw block reason. This is branch-level device and web proof, not a merged or deployed fix.

**New stop: wrong withdrawal amount on Pixel and tailor web.** Both show “Withdrawn this month” as **$160.00** and list the same $80 Stripe payout twice; see [c1-pixel-duplicate-withdrawal-20261110.png](evidence/c1-pixel-duplicate-withdrawal-20261110.png). Read-only Dev shows three event rows for one bank payout: `payout.created` at `IN_TRANSIT`, then `payout.updated` and `payout.paid` each at `PAID` for 8,000 USD minor units. Both apps sum `PAID` event rows instead of distinct bank payout IDs. Read-only Stripe TEST retrieval confirms one payout, 8,000 USD minor units, `paid`, `livemode=false`. The UI therefore doubles a bank withdrawal even though no duplicate provider payout is present. No new money action, replay, cleanup or fix was attempted after finding the mismatch. **C1 money-case progression STOPPED** pending a reviewed correction to deduplicate provider payout events in the read model or display and repair the duplicate event state safely. The $84 transfer and its balanced journal remain independently proven.

Draft PR #134 at `dbd6b3ec` projects webhook events into distinct bank payouts in a shared helper, all three client read paths, and the read gateway. On the unmerged branch rebased over merged #133, the Pixel summary displayed **$80.00 withdrawn this month** and the history showed exactly one $80 bank withdrawal: [summary](evidence/c1-pixel-single-withdrawal-summary-20261110.png), [withdrawal card](evidence/c1-pixel-single-withdrawal-card-20261110.png). The live tailor web earnings page in the in-app browser also showed $80.00 and one withdrawal card. The current `/account/payout` page is payout setup and has no withdrawal list; its older `RenderEarnings` surface was updated in code but lacks a live routed Dev UI proof. These are branch-level UI observations, not a Dev gateway deploy or a C1 PASS. No money or withdrawal event row changed. The $84 transfer and ledger remain as above; C1 progression stays stopped until the reviewed fix is merged and the deployed read path is checked.

### D1 pickup location display mismatch — 2026-11-10

The booted Dev iOS Simulator still shows the D1 customer refund as **completed for $135.31**. On the same order screen, the pickup plan says **New York, USA**: [fixture screenshot](evidence/d1-ios-pickup-location-mismatch-20261110.png). A read-only Dev order check shows `fulfillment_option = PICKUP` and the order's verified `fulfillment_origin_snapshot` has city **Austin**, region **TX** and postal code **78701**; the delivery city and region are null. The mobile order screen renders `order.tailorLocation`, sourced from the tailor profile's general `location`, instead of this pinned pickup origin. Classify as **wrong-display**: the customer can be told the wrong pickup city. No payment or refund value changed. A separate UI fix should use the order's verified pickup origin, with a safe generic fallback when it is absent. D1 remains **NOT VERIFIED** for the correct seller view and exact-order notification tap; this read-only finding does not promote the case to PASS.

### C1 withdrawal projection Dev rollout and new display stop — 2026-11-10

PR #134 merged at `7d62b3231f0ea4d89d13e53f27aa8af2a6174591`. `read-gateway` was deployed from a clean checkout of that exact main commit to Dev only as **v76**, active digest `07dc5a8c54349e27b2762cf26beeec03151d50946a1d0d9b2b4fa97c4538c227`; the prior version was v75. The signed-in Pixel loaded a fresh merged-main Metro bundle and showed **$80.00 Withdrawn this month**, with exactly one $80 bank withdrawal card for the one Stripe TEST payout: [summary](evidence/c1-pixel-withdrawal-merged-main-20261110.png), [card](evidence/c1-pixel-single-bank-payout-dev-20261110.png). The signed-in tailor web `/account/earnings` page on the same main checkout also showed $80 and one withdrawal. `/account/payout` is a setup page and has no withdrawal history; the older `RenderEarnings` component remains without a routed live UI proof. The raw webhook event rows were not changed. This closes the **duplicate bank-withdrawal display defect**, not C1 as a whole.

**New amount/status display stop:** on this same Dev data, Pixel's earnings summary says **Pending release $370.00** and **In provider balance $0.00**, while web says **Pending release $286.00** and **In provider balance $84.00**. Read-only Dev shows C1's settlement plan at $120.00 entitlement: the $84.00 custody tranche is `RELEASED`, and $24.00 and $12.00 tranches remain `LOCKED`. The corresponding $84.00 Stripe payout row is `PROCESSING` with `provider_transfer_status = AVAILABLE_IN_PROVIDER_BALANCE` and a single `tr_` reference. The mobile summary classifies whole orders through `latestPayoutForOrder`, which deliberately filters to `ORDER_EARNING` and therefore ignores `SETTLEMENT_TRANCHE` payout rows. Web sums tranche statuses and provider-balance payout rows separately. The $84.00 state is thus misplaced on mobile, although the combined $370.00 is unchanged. **Wrong-display defect; C1 money progression stopped** under the amount-mismatch rule. No further payout action, replay or money-state change followed this finding. A reviewed tranche-aware mobile projection is needed before C1 resumes.

[PR #136](https://github.com/Drape-ltd/drapeon/pull/136), head `dfad8d66b7915c45d9dc4f21deb9e81d3c76e1a3`, adds a shared staged-tranche summary and reads the tailor's tranche rows on mobile. On the same signed-in Pixel and Dev data, the branch displayed **Pending release $286.00**, **In provider balance $84.00**, **Withdrawn this month $80.00**, and **All settled earnings $370.00**, matching web and the read-only tranche/payout rows: [Pixel branch screenshot](evidence/c1-pixel-staged-earnings-branch-20261110.png). Four new shared unit tests, mobile and web typechecks, full launch contracts, and `git diff --check` passed. Both PR CI checks passed and the PR was marked ready for review. This is branch-level display proof, with no money-state change. **C1 progression remains stopped** until review, merge, and merged-main device verification. Separate UI feedback was sent to the app declutter chat: the oversized summary, dense explanatory copy, and filters bury the transaction history and make order releases hard to distinguish from account-level bank withdrawals.

**Merged-main retest:** the owner approved #136 at that exact head and merged it as `2103d7734e2973ffe1da3934401d2dbc283d70da`. Metro was restarted from a clean checkout of that merge commit with the Dev project ref `pqptfuqogvrajozfsqzi`; the signed-in Pixel 8 reloaded its Android Dev client from port 8082. The Payments & payouts screen showed **Eligible $0.00, In provider balance $84.00, Withdrawn this month $80.00, Pending release $286.00, All settled earnings $370.00**: [merged-main Pixel screenshot](evidence/c1-pixel-staged-earnings-merged-main-20261110.png). This closes the C1 amount/status **display** stop. No payout, refund, ledger or order state changed. The remaining C1 delivery event, policy-gated $24/$12 tranches, and exact-order push tap remain unverified.

Read-only Dev preflight for the remaining C1 plan: `SHIP_CUSTODY_70` is `RELEASED` for 8,400 minor units; `SHIP_DELIVERY_20` and `SHIP_PROTECTION_10` remain `LOCKED` for 2,400 and 1,200. The order is still `OUT_FOR_DELIVERY`. The staged-settlement policy makes delivery 20% eligible 72 hours after recorded delivery and protection 10% eligible 14 days after recorded delivery. No early eligibility, release, Money Desk request, or transfer was created. After #136 merges and the summary passes on merged main, the next real step is the supported delivered-custody proof, then waiting for the policy windows while independent regression cases continue.

Push preflight without sending a notification: the C1 QA tailor has two Android `push_tokens` rows on Dev, with the newest row updated at 2026-11-10 07:24 UTC during the merged-main Pixel session. Token values were not read or recorded. This establishes a fresh registration candidate, **not** an Expo receipt or an exact-order tap. The earlier stale-token and alert-linking gaps remain open.

**Existing notification tap, merged-main Pixel:** Android's notification shade contained a Dev “Earnings released” notification from the C1 tranche transfer. Its queued data has the C1 `orderId`, which the mobile router maps to the exact tailor order. Tapping it brought up the Expo Dev launcher rather than that order. Selecting the running merged-main Metro server then opened the signed-out welcome screen, although the tailor had been signed in immediately before the tap; Metro logged `INITIAL_SESSION` with no session on relaunch. No notification was resent and no money state changed. This is an observed **failed Dev-client navigation proof**, not yet a confirmed Production deep-link defect; cold-start handling and session restoration require diagnosis. The C1 exact-order push tap remains **NOT VERIFIED**. A fresh owner sign-in is needed before another physical-device test.

### D1 notification ledger read-only check — 2026-11-10

On Dev, all D1 `job_queue` rows found by the order ID are terminal: one order-confirmation email, six order-event emails, and five push jobs each have `SUCCEEDED` job status. The `notification_delivery_audit` projection records the seven emails as `ACCEPTED`; for the five pushes it records two `DELIVERED` and three `SKIPPED / NO_TOKEN`. A separate `push_delivery_attempts` query for this order found two `DELIVERY_ERROR / DeveloperError` rows and one `TICKET_ERROR / InvalidCredentials` row, but those attempt rows do not join to the five audit jobs through `notification_job_id`. Therefore this read-only count proves terminal job processing, **not** a successful device tap or a clean end-to-end push receipt. D1 remains **NOT VERIFIED** for the tailor screen and exact-order tap. No notification was replayed or changed.

**Receipt audit stop, confirmed read-only:** the two `DELIVERED` push audit rows correspond to the cancellation-refund-completed and refund-completed sends at 16:45 and 17:45 UTC on November 8. Expo attempt rows for those same notification kinds were created within the same second and later ended `DELIVERY_ERROR / DeveloperError`. Both attempts have null `notification_job_id`, so receipt reconciliation cannot correct the job-level `DELIVERED` status. The legacy job audit therefore overstates delivery for these D1 money notifications; neither a device delivery nor a tap is proven. The current linking migration was applied after these sends, so this finding concerns historical rows and needs a reviewed repair or explicit archival treatment. **D1 remains NOT VERIFIED; do not use the two DELIVERED labels as evidence.** The $135.31 refund, payment and ledger were not changed by this inspection.

### Next fresh Dev payment preflight — 2026-11-10

The signed-in QA customer on the iOS Simulator found the stocked Stripe Regression Atelier ready-made fixture through Explore and selected size M, quantity one, and pickup. The live checkout preview shows **$125.00 item subtotal, $10.31 Texas tax, and $135.31 total**: [iOS preview](evidence/c1-next-ios-checkout-preview-20261110.png). The customer accepted the cancellation policy in the app and continued. Dev created order `DRPAEYN2K` (`3db15af4-219f-40d4-a19e-0be3bbda710a`), one PENDING Stripe payment row (`b7b344d4-cc28-4acb-93aa-9674915e28ce`), and PaymentIntent `pi_3UaAC1CrvCJ1ybBB1WdwyMOE` for 13,531 USD minor units. Read-only Stripe TEST retrieval found `requires_payment_method`, `livemode=false`; the payment row has no charge ID and no refunded amount. No money moved at that point.

The customer then paid once through the iOS Stripe TEST sheet using Stripe's public test card. At 2026-11-10 08:25 UTC, the app showed “Payment confirmed” ([iOS order screen](evidence/c1-next-ios-payment-confirmed-20261110.png)) and the order became `CONFIRMED`. A read-only Stripe TEST lookup returned the **same** PaymentIntent `pi_3UaAC1CrvCJ1ybBB1WdwyMOE`, `succeeded`, `livemode=false`, amount and amount received both 13,531 USD minor units, latest charge `ch_3UaAC1CrvCJ1ybBB1IxcZw1d`. Dev has exactly one payment row and one distinct PaymentIntent for this order; the row is `SUCCEEDED`, refunded amount zero. Commercial ledger CAPTURE transaction `c68e40a4-0924-49ca-85d2-d24b334b6cbc` is 13,531 and its entries net to zero. The seller item is at inventory quantity 11, size M quantity 2, after this one-unit order.

The normal 08:30 UTC notification worker finished all three jobs once. Customer push job `9bfc244f-9200-43a5-ac14-8a7eb412c374` received Expo ticket `01a1c494-22a0-759e-8a36-4af97fa63d10`. The scheduled 08:43 UTC receipt check returned `DELIVERY_ERROR / DeveloperError`, with APNs `BadDeviceToken` (400), for this **iOS Simulator** token; the linked outcome correctly became **DEAD**. This is not a delivered push and cannot prove an APNs tap. Tailor push job `2951fa20-6972-4712-a5b5-b5aa7672dc61` is **SKIPPED** because no tailor push token exists after the Pixel session was cleared. Email job `e275a0b0-f00a-4e47-b63e-d7b879b68e28` succeeded in the worker but its delivery outcome is **ACCEPTED**, not proven delivered. The payment/capture check passed; push delivery is **FAIL on this simulator token / physical iOS unverified**, and C1 remains NOT VERIFIED.

The two `communication_inbox` rows exist: customer `390db118-498e-4141-ba1b-e8cd0bedb5c8` and tailor `cb762b56-2628-41c7-8883-3b0c95085622`, each with `ORDER_DETAIL` pointing to this order and the correct required role. On the signed-in iOS Simulator, the customer opened the new “Order confirmed” inbox row; it navigated to `DRPAEYN2K` and showed “Payment confirmed. This order is now placed.” This proves the in-app inbox link, not a delivered APNs push tap. A physical iPhone is still required for APNs delivery proof.

The scheduled `RECONCILE_PAYMENT_WEBHOOK` job `9d1619fe-6b69-4506-b5cc-a0b2c0f60c31` completed `SUCCEEDED` at 08:41 UTC on its first attempt. A read-only recheck afterward still found one payment row, one PaymentIntent, one CAPTURE ledger transaction for 13,531, and no duplicate charge or posting.

**Wrong-display finding (open):** The same customer order screen says “This is a pickup order in New York, USA.” The immutable `fulfillment_origin_snapshot` for this paid order is Austin, TX 78701 and the locked tax region is TX. Mobile renders `order.tailorLocation` in the pickup-plan copy (`apps/mobile/app/(customer)/orders/[id].tsx`), so a profile location can disagree with the verified pickup origin. Fix the copy to use the pinned origin city/region (or omit the city until it can be shown safely); review separately before release. No tax or payment mismatch was found.

**Local checkout configuration stop and recovery:** The Simulator initially loaded a stale port-8081 Metro bundle with no Stripe publishable key and showed “Card payments are not available in this build yet.” A first port-8082 bundle carried a public key from another Stripe test account; retrieving this PaymentIntent with that key returned `resource_missing`, and the app showed a generic payment error. The active Dev platform's Stripe TEST secret retrieved the intent; its matching public key retrieved the same intent with HTTP 200. The ignored local Metro environment was corrected, the stale server stopped, and the merged-main bundle reloaded on port 8082. Retrying **the same order** opened Stripe's TEST PaymentSheet for $135.31. No second payment row or PaymentIntent was created. The final Pay action and capture are verified above; a delivered APNs push tap remains **NOT VERIFIED**. The Pixel 8 Dev client is connected but its QA customer session is signed out.

**Historical D1 push audit repair, pending review:** A read-only Dev inventory found 215 legacy PUSH outcomes marked `DELIVERED` without a linked Expo attempt. A strict one-to-one match on user, structured order ID and a one-second send window found 66 matching attempts; three have a definite failed receipt, including the two D1 money notifications. Draft PR #137 (`b4da88a2`) proposes a data-only repair that marks the definite failures `DEAD` and labels the remaining historical rows as unverified rather than delivered. Its real-Postgres red/green, replay and rollback proofs and launch contracts passed locally. The migration has **not** been applied to Dev or Production; D1's device delivery remains NOT VERIFIED. No notification was resent and no money state changed.

### E4 interim Dev ledger sweep — 2026-11-10

A read-only sweep of all seven order references named in this regression found four paid orders, two pre-quote orders and one canceled-before-payment order. Every one of the **nine** commercial journal transactions on the four paid orders balances to zero minor units. These are current Dev database observations; this sweep did not freshly retrieve the provider objects, so **E4 remains NOT VERIFIED** rather than PASS.

| Dev order | Payment capture | Refund recorded | Other journaled money | Current observation |
| --- | ---: | ---: | --- | --- |
| `DRP1ME4AJ` | $135.31 | $135.31 | None | One capture and one refund journal; no payout row. |
| `DRP2710RP` | $135.31 | $0 | None | One capture journal; no payout row. |
| `DRPAEYN2K` | $135.31 | $0 | None | One capture journal; no payout row. |
| `DRPZHHLGH` | $232.74 | $3.00 | $80 fabric advance and $84 custody release | Five journals balance. The failed $80 attempt has no transfer; the later $80 and $84 payout rows are PROCESSING with distinct `tr_` references in provider balance. |
| `DRPV819C8`, `DRPVFZPNC`, `DRPYYZYNX` | $0 | $0 | None | No payment or commercial journal; the last order is canceled. |

The aggregate payout-row amount is **not** a transfer total: C1 retains both a failed $80 row and its later successful-at-Stripe $80 attempt. A full E4 pass still needs fresh Stripe TEST retrieval for every referenced PaymentIntent, refund and transfer, matching provider statuses and amounts to these journals and each UI view.

**Fresh Stripe TEST charge comparison, 2026-11-10 09:35 UTC:** A read-only API call using the locally stored test key first confirmed the expected Dev platform account. All four PaymentIntents listed below returned `livemode=false`, `succeeded`, USD, `amount_received=amount`, and a paid charge. Charge-level refunded amounts match the Dev payment rows and the refund journals to the cent. No secret or provider response body was saved.

| Dev order | Stripe PaymentIntent | Stripe received | Stripe charge refunded | Dev payment/refund |
| --- | --- | ---: | ---: | ---: |
| `DRP1ME4AJ` | `pi_3UXwFjCrvCJ1ybBB1EyLQVPr` | $135.31 | $135.31 | $135.31 / $135.31 |
| `DRP2710RP` | `pi_3UY4tMCrvCJ1ybBB0fuZdIz4` | $135.31 | $0 | $135.31 / $0 |
| `DRPAEYN2K` | `pi_3UaAC1CrvCJ1ybBB1WdwyMOE` | $135.31 | $0 | $135.31 / $0 |
| `DRPZHHLGH` | `pi_3UXQPICrvCJ1ybBB1TTyHL08` | $232.74 | $3.00 | $232.74 / $3.00 |

This narrows E4's remaining provider work to the individual refund objects and C1 transfers, plus screen comparisons. **E4 remains NOT VERIFIED.**

**Fresh Stripe TEST refund and transfer comparison, same session:** Both known refund objects are `succeeded`: D1 `re_3UXwFjCrvCJ1ybBB1vkJGeJu` is 13,531 USD minor units against D1's charge and PaymentIntent; C1 `re_3UXQPICrvCJ1ybBB1ntZClPO` is 300 against C1's charge and PaymentIntent. The amounts match the respective refund journals. C1's two known transfer objects are `tr_3UXQPICrvCJ1ybBB1mFkMvjO` for 8,000 and `tr_3UXQPICrvCJ1ybBB1iqSYoR6` for 8,400 USD minor units. Both have `livemode=false`, source transaction `ch_3UXQPICrvCJ1ybBB1tU7m5NM`, destination matching the order's pinned connected account, and `reversed=false`. These match the two `TAILOR_RELEASED` journal amounts. The old failed $80 payout row has no transfer object and is not included in the provider transfer total. This confirms the provider objects already named by the regression evidence; it does not prove there are no other provider objects or that bank payout settled. **E4 remains NOT VERIFIED** pending a complete provider-object inventory, UI comparisons, and replay evidence.

**Scoped provider duplicate inventory, 2026-11-10:** Read-only Stripe TEST list queries on the D1 and C1 source charges each returned exactly one refund (`has_more=false`): D1 13,531 and C1 300 USD minor units, the same refund IDs above. Listing C1's complete order transfer group (`has_more=false`) returned exactly two transfers, 8,000 and 8,400 USD minor units, both from the order charge to the pinned destination and neither reversed. These counts rule out an additional refund on either checked charge or an additional transfer in that order group at the time of inspection. They do not rule out a transfer created outside the group's tagging convention, so the full provider and UI reconciliation remains open.

**Account-wide Stripe TEST duplicate check, 2026-11-10 13:00 UTC:** The locally configured `sk_test_` key retrieved the same Dev platform and all four known PaymentIntents; each intent and charge had `livemode=false`. Complete charge-filtered refund lists (`has_more=false`) returned exactly one succeeded 13,531 refund for `DRP1ME4AJ`, zero for `DRP2710RP`, zero for `DRPAEYN2K`, and one succeeded 300 refund for `DRPZHHLGH`. A complete paginated list of **all eight** transfers on that TEST platform found none with the D1 or two other ready-made source charges, and exactly the existing 8,000 and 8,400 transfers with C1's source charge or order transfer group. Neither was reversed. This closes the earlier *outside-the-group transfer* uncertainty for these four source charges. The Dev database still has one balanced capture and one balanced refund journal for D1, one balanced capture journal for each of the two other ready-made orders, and C1's balanced 23,274 capture, 300 refund, 8,000 fabric release and 8,400 custody release; provider amounts and references match each money posting to the minor unit. The prior failed C1 payout row has no provider transfer and contributes no release journal.

A complete list of **31** TEST PaymentIntents found no metadata or transfer-group match to the three named unpaid orders. Three intents on the platform lack the usual `order_id` metadata, so this metadata scan alone cannot exclude every untagged orphan intent; none was used as evidence of an unpaid order payment. This is a current provider/ledger check for the seven named orders, **not** the full A–G regression or a bank-settlement and UI proof. **E4 remains NOT VERIFIED.**

**C1 continuation check, 2026-11-10 09:50 UTC:** The $84 `SHIP_CUSTODY_70` tranche remains RELEASED with its release timestamp; `SHIP_DELIVERY_20` ($24) and `SHIP_PROTECTION_10` ($12) remain LOCKED with no eligibility time or block reason. The connected Pixel was reachable through ADB but the app displayed its signed-out account-recovery screen after unlocking, so no customer or tailor device view or push tap was counted. No money or device account state was changed.

**C1 delivery gate recheck, 2026-11-10 11:05 UTC:** Dev still has one `CARRIER_ACCEPTED` settlement evidence row and no `VERIFIED_DELIVERY` row for this order. The $84 custody tranche remains RELEASED; the $24 delivery and $12 protection tranches remain LOCKED with no payout or Money Desk request. Policy schedules those tranches 72 hours and 14 days after verified delivery, respectively. A synthetic courier quote and carrier-accepted fixture do not establish delivery. No delivery evidence, eligibility, payout or transfer was created in this recheck. The connected Pixel is on the Dev customer sign-in form with the QA email prefilled; no password or customer session was supplied by this check. Device tap proof remains NOT VERIFIED.

**Device proof recheck, 2026-11-10 11:18 UTC:** The connected Pixel 8 still shows the Dev sign-in form. Both Drapeon iOS Simulators also show sign-in forms. A read-only Dev check for paid order `DRPAEYN2K` found zero Android push-token rows for its customer and tailor accounts. The already completed $135.31 TEST payment was not repeated. A new Android notification delivery and exact-order tap cannot be credited from this order's earlier jobs; those jobs already reached their recorded terminal outcomes. The next device run requires a signed-in Pixel role, a freshly triggered supported event, its provider receipt, and the actual tap. This remains **NOT VERIFIED**.

### Definite Stripe transfer rejection close-out audit — 2026-11-10

**Stuck-money risk, code path; no live failure in this regression:** `reconcile_definite_payout_rejection` on merged main writes the claim's `FAILED_RECONCILED` status before the operation's final `FAILED_RETURNED` and `NOT_SENT:<code>` evidence. The accepted-route tranche trigger runs on the claim update, so it cannot see that evidence and leaves the payout `PROCESSING`; the tranche can remain `RELEASE_REQUESTED`. A read-only Dev query found **zero** current claims in the precise definite-not-sent state, so no existing Dev payout was repaired or moved. PR #140 head `fd83345d4c5c6009865a36c2ea9495a33680da40` changes the update order, requires the exact unpaid payout to close, and blocks the matching tranche. It also reopens a previously resolved Ops case in both status models, clears its close timestamps, refreshes its source/seen time, and replaces the stale recovery instruction with the correct reviewed retry/destination-correction guidance. Its synthetic Postgres fixture fails on main, passes on the branch, checks ambiguous evidence, replay, a pre-resolved case, and the adjacent fabric branch, and restores the exact Dev function body on rollback. A combined Postgres proof after the merged #138/#139 migrations confirms the #140 behavior and rollback. `pnpm launch:contracts` passed on Node 22; the PR workflow completed successfully. This code proof is **not** a live Stripe TEST rejection or a Dev rollout.

**Reviewed retry risk, unmerged #139:** A later reviewed operation could also be definitively rejected after its provider attempt starts. Before head `5971b2b8`, that path left the Money Desk attempt `PROCESSING`; the returned-funds trigger had the same update-order gap. #139 now closes the exact not-sent retry's payout, tranche and Money Desk attempt in one guarded transaction, with a monitor fallback after a lost Edge response. A local Postgres test fails on the prior #139 head and passes with the fix; missing not-sent evidence stays open for Ops, and a new reviewed operation 3 can be reserved once. #139 is **unmerged and undeployed**; no live provider call or money state was changed by this audit.

**Customer screen recheck, 2026-11-10 13:38 UTC:** After the Mac was unlocked, the iPhone 17 Pro Max and Declutter iPhone SE Simulators displayed Drapeon's sign-in form, while the iPhone 17 Pro Simulator was at the iOS home screen. None displayed a payment receipt or order screen. The earlier Dev Stripe TEST payment for `DRPAEYN2K` remains the one verified capture; no Pay action was repeated in this recheck. Customer receipt and exact-order screen proof remain **NOT VERIFIED** until the QA customer session is restored on the checkout device. The visible sign-in forms are not evidence of payment failure.

**QA customer sign-in attempt, 2026-11-10 13:41 UTC:** One sign-in using the Dev QA runner's documented test credential on the iPhone 17 Pro Max returned the app's “Incorrect password” alert. No further guesses or account reset were attempted, and no credential or screenshot was committed. This does not change the Stripe TEST capture; device receipt and push-tap proof remain **NOT VERIFIED** pending a valid QA customer session.

### Read-only Dev payout-state stop — 2026-11-10

A count-only query found **19** old `PROCESSING` payouts with matching claims in `RESERVED`, transfer status `NOT_STARTED`, operation 1 still `RESERVED`, no `payout_attempts` row, no recorded provider transfer ID, and no matching open Ops case. Their payout purposes are 9 `FABRIC_RELEASE`, 4 `MATERIAL_ADVANCE`, 5 `RESIDUAL_SETTLEMENT`, and 1 `SETTLEMENT_TRANCHE`; initiation dates range from Oct 23 to Oct 25. Ten have a linked Money Desk request in `FAILED`; nine are fabric releases with no request. These are unresolved release records and therefore a stuck-money stop. No retry, reconciliation, or state change was attempted. A follow-up aggregate query found **2** additional `PROCESSING` payouts without claims but with transfer references, and **4** with `TRANSFERRED` claims. Three references are explicit `qa_no_provider_call` fixture placeholders, not Stripe objects. The remaining three are real Dev Stripe TEST transfers (USD 10 tip, USD 80 fabric release, and the USD 84 C1 tranche); all three exist in the provider and each has a matching balanced ledger transaction. Their payout rows remain `PROCESSING`, so they need status reconciliation, but the provider money and balanced release journals are present. No bank payout ID is attached to these transfers. The USD 10 provider transfer was retrieved read-only with the Dev `sk_test_` key after checking the platform account matched Dev; it was not reversed and its destination matched the payout row. Continue non-money work until the 19 reserved cases are classified and have a reviewed recovery path; do not mistake the three stale, already-transferred payout rows for those 19 no-transfer reservations.

**Provider-side check, 2026-11-10 14:04 UTC:** After validating the local key as Dev Stripe TEST by retrieving the configured account, read-only transfer-group lookups covered all **13** affected order groups associated with the 19 reserved payouts. The API returned **zero transfers** across those groups. This supports the database finding that no transfer was created for these specific reserved releases at lookup time. It does not settle any bank payout. No Stripe or database writes were made.

**Read-only function drift fingerprints, 2026-11-10:** The four supporting functions copied into the local Postgres fixture were compared with the live Dev definitions. The recorded 32-character fingerprints are `guard_payout_forward_status` `6c8a0a67e665cee6d348066422458adb`, `prevent_payout_provider_operation_identity_change` `30599cdbccc3b744d010709d6e979ce`, `prevent_provider_operation_evidence_rewrite` `36d26a983848f0307eb64b5df3e0e675`, and `private.sync_returned_snapshot_tranche_payout` `897fd4bc8e3e2ad65bd225f1c81cfb5e`. These are Dev schema fingerprints only; no database state changed.

### Android preview Firebase setup — 2026-11-10

The merged mobile config defines Preview as Android package `com.drape.app.preview`; `apps/mobile` has no checked-in `google-services.json`, as expected for this ignored config. The browser session had no Firebase or EAS console open. `eas whoami` could not reach `api.expo.dev` because DNS resolution failed, so the current EAS Preview file-variable value and FCM V1 assignment were not independently verified or changed. The repository runbook identifies Firebase project `drape-mobile-4729` and says FCM V1 is assigned for Preview, but that older note is not fresh console proof.

Required console steps before the Preview R8 smoke build:

1. Firebase Console → project `drape-mobile-4729` → Project settings → General → Your apps → Add app → Android. Register package `com.drape.app.preview` and download its `google-services.json`.
2. Expo dashboard → Drape project → Environment variables → Preview. Replace the file variable `GOOGLE_SERVICES_JSON` with the downloaded file. Leave Development and Production values untouched.
3. Expo dashboard → Credentials → Android → FCM V1. Verify the assigned service-account key belongs to `drape-mobile-4729`; if absent, assign a key for this same project. Do not create or change Production app credentials for this Preview fix.
4. Rebuild the Android Preview app and confirm Firebase initializes and a fresh Expo push token registers before the R8 smoke test.

No Firebase app, EAS variable, credential, or build was changed in this check.

### Post-#142 Dev checkpoint — 2026-11-10

This checkpoint supersedes the older C1 summaries above. All checks here were
read-only against Supabase Dev and Stripe TEST unless stated otherwise. No
Production state was changed.

**#142 rollout:** PR #142 merged from `676a149dbef288bd700d63bfeea2de4f355d94ec`
at `c1d96210e786c03aa9c9ea690c0b0e4fc5736fbc`. Dev records migration
`20261110150000_close_unstarted_tranche_payouts`. The migration helper first
recorded generated version `20261110165605`; the Dev history row was then
corrected to the repository version. Dev runs `release-settlement-tranche`
v65 (`564c32783bd0aeb6434d0dc8c46cbc1fd1712d0a58d6afc70e91508421a15169`)
and `monitor-settlements` v57
(`89c5d91bacc3e57bfffd7dff4190df13a28f440adbf2e1e8ffd0e0cd3e7c9ada`). The
monitor excludes old reservations without an accepted route snapshot from its
resume loop. No Dev cron invokes `monitor-settlements`, and it was not manually
invoked. The 19 legacy no-attempt reservations remain unresolved and untouched;
#142 does not provide their recovery.

**C1 $84 custody tranche:** Money Desk request `MD-98496EAEC9`
(`6aa2ef7c-adb5-4f20-b587-c0ea12c3063b`), execution attempt
`948615da-6048-4ecf-98aa-70ac86dffc3a`, tranche
`e338e2ee-c4c6-4feb-b987-7a5d0bb34a5c`, payout
`c96d73af-ddb4-4e25-877f-1698bcfa9f8a`, and claim
`f7ea43f1-84f8-4b5b-835b-770fdc9a8977` are recorded. The request and attempt
are `SUCCEEDED` for 8,400 USD minor units. Provider readiness was recorded at
`2026-11-10 06:08:40.706 UTC`; the attempt started at `06:08:39.574 UTC` and
completed at `06:08:48.076 UTC`. Stripe TEST transfer
`tr_3UXQPICrvCJ1ybBB1iqSYoR6` is `livemode=false`, unreversed, and its
`source_transaction` is the order charge
`ch_3UXQPICrvCJ1ybBB1tU7m5NM`. The matching release ledger transaction
`9a58131b-2906-49ac-a65c-daa6072339c6` balances at 8,400 debit / 8,400 credit.
The payout row remains `PROCESSING` with provider transfer status
`AVAILABLE_IN_PROVIDER_BALANCE`; this confirms the Stripe Connect transfer,
not a completed bank payout. No second transfer was found in the complete
order transfer-group inventory recorded above. A deliberate replay of this
Money Desk request was not performed, so replay behavior remains **NOT
VERIFIED**.

The order remains `OUT_FOR_DELIVERY` with an ACTIVE settlement plan. Its only
settlement evidence is `CARRIER_ACCEPTED`; there is no `VERIFIED_DELIVERY`
evidence. The $24 `SHIP_DELIVERY_20` and $12 `SHIP_PROTECTION_10` tranches
remain `LOCKED`, with no payout, claim or release journal. They must not be
released from the synthetic quote or carrier-accepted fixture alone.

**C1 notifications:** Read-only outcomes show 34 EMAIL `ACCEPTED`, 3 PUSH
`ACCEPTED`, 3 PUSH `DEAD` with `DeveloperError`, and one SMS `SKIPPED` with
`SMS_DISABLED`. All corresponding queue jobs are terminal `SUCCEEDED`; that
worker status does not convert the three `DEAD` push delivery outcomes into
successful delivery. No exact-order push tap is verified. This failed push
proof is a stop for C1 notification completion; no notification was resent.

**D1 refund:** The order is `REFUNDED`; its one payment is `REFUNDED` for
13,531 USD minor units. Stripe TEST refund `re_3UXwFjCrvCJ1ybBB1vkJGeJu`
reconciles to refund journal `c0e32a9a-8042-4351-8fe3-c8f833d3184e`, with
13,531 debits and 13,531 credits. The already-verified refund and ledger state
stands. Customer receipt, tailor view and device push/tap remain **NOT
VERIFIED** until the QA sessions are signed in on the relevant devices.

**Device checkpoint:** The Pixel and iOS Simulators are available, but the QA
customer and tailor sessions are signed out; no new sign-in, password attempt,
reset, notification tap or money action was made in this checkpoint. D1 screen
proof and C1 earnings/push-tap proof remain outstanding.
