# Stripe / Ops regression — October 2026

Environment: Supabase Dev `pqptfuqogvrajozfsqzi`; Stripe test mode only for
mutations. No Production writes, migrations, deployments, or live-mode changes
were made. The explicitly approved read-only Production inventory is below.

## Production migration ordering (plan only; nothing applied)

No Production step is approved or performed. Before Batch 1, a read-only
Production migration inventory must confirm these twelve October 29
prerequisites are already applied: `20261029000000`, `20261029000500`,
`20261029001000`, `20261029001500`, `20261029002000`, `20261029002500`,
`20261029003000`, `20261029043814`, `20261029062510`, `20261029063007`,
`20261029131928`, and `20261029132040`. If any is absent, stop and construct
separate prerequisite batches of at most five, ordered by dependency and
separating schema, backfill, security, and scheduler changes. Obtain review
and approval before applying those batches. The plan below presumes this
precondition passes; it has not been verified on Production.

For data-only migrations `20261030050000` and `20261030110000`, the release
owner must record the expected affected-row count and read-only `EXPLAIN` plan
against Production before the containing batch. Stop if either differs from
the reviewed Dev result or exceeds the approved scope. No Production data-only
migration has been run for this regression.

A read-only Dev recheck on 2026-11-08 found zero *remaining* rows matching
either backfill's predicate after its prior Dev application. These are
post-application counts, not the number originally repaired on Dev and not an
estimate of Production impact. The Production inventory, candidate counts,
and query plans still require separately approved read-only checks.

The plan is:

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

**Later D1 batch:** `20261107194113` (merged PR #116) was applied and tested on
Dev with the matching `refund-order-payments` and Ops web builds. PR #117's web
dispute-resolution fix is also merged. The D1 refund and webhook replay
invariants passed; the remaining device proof is recorded below. Recompute
the final Production Edge closure and versions before release. This is a plan
entry, not approval to release.

The repository also contains these **candidate later migration batches**, each
with at most five migrations. They are source inventory, not a claim that
Production lacks them; a read-only Production migration inventory and the
final dependency/rollback review are required before assigning release SHAs:

| Candidate batch | Migrations | Gate |
| --- | --- | --- |
| 5 — first Stripe release review | `20261030231747`, `20261102054500` | Recheck fresh readiness, fail-safe block and Ops UI on Dev. |
| 6 — address-scoped tax cache | `20261102180324`, `20261102182653` | Upgrade and record Production ZipTax quota; verify real quote alerts and address cache primary key. |
| 7 — claimed fabric payout | `20261102200000`, `20261102204053`, `20261102210052`, `20261102234537` | Complete C1 fabric recovery and 80% tranche without duplicate transfer. |
| 8 — D1 cancellation refund | `20261107194113` from merged PR #116 | Dev refund and replay invariants passed; complete device proof before Production readiness. |
| 9 — push receipt audit | `20261108181600` from merged PR #115 | Dev schema and SQL behavior passed; fresh notification and device taps remain unverified. Roll back Edge builds before schema. |

These candidates must be rebatched if dependency review or final merged heads
change the ordering. No batch is approved for Production.

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
- Pending D1: `refund-order-payments` plus the Ops web route; recompute the
  shared-import closure against the final merged commit before release.

The Batch 1–4 combined list is 21 unique functions; the pending D1 entry is
not included in that count. No Edge function was deployed to Production
during this work.

### Provisional later Edge import closure

This closure follows local relative TypeScript imports from each Edge
`index.ts` to the shared files changed by the named PRs. It is deliberately
conservative; recompute it on the final merged release SHA and confirm which
functions have already been deployed before publishing an exact version list.

- **Batch 5 / #96:** `payout-account-action` and the Ops web route are the
  reviewed action surfaces. The changed `stripe.ts` module is shared more
  widely and is included in the Batch 7 conservative closure below.
- **Batch 6 / #103:** `ready-made-order-action`, `service-health`,
  `tailor-order-action` (3 functions).
- **Batch 7 / #104–#105:** `bachs-webhook`,
  `commercial-adjustment-action`, `consultation-lifecycle-action`,
  `customer-order-action`, `drapeon-dispatch-action`,
  `expire-pending-payments`, `fabric-workflow-action`,
  `material-advance-action`, `monitor-settlements`, `ops-money-action`,
  `order-tip-action`, `payment-action`, `payout-account-action`,
  `paystack-webhook`, `process-job-queue`, `refund-order-payments`,
  `release-consultation-earning`, `release-order-payouts`,
  `release-order-tip`, `release-settlement-tranche`,
  `release-tailor-adjustment`, `reverse-stripe-transfer`,
  `send-consultation-reminders`, `stripe-webhook`, `tailor-order-action`
  (25 functions; `stripe.ts` drives the broad closure).
- **Batch 8 / #115:** `auto-release`, `bachs-webhook`,
  `create-consultation-room`, `create-order-call-room`,
  `escalate-handoff-issues`, `expire-pending-payments`,
  `handle-verification-decision`, `handoff-support-action`,
  `payment-action`, `paystack-webhook`, `process-job-queue`,
  `ready-made-order-action`, `stripe-webhook`, `studio-order-action`
  (14 functions importing the changed notification module).
- **Batch 9 / #116:** `bachs-webhook`, `consultation-lifecycle-action`,
  `customer-order-action`, `drapeon-dispatch-action`, `paystack-webhook`,
  `process-job-queue`, `refund-order-payments`,
  `send-consultation-reminders`, `stripe-webhook`, `tailor-order-action`
  (10 functions importing the changed refund modules), plus the Ops web
  changes from #116 and #117.

These are source-derived candidates, **not deployed version evidence**. The
final release manifest must record the merged commit and the deployed Dev
version of every selected function, with one owner-approved Production step
at a time.

## Authorized read-only Production inventory — 2026-10-30

No Production data was changed. The authenticated Stripe Live Dashboard showed
3 connected accounts: 2 linked to Production tailor profiles and 1 unmatched.
All 3 were restricted, with zero balance and volume and no bank account. A
read-only Production database query found 10 profiles with Stripe selected but
no saved connected-account ID. Exact account and profile identifiers are held
in the owner's restricted Ops inventory; they are omitted from this public
report. Investigate through the [authenticated Ops provider workspace](https://ops.drapeon.co/ops/providers)
before any cleanup. No account was deleted or edited.

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

The Dev Ops flow authenticated a bound founder principal with verified MFA.
The protected Ops case was opened under that role with workforce verification. A local-only
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
live-mode API operation was used in this preflight. Dev sign-in protection remained enabled.

The two bound Dev Ops principals remain distinct, active, development-only,
with completed multifactor verification. A real iOS Dev customer session and a real Pixel
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
The founder and QA approver have distinct Auth users.
No credential material is included here. No Money Desk request or
approval receipt has been created in this regression yet. Approval-dependent
cases are pending an actual UI session and fresh multifactor verification.

## Part 2 — two-person flows

| Case | Status | Evidence / blocker |
| --- | --- | --- |
| D4 refund racing payout | BLOCKED | The previously rejected fixture tip remains quarantined; no replacement paid fixture or approval receipts are available. |
| C3 USD adjustment | BLOCKED | No eligible Stripe-payout-ready adjustment fixture; real Money Desk approval UI is not configured. |
| C7 destination correction | BLOCKED | No usable linked Dev Stripe destination for the fresh tailor; onboarding failed before account linking. |
| E2 route enablement | BLOCKED | The only Dev Stripe route is already ENABLED; local MFA login is blocked by the unconfigured security check, so no two-person route change was attempted. |

No approval request or receipt was created.

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
   was entered in this run.
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
and 10 Prod tailor profiles with
`payout_provider='STRIPE'` but no `stripe_connect_account_id`. No Production
query or action was performed in this follow-up.

### Production inventory reminder (read-only, previously approved)

The earlier read-only Production inventory remains unchanged: Stripe Live had 3
connected accounts, of which 1 had no matching Prod profile; the 3 accounts displayed restricted with $0 balance/volume and no
bank account. The read-only Prod profile query found 10 rows with
`payout_provider='STRIPE'` and no `stripe_connect_account_id`. No cleanup or
other Production change has been made. Release order remains server
`payout-account-action` before the mobile OTA.

## Part 1 checkpoint after final-code Dev verification — 2026-10-30

| Case | Status | Evidence / blocker |
| --- | --- | --- |
| #90 final-code onboarding retest | BLOCKED | The existing Pixel profile/account is already linked and verified. Dev Edge v97 served seven HTTP 200 requests, but logs do not expose the action and no fresh Account Link was initiated; the earlier end-to-end PASS predates v97. Current payout-ready state is confirmed in the UI and DB; no money moved. Screenshot linked above. |
| C1 80/20 tranche release | BLOCKED | The dedicated iOS customer submitted real order `DRPVFZPNC` (`a0febd22-fcb4-4722-9fbd-b2a900faa25b`) to `Stripe Regression Atelier`; UI and Dev DB agree on `PENDING_QUOTE`, but that disposable fixture had no usable app session. The legitimate fallback `Pixel QA Tailor` is verified and Stripe-linked, but its genuine destination remains `PENDING`/inactive and the supported app blocks its first paid order. No quote, payment, or transfer exists. |
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

The disposable `Stripe Regression Atelier` fixture lacked a usable session.
No alternate authentication or impersonation was used. The safer replacement is
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
fallback after the disposable `Stripe Regression Atelier` fixture session
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
No direct ledger or configuration write, provider top-up, or synthetic
payout event was used to break this cycle. This is a launch-blocking first-order bootstrap defect, but not a
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

A Dev founder Ops session reached AAL2 before the clearance review. The guarded legacy Ops payout workspace then rendered Pixel's real
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
- actor workforce principal `[redacted auth user ID]`;
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
on either attached device and a usable QA session was unavailable. No direct quote write was used. C1 remains
**IN PROGRESS — awaiting legitimate tailor authentication**, not failed.

The preserved Pixel session was subsequently recovered from the physical
Android QA development client through the supported sign-in flow. Pixel
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
  `QA approver` at AAL2;
- second approval event `2b286c9d-1663-4fe0-9984-e37669c33367` by the
  distinct AAL2 principal `second QA approver`;
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
reviews and multifactor verification. No credential or session material is included in this report. The repo's `docs/dev-e2e-accounts.md` still says the
second principal was not provisioned; that runbook statement is stale and is
logged for a docs-only follow-up. This does not supply an authenticated Pixel
tailor session.

##### Pixel session recheck — 2026-11-04 16:24 UTC

Read-only ADB screenshot confirms the Dev app is currently at its ordinary
sign-in screen, with blank fields. No sign-in was completed. A fresh read-only
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

The Pixel reached the normal account verification screen for an unrelated QA
fixture. The correct tailor session and push token were still unavailable. No
payment, notification, inbox, or review state changed.

##### Pixel email verification completed — 2026-11-04 17:33 UTC

The unrelated QA fixture completed the supported Dev sign-in and opened the
tailor setup screen. Evidence:
[`pixel-dev-qa-account-setup-20261104.png`](evidence/pixel-dev-qa-account-setup-20261104.png).

This session belongs to the disposable regression tailor, whose app shows four incomplete go-live steps. It is **not**
the payout-ready `Pixel QA Tailor` profile
`5cc8ec2b-c4cb-4299-b9e6-aaf0aa2a44a7` that owns the paid order
`DRP2710RP`. This successful sign-in does not prove that tailor's order screen, push token, or
notification tap. Those checks remain **BLOCKED — correct account session
unavailable**. No payment, payout, refund, notification job, or ledger state was
changed by this verification.

##### Independent D1 fixture check — read-only, 2026-11-04 17:36 UTC

Dev order `DRP1ME4AJ` (`a8774cbd-f25c-4c37-b62c-026b1c024aa6`) is owned by
the same QA customer as `DRP2710RP`, but by a different tailor. Its one payment
`9bf7ae52-8a77-4f0f-a090-3e9ca212c7f5` is `SUCCEEDED` for 13,531 USD minor
units. It has **zero** payout rows and **zero** payout claims. This makes it a
separate candidate for D1's refund-before-payout proof without consuming the
order reserved for post-deploy notification evidence. The iOS Simulator is
currently on the customer sign-in form, so no cancellation review or refund was
started. The supported confirmed-order path still requires a cancellation
review and then a two-person Money Desk refund; do not mark D1 passed from
this preflight.

The existing `DRPZHHLGH` $80 fabric release still has exactly one transfer ID
on payout `78f6352d-2c22-43f0-ab4e-0b7793b846e4`, with status
`PROCESSING` / `AVAILABLE_IN_PROVIDER_BALANCE`; the original payout
`60eae409-8419-464f-967d-a3bb9f9d69da` is `FAILED`. No additional payout
row or transfer was observed in this read-only check. This is a status snapshot,
not new evidence for the 80% tranche.

##### Correct Pixel QA tailor session restored — 2026-11-04 18:23 UTC

The Pixel 8 left the unrelated fixture account. The normal Dev recovery link
incorrectly pointed to the Production web host, which rejected the Dev request.
This is a cross-environment recovery-link defect. The correct Dev QA tailor then
signed in through the supported app flow. No Production data was read or changed.

The authenticated Pixel dashboard now displays the two orders owned by the
correct profile `5cc8ec2b-c4cb-4299-b9e6-aaf0aa2a44a7`: `DRP2710RP`
(`Paid Order`) and `DRPZHHLGH` (`Ready for Drapeon Dispatch`). The Pixel
opened `DRP2710RP` through its order card. Receipt
`DRP-2026-00000024` shows **$135.31 captured**, matching the previously
verified 13,531-minor-unit PaymentIntent
`pi_3UY4tMCrvCJ1ybBB0fuZdIz4`. Screenshot:
[`pixel-dpr2710rp-receipt-20261104.png`](evidence/pixel-dpr2710rp-receipt-20261104.png).
Read-only Dev query confirms Android push token row
`3456c712-0bf2-4b54-b338-677eb20d3e96` for the correct tailor Auth user,
updated 18:21:19 UTC. This establishes the device state needed for a **new**
post-sign-in push test. It does not retroactively prove delivery or tap of the
earlier push job, which ran before this token existed. No new payment, payout,
refund, or notification job was created during this session restoration.

##### C1 push audit discrepancy — fix awaiting review

The `DRP2710RP` customer `SEND_PUSH` job's `DELIVERED` audit row is contradicted
by its later Expo `DELIVERY_ERROR / DeveloperError / BadDeviceToken` receipt.
The worker currently labels a provider ticket as delivered, while the receipt
processor writes only to `push_delivery_attempts`. This is a wrong-status and
alerting defect, not money loss. Draft PR
[#115](https://github.com/Drape-ltd/drapeon/pull/115), head
`04b1b4973e04d1131aac66e6bfdb618d6ab39102`, binds each ticket attempt to
its durable notification job and reconciles the job audit atomically with a
terminal receipt update.
It passed a Dev migration-and-behavior test entirely inside `BEGIN … ROLLBACK`;
the migration is **not applied** on Dev or Production. A fresh post-deploy
notification will be required for proof after review and merge. The historical
row cannot safely be rewritten by guessing which receipt belongs to it.

##### D1 customer cancellation review opened — 2026-11-07 19:20 UTC

On the iPhone 17 Pro simulator, the signed-in Dev QA customer opened paid
ready-made order `DRP1ME4AJ` (`a8774cbd-f25c-4c37-b62c-026b1c024aa6`)
and used **Cancellation and refund review → Request cancellation review**.
The reason was `CUSTOMER_CHANGED_MIND`, with a Dev QA note requesting review
before seller preparation or payout. The app then showed **Under Review** and
the saved request in the order timeline. Screenshots:
[`d1-review-ready-20261107.png`](evidence/d1-review-ready-20261107.png) and
[`d1-review-submitted-20261107.png`](evidence/d1-review-submitted-20261107.png).

Read-only Dev verification found:

- `orders.stage = IN_DISPUTE`, with an `OPEN` cancellation review requested
  from `CONFIRMED` at `2026-11-07T19:20:32.628Z`;
- stage update `48d4ae78-78a4-4168-bc5f-5c093a81ea9e` and audit event
  `2461b7a1-b3b5-47e2-a3c2-a899c4355752`
  (`order.cancellation_review_requested`);
- open HIGH Ops case `bfafd1d7-1918-4945-a183-18baba113d57`;
- payment `9bf7ae52-8a77-4f0f-a090-3e9ca212c7f5` remains `SUCCEEDED`
  for 13,531 USD minor units, with `refunded_amount = 0`; no payout exists;
- one tailor push job `c5ddc219-7361-404b-b9c9-fab31322356a` and two
  order-event email jobs `d5f26d03-b0bf-4e74-bbc1-f456c5ff65f1` and
  `7f53e250-d244-4b33-a885-b9548f9eb8dc` were `PENDING` at the first
  check. All three later reached `SUCCEEDED` on their first attempt with no
  recorded error. Provider delivery and recipient tap remain unverified.

**D1 remains IN PROGRESS.** The review decision and full refund must use the
supported Ops and two-person Money Desk paths. This request alone does not
prove a refund or payout block.

##### D1 stop: cancellation review has no Money Desk refund path — 2026-11-07

The founders Dev MFA session was verified in the local Ops app, and the web
Ops **Order reviews** screen showed `DRP1ME4AJ` with its order and unreleased
settlement paused. Clicking **Approve cancellation** with a reason returned
“This Ops action could not be completed.” The order-review form posts
`order-review-resolution` with outcome `REFUND`; the web action route rejects
that legacy direct money decision with `money-desk-required` before its old
refund handler can run. This guard is working as intended.

The supported `order-cancellation-refund-request` Money Desk preparation loads
`loadCancellationRefundSnapshot`, which requires an active row in `disputes`.
Read-only Dev checks found **zero dispute rows** for this order. The customer
**cancellation review** created an `ORDER_REVIEW` Ops case
`OPS-02DEFF37` (`bfafd1d7-1918-4945-a183-18baba113d57`) but no dispute
row. The existing Money Desk for this order shows zero requests. Therefore the
customer's normal cancellation path cannot reach the reviewed refund path.

After the rejected click, order `a8774cbd-f25c-4c37-b62c-026b1c024aa6`
remained `IN_DISPUTE`; payment `9bf7ae52-8a77-4f0f-a090-3e9ca212c7f5`
remained `SUCCEEDED` for 13,531 USD minor units with `refunded_amount = 0`.
There are **zero refund claims and zero payout rows**. No Stripe refund or
transfer was initiated by this click. Classify this as **stuck money**:
the order is paused and the paid customer's approved cancellation cannot be
completed through the reviewed path. **D1 STOPPED before any fix or retry.**

##### D1 fix review checkpoint — 2026-11-07

Draft [PR #116](https://github.com/Drape-ltd/drapeon/pull/116), head
`db90b8b46cc1d57d44032ffdc49f6471c11dd474`, adds the open cancellation
review and matching `ORDER_REVIEW` case as a pinned Money Desk refund source.
It keeps the formal dispute source, the independent approval requirement, and
all three hardening patches in the effective database finalizer and rollback.
The Ops review screen now directs cancellation refunds to Money Desk rather
than the rejected legacy action. **Both CI checks passed; the PR is awaiting
re-review and has not been applied to Dev.**

The finalizer ran in an isolated local PostgreSQL rollback transaction with
synthetic, fully refunded payment claims. The dispute-backed and review-backed
paths each closed the order and source record, resolved the case, completed
the execution attempt, and returned an idempotent duplicate outcome on replay.
The same fixture failed on the earlier #116 head with `text = uuid`, proving it
detects the stale function regression. A full local Supabase reset was blocked
by historical migrations that require preexisting Dev data and a column added
later in the chain. The isolated fixture used the observed text order/dispute
identifier types and the live terminal RPC signature, with a UUID
`disputes.resolved_by` to exercise the stricter lineage. This is local proof,
not a Dev refund result.

Separate draft [PR #117](https://github.com/Drape-ltd/drapeon/pull/117), head
`70bb8ed20164791f6b6e13c32b571e805475978e`, corrects the existing web
route that writes an operator email into `disputes.resolved_by`. Its mocked
client test fails when that email write is restored and passes with `null`;
local launch contracts passed. It also awaits review and Dev rollout.

**D1 remains STOPPED.** No new Stripe TEST refund, payout, or ledger posting
was made during these fixes. After both PRs are reviewed and merged, apply the
approved migration and deploy the affected Dev Edge/web builds from main,
then resume the two-person Money Desk refund and reconcile 13,531 minor units.

### Current A–G checkpoint — 2026-11-07

This supersedes the 2026-11-04 status table; earlier case evidence remains in
the sections above. A local test or green PR is not a Dev end-to-end pass.

| Area | Status | Current evidence / next proof |
| --- | --- | --- |
| A–B | NOT REVERIFIED | Earlier work was reported, but the case-level Dev/Stripe evidence has not been rechecked in this run. |
| C1 | PARTIAL | Paid ready-made capture reconciled at 13,531 minor units; custom-order dispatch, custody, 80% tranche and device notification proof remain. |
| C2–C7 | NOT COMPLETE | C2 has prior fix evidence, but the end-to-end races and remaining cases need fresh fixtures and verification. |
| D1 | STOPPED — STUCK MONEY | `DRP1ME4AJ` is paid and paused with no supported cancellation-review refund path on Dev. #116 and #117 are unmerged drafts. |
| D2–D7 | NOT COMPLETE | No new end-to-end refund/dispute case passed in this checkpoint; D4 remains quarantined. |
| E | PARTIAL | MFA session and Ops review UI were observed for D1; the reviewed money action, queue outcomes and full audit/alert checks remain. |
| F–G | PARTIAL | Paid customer view exists; tailor/web timelines and final push, alert and tap proof remain. |

**Defects ranked at this checkpoint:**

1. **Stuck money:** D1's ordinary paid cancellation review cannot start a
   Money Desk refund. #116 is the proposed fix; #117 corrects the separate
   dispute-backed web finalization hazard. Neither is merged or Dev-tested.
2. **Wrong notification status and delivery gap:** a prior customer push was
   audited as delivered despite an Expo delivery error. #115 remains under
   review; a new signed payment is needed for device tap proof.
3. **Coverage and display gaps:** the remaining C–G cases, device timelines,
   Ops queue/alert behavior and Production release invariants are unverified.

**Production verdict: NOT READY.** No route, migration, Edge build or mobile
release should be advanced from this checkpoint. Exact final release SHAs and
versions must be filled in after reviewed merges and Dev regressions.

### D1 reviewed refund preparation — 2026-11-08 04:31 UTC

The stopped checkpoint above predates the #117, #116 and #118 merges. On Dev,
the cancellation-review refund migration `20261107194113` is present. A QA Ops
preparer used **Order reviews → Prepare Money Desk refund** for paid order
`DRP1ME4AJ` (`a8774cbd-f25c-4c37-b62c-026b1c024aa6`) after fresh Money
Desk elevation. Request `MD-190E7F7F03`
(`52f6507e-fe24-477c-8802-474d937b39e9`) is for **USD 135.31**, with
status **Pending Approval** and **0 of 2** independent approvals. The required
third Dev QA principal is active, bound to a distinct Auth user, and permitted
in development; no approval has been recorded.

Read-only Dev verification after preparation: order stage `IN_DISPUTE`, payment
`9bf7ae52-8a77-4f0f-a090-3e9ca212c7f5` status `SUCCEEDED`, refunded amount
zero, payout row count zero, and exactly one Money Desk request for the order.
**No refund has been executed. D1 is IN PROGRESS, not PASS.** Remaining proof:
two independent MFA approvals; supported execution; one Stripe TEST refund for
exactly 13,531 minor units; ledger, customer, tailor and Ops reconciliation;
notification terminal outcomes; and webhook replay without duplication.

#### D1 second-approver login stop — 2026-11-08

The account owner completed Dev password recovery and real MFA, then recorded
the first independent approval on `MD-190E7F7F03`. The Money Desk and read-only
database both show `PENDING_APPROVAL`, **1 of 2** approvals, and 13,531 USD
minor units. The payment remains `SUCCEEDED` with zero refunded.

The second Dev QA approver is an active, bound, development-only workforce
principal with a verified TOTP factor. Its password sign-in through the
supported `/local-mfa` page returned **“This is not an approved Dev QA
identity.”** The page's server-side email allowlist still admits only the
original two principals, while the third-login change is in draft PR #106.
The factor ID was present before sign-in; the rejection was an identity
allowlist decision, not a missing authenticator field. **D1 STOPPED: the
required second approval cannot be recorded through this Dev login build.**
No refund, payout, or transfer was initiated. Do not lower the two-approver
requirement or execute the request through SQL.

#### D1 third-approver Dev drift and gate preflight — 2026-11-08

Read-only Dev audit found `20261103031900` absent from migration history, while
the live `bind_dev_ops_mfa_principal` body already included the third QA email.
The third workforce principal was seeded manually, is `ACTIVE` and
development-only, and is bound to a confirmed Auth user with a verified TOTP.
Auth logs show enrollment and verification, but do not prove the exact binding
RPC invocation. Merged #106 (`03b640d21c11ea046e0849f1aa84d40ec2ff7e61`)
records the effective function in forward migration `20261108045200`.

Before the release, both local web runtimes and the Dev `ops-money-action`
secret lacked `OPS_MONEY_APPROVER_EMAILS`, so all three `DECIDE` gates defaulted
to the founder alone. The Dev Edge secret is now set to the reviewed three
addresses; its returned digest matched the intended list. The Ops app on
`127.0.0.1:3006` and web Ops route on `127.0.0.1:3005` were restarted from
merged main with the same list in ignored local environment files. Both routes
responded with HTTP 200. A direct evaluation of their shared decision policy
with each runtime's configured list accepted the third QA address and denied
an outsider; source inspection confirmed each `DECIDE` route calls that policy.
This is a **gate preflight without an approval receipt**, not a completed
second-person end-to-end decision.

Read-only Dev Money Desk check still showed `MD-190E7F7F03` as
`PENDING_APPROVAL`, **1 of 2**, for 13,531 USD minor units. No decision,
execution, refund, payout, transfer, or direct SQL money change was made in
this preflight. A fresh third-principal MFA session and supported approval
remain required before execution.

#### D1 approved execution stopped at refund adapter — 2026-11-08 05:41 UTC

The third Dev QA approver completed a separate AAL2 session and recorded the
second independent approval. Read-only Dev records show two distinct workforce
principals and Auth user IDs, both with `SUPABASE_MFA_LOCAL` receipts. Request
`MD-190E7F7F03` reached **APPROVED, 2 of 2** at 05:36:55 UTC. The founder Ops
principal then completed fresh MFA and a 15-minute Money Desk elevation and
clicked **Execute approved action** through the supported web UI.

The request and its single execution attempt became **FAILED** at 05:41:35
UTC, with code `EXECUTION_ADAPTER_BLOCKED` and message “This refund action
requires a trusted service request.” The attempt has no provider reference.
The Dev `refund-order-payments` handler returns this 401 at its service-token
guard, before parsing the refund or calling Stripe. Read-only Dev checks after
the failure found the payment still `SUCCEEDED` for 13,531 minor units with
`refunded_amount = 0`, zero provider-refund rows, and zero refund-claim rows.
No payout or transfer was requested for this D1 action. **D1 STOPPED — STUCK
MONEY.** The failed request is terminal; do not retry it or alter money state
through SQL. Diagnose the Dev adapter-to-refund authentication path and use a
new reviewed request only after a separately reviewed fix.

Read-only Dev function logs confirm HTTP 401 from `refund-order-payments` v80
at 05:41:35 UTC. Code tracing found that the Ops web request sent its service
key as `apikey` and `X-Drape-Service-Key`, while this refund handler accepts
only an `Authorization` bearer token. PR #119 adds that header with a
request-level red/green test. The two approved receipts belong to the
terminal failed request and must not be treated as approval for a new request.

#### D1 adapter fix merged; replacement preparation pending — 2026-11-08 06:09 UTC

PR #119 passed both CI checks and merged as `887d8938d3d887f4bc01efc4f7e6b243e4c1c23a`.
The Dev Ops web was restarted from that merged main commit. Read-only Dev
checks still show the cancellation review and ORDER_REVIEW case OPEN. The
original request remains FAILED, and no refund has been sent. A new 13,531
minor-unit request must be prepared through the Ops review UI by a fresh QA
MFA session, then independently approved. **D1 remains BLOCKED pending that
session and the supported refund proof; it is not PASS.**

#### D1 replacement request blocked by reused idempotency key — 2026-11-08

The third QA principal completed fresh Dev MFA and Money Desk elevation. In
Order reviews, the cancellation card for `DRP1ME4AJ` was still open. The Ops
web preparation action returned **“Money Desk idempotency key was reused with
different values.”** No new request was created. Read-only Dev checks still
show one captured USD 135.31 payment with zero refunded, zero payout rows,
zero refund resolutions, and the original review case OPEN.

The route constructs the preparation key from order ID, review request time,
and payment snapshot key. All three are unchanged after a terminal FAILED
execution. The replacement request therefore collides with the failed one;
a different preparer or reason changes the request fingerprint. This is a
**stuck-money recovery defect**. Stop before another retry or code change;
the failed request and its approvals cannot authorize a replacement.

#### D1 replacement executed; webhook replay pending — 2026-11-08 16:41 UTC

PR #120 merged as `2697cf60c0fe5667206f8beec7fb026868bc2f04` with an
explicit owner-authorized GitHub review bypass after both checks passed. The
Dev Ops web ran from that merged commit. Before preparation, read-only checks
confirmed the first request `MD-190E7F7F03` and its sole attempt remained
`FAILED` with `EXECUTION_ADAPTER_BLOCKED`; the payment was `SUCCEEDED` with
zero refunded, and the cancellation review and case were `OPEN`.

The third QA principal prepared replacement request `MD-C156312F3D`
(`7b21c9b2-bfce-467d-a3ea-a485cc73a79c`) through Order reviews. Its
`recoveryOfRequestId` points to the failed request
`52f6507e-fe24-477c-8802-474d937b39e9`; audit row
`c05da652-c4e1-4790-8aa4-4c5cdda6058a` records the same link. Repeating
Prepare created no second replacement request. The founder and first QA
principals used separate real MFA sessions and independently approved the
13,531 USD minor-unit request. It reached `APPROVED`, **2 of 2**, at
16:40:55 UTC. The founder executed it through the supported Money Desk UI.

The request and its only execution attempt
`e13f1a9f-24eb-40d4-bc42-00fb28dd1d14` are `SUCCEEDED`. Stripe TEST has
exactly one refund `re_3UXwFjCrvCJ1ybBB1vkJGeJu` on PaymentIntent
`pi_3UXwFjCrvCJ1ybBB1EyLQVPr`, `succeeded` for **13,531 USD minor
units**. Dev provider-refund row `d0b5c880-4b6d-4c4e-b57c-adacaf4eb58d`
is `CONFIRMED` for the same amount. Payment
`9bf7ae52-8a77-4f0f-a090-3e9ca212c7f5` is `REFUNDED` with
`refunded_amount = amount = 13531`; order `DRP1ME4AJ` is `REFUNDED`, its
cancellation review is `RESOLVED`, and `OPS-02DEFF37` is `RESOLVED`.
There are **zero payout rows** for this order. The capture ledger has a
13,531 debit to provider clearing against 12,500 tailor entitlement and
1,031 tax liability credits; refund transaction
`c0e32a9a-8042-4351-8fe3-c8f833d3184e` reverses those entries exactly.

The four newly queued communication jobs reached terminal outcomes at
16:45 UTC: both emails `ACCEPTED`, customer push `DELIVERED`, and tailor
push `SKIPPED / NO_TOKEN`. No job dead-lettered. The tailor device did not
receive a push, so the counterpart notification tap remains **NOT VERIFIED**.

Stripe's `refund.created` and `refund.updated` webhooks arrived during the
refund write. Their first queued processing attempts returned 500 with
“provider refund completed, but ledger reconciliation is still pending.”
Both webhook jobs remain `RETRYABLE` after one attempt, with no second
provider refund or ledger posting. The ledger is now balanced, but natural
webhook replay, duplicate suppression, and customer/tailor screen evidence
remain **NOT VERIFIED**. Do not mark D1 PASS until those checks finish.

At 16:52 UTC, the signed-in Dev QA customer opened `DRP1ME4AJ` on the iOS
Simulator. The Completed orders list and detail both showed **Refunded**.
The purchase detail accessibility tree showed a $125.00 subtotal, $10.31
TX tax at 8.25%, and $135.31 total. The payment receipt still showed its
historical **Payment captured $135.31** and explicitly says refunds appear
separately; it did not falsely rewrite the capture receipt as a refund.
Screenshots: [refunded order](evidence/d1-customer-refunded-order-20261108.png)
and [captured receipt](evidence/d1-customer-captured-receipt-20261108.png).
The screen's pickup-plan text says **New York, USA**, matching the tailor
profile's general location, while this order's locked pickup tax region is
TX. This is a display/source-location discrepancy to investigate separately;
no tax or refund amount mismatch was observed. The tailor device screen and
notification tap remain **NOT VERIFIED**.

#### D1 stop: refund webhook replay fails after settled refund — 2026-11-08 17:11 UTC

The scheduled `process-money-jobs-recovery` sweep retried both Stripe TEST
refund webhook jobs. `refund.created` job
`77117fee-f022-4e56-841d-5876a9996dee` and `refund.updated` job
`26320a6d-ee23-459d-b42d-2a7209a97824` each returned HTTP 500 again;
both are `RETRYABLE`, attempt **2 of 12**. The webhook reports that the
provider refund completed but ledger reconciliation is pending. The new
CRITICAL issue `c62e287b-066a-4b92-a1d2-e2ee59e0143a` remains `OPEN` and
records the underlying error: **“Refund exceeds the remaining captured
allocation.”** This is inconsistent with the already balanced refund ledger.

Read-only code review found that the webhook's duplicate fast path compares
`latest_refund.response.id` to the Stripe refund ID. The stored response ID
instead identifies an earlier `payment_intent.succeeded` event, so the
completed refund is not recognized as a duplicate. The retry then calls
`record_confirmed_order_payment_refund` again and attempts another ledger
refund against the exhausted captured allocation. This is the suspected
cause, pending an isolated failing test. No second Stripe refund, provider
refund record, or ledger reversal was observed. **D1 is STOPPED, not PASS.**
Do not retry the provider refund or alter money state to clear this alert.
Fix the webhook replay as a separate reviewed PR with red/green proof, then
verify both queued jobs reach terminal success and the false CRITICAL issue
resolves. The Pixel notification tap remains unverified separately.

Draft [PR #121](https://github.com/Drape-ltd/drapeon/pull/121) at
`6f8db6e86224ec496cd314cea198fb2e83f7844c` proposes that replay fix.
Four new tests fail on merged main and all 18 affected tests pass on the
branch; both CI checks passed. The PR is **not merged or deployed**. The Dev
queue, refund, ledger and Ops case have not been changed by this fix work.

At 17:32 UTC, before #121 merge or Dev deployment, the read-only baseline is:
payment `REFUNDED` with `refunded_amount = 13531`; **one** confirmed provider
refund totaling 13,531; **one** REFUND journal; both queued webhook jobs
`RETRYABLE`, attempt 2. The exact-ID false CRITICAL case is still open.
Review requested that the new direct ledger tests run in the launch contract.
Commit `f7f5f92fe761dca225bce5b573ae2f4ac9c94e30` adds that single test
entry and passed the local Node 22 launch contract. Dev state remains unchanged.

##### D1 replay rollout inventory — read-only, 2026-11-08

The repo's static relative-import closure for #121's changed
`commercial-ledger.ts` and `payment-refunds.ts` reaches 17 Edge entrypoints:
`bachs-webhook`, `commercial-adjustment-action`,
`consultation-lifecycle-action`, `customer-order-action`,
`drapeon-dispatch-action`, `expire-pending-payments`,
`fabric-workflow-action`, `material-advance-action`, `order-tip-action`,
`payment-action`, `paystack-webhook`, `process-job-queue`,
`refund-order-payments`, `release-order-payouts`,
`send-consultation-reminders`, `stripe-webhook`, and
`tailor-order-action`. This is a deployment inventory, not evidence that
the change is live. The current Dev `stripe-webhook` is v161,
`refund-order-payments` v80, and `process-job-queue` v128. Refresh all
versions and digests immediately before and after the Dev rollout from
merged main. The Pixel 8 is not attached (`adb devices` returned no device),
so tailor screen and push-tap proof remain unavailable.

##### D1 refund replay postflight — 2026-11-08 17:41 UTC

PR #121 merged as `e1982e1e14879696b25e9ea8d1889d0910f36836`.
The guarded Dev-only deploy used that exact clean merged-main checkout.
`stripe-webhook` is v162 (`bca5e7442ebf977862a9b602f3ee3452b861274a4f1c9d372c53bf7f0d945ce0`);
`refund-order-payments` is v81 (`73c839ac2fb19356b39aa286d9864210b28332cf7a5ae71b835167b03d4db65a`).
The other 15 functions in the recomputed import closure were deployed and
reported ACTIVE. Their Dev versions and digests are recorded below.

| Function | Version | Digest |
| --- | ---: | --- |
| `bachs-webhook` | 23 | `8c5732d9ffac3896745e6cfe3040219921d624591ccb3eacf7a107d114c4f90f` |
| `commercial-adjustment-action` | 52 | `e6cfa23f80429e8a8b4e9a26695f408f608544496dc1e9e40ecf9ea1e5e120c3` |
| `consultation-lifecycle-action` | 44 | `95f259a4c5e7146422b961723eaed77839e35cd254430449dd26b67726712066` |
| `customer-order-action` | 159 | `91df52cc6f86ae46ce022164881c11aaafd99335ac7639ccf59361f9379d5224` |
| `drapeon-dispatch-action` | 45 | `b87acc3c4d45c04312e6f6b4c21e50def19fd2540d947203a889468cd10662a6` |
| `expire-pending-payments` | 78 | `293ae6317837eaca2300390da4524e86aa932b1eac63f6a464bfd5f2fe7a5f42` |
| `fabric-workflow-action` | 52 | `0555d86b2b630faad8395ea513a8a5b1f8cc38dcbfbef2ee789a7d368ecde436` |
| `material-advance-action` | 79 | `3a1e05599b2650dd3271c0ab95efd56003c463af850bafe148d9678919e2db8e` |
| `order-tip-action` | 49 | `7634bf0636f39d384212c6767476b3e8f4737c6ff09e335ed7b8cc6312e168f5` |
| `payment-action` | 128 | `d1f66edfa4b2ae11e480ddf05496fec5a2bdd4a6e37ff1c9ee45f672235900d4` |
| `paystack-webhook` | 112 | `8c82d27e581367373ca640780e8ffc1e4b36f345dd70958dd9d6d1ec11a295de` |
| `process-job-queue` | 129 | `e6c703b76e93be64e1c4469bc5024d4831d01f5a86deae3ee4c2d00b8681a0e6` |
| `release-order-payouts` | 104 | `db5fe52e01b9ababf95771c6813c241fa72ba57adcfaf27ae6060a7cad7ecd8b` |
| `send-consultation-reminders` | 69 | `e92616d0f563e37896d3067db5cdb644be2534306675398ee6e95a1a8340cc8c` |
| `tailor-order-action` | 188 | `d50f3db9aba7006b7fe79ffe0557cce3e3c099eae1d85e561a5eab689ef8ff33` |

The normal Dev worker sweep replayed both existing refund events, without
a manual webhook call or refund retry. Jobs
`26320a6d-ee23-459d-b42d-2a7209a97824` and
`77117fee-f022-4e56-841d-5876a9996dee` are `SUCCEEDED` on attempt
3 of 12, with null errors. Events `evt_3UXwFjCrvCJ1ybBB1J2ZevnX` and
`evt_3UXwFjCrvCJ1ybBB1NHxCTSE` were processed at about 17:41:04 UTC
with result `stripe_refund_succeeded`.

The before and after money values are unchanged: payment
`9bf7ae52-8a77-4f0f-a090-3e9ca212c7f5` is `REFUNDED`, with
`amount = refunded_amount = 13531`; one confirmed provider refund totals
13,531; one REFUND journal totals 13,531; the order is `REFUNDED`; and
there are zero payout rows. Stripe TEST confirms exactly one succeeded
refund `re_3UXwFjCrvCJ1ybBB1vkJGeJu` for 13,531 USD minor units on
PaymentIntent `pi_3UXwFjCrvCJ1ybBB1EyLQVPr`. The false CRITICAL
`refund-ledger-missing` case resolved at about 17:41:04 UTC, with no new
D1 Ops issue. Money Desk request `MD-C156312F3D` and its sole attempt
remain `SUCCEEDED`; the prior failed request was untouched.

The four communication jobs are terminal: both emails `ACCEPTED`, customer
push `DELIVERED`, tailor push `SKIPPED / NO_TOKEN`. No job dead-lettered.
The iOS customer screen and receipt were checked above. The Pixel 8 is
unplugged, so tailor screen and push-tap proof remain unavailable.
**D1 financial, replay, and Ops-case invariants PASS; full D1 remains
NOT VERIFIED pending counterpart device and notification-tap proof.**

##### Next-case preflight — 2026-11-08 17:55 UTC

Read-only Dev checks show C1 custom order `DRPZHHLGH` remains
`READY_FOR_DRAPE_DISPATCH`. Fulfillment run
`4cfd7d5f-6e04-4081-bb8c-b3fc58422256` remains `QUOTE_REQUIRED` /
`UNQUOTED`: provider name, reference, actual cost, and quote time are all
null. No fulfillment event has been recorded. The reviewed USD 80.00 fabric
transfer is still the sole transfer-bearing payout row; its row status is
`PROCESSING` and provider transfer status is
`AVAILABLE_IN_PROVIDER_BALANCE`, the expected pre-withdrawal state noted
above. No dispatch or money mutation was made. C1 still needs genuine
provider quote evidence before the supported Ops quote and custody flow.

The Pixel 8 reconnected over USB. Its installed Preview app opened to the
sign-in form, rather than an authenticated tailor workspace. A user-supplied
QA tailor password attempt returned **Incorrect password**; no credential is
recorded here. D1 tailor screen and notification tap, plus C1 tailor actions,
remain NOT VERIFIED until the correct QA tailor session is restored.

##### Pixel QA tailor session restored — 2026-11-08 18:08 UTC

The owner reset the dedicated Dev QA tailor password through the protected
recovery page. The new password is kept only in the gitignored local QA env
file. The Pixel 8 Preview build accepted it, then completed the ordinary
new-device email verification. The app opened the Pixel tailor cockpit, and
the C1 custom order `DRPZHHLGH` opened with `Ready for Drapeon Dispatch`,
USD 200 seller amount, fabric complete, and delivery requested. See the
[Pixel C1 order screen](evidence/c1-pixel-dev-tailor-order-20261108.png).

The Dev database confirms this account is the tailor on `DRPZHHLGH` and
ready-made order `DRP2710RP`. D1 order `DRP1ME4AJ` belongs to a different
tailor, so this Pixel session cannot prove D1's tailor screen or a D1 push
tap. D1 remains NOT VERIFIED for those device checks. C1 is still awaiting
a genuine dispatch-provider quote; no quote, custody event, or payout was
created by restoring the session.

##### Fresh-payment push preflight — 2026-11-08 18:21 UTC

Read-only Dev checks found one Android `push_tokens` row for the Pixel QA
tailor and one iOS row for the C1 customer. The Pixel Preview app has Android
notification permission granted. The iPhone 17 Pro Simulator remains booted
with the QA customer's refunded D1 order open. The Android token was last
registered on 2026-11-04 and the iOS token on 2026-11-08; neither timestamp
proves current provider delivery. The #115 receipt-audit migration is still
unmerged and unapplied. No fresh payment, notification, or device tap was
created by this preflight. The new-payment notification case remains NOT
VERIFIED until a supported payment flow creates jobs whose receipts and taps
are checked on both devices.

##### #115 Dev rollout — 2026-11-08 18:31 UTC

PR [#115](https://github.com/Drape-ltd/drapeon/pull/115) merged at
`8d9c16a3e1a39560baede68d1517f0faa4415c18`. Its reviewed migration
`20261108181600_push_notification_receipt_audit.sql` was applied to Dev only;
the migration service recorded version `20261108183148`. Read-only inspection
found the `notification_job_id` column, reconciliation function, and attempt
trigger present (one each). The committed behavioral SQL test passed again
inside `BEGIN … ROLLBACK` after application. No Production change was made.

The guarded Dev deploy ran from a clean worktree at that merge commit. All 14
affected Edge functions are ACTIVE:

| Function | Dev version | Digest |
| --- | ---: | --- |
| `auto-release` | 61 | `adeed786d9da790c492e3bbcdbecf4c3626e452b65f85829249c01dff38e6f4d` |
| `bachs-webhook` | 24 | `aba8b4917e905909aee2622c98b0b1d18aa5a6bcafade6e260e4c8ecc9e68cf3` |
| `create-consultation-room` | 106 | `d699d798976297cd5ec10c66fc8e09dc02197cfda6abf47556fb5f7c3452c7ea` |
| `create-order-call-room` | 72 | `ef5fba0316b589e6a8615d580774af528d2961c54256e60fc5142c5d021571a6` |
| `escalate-handoff-issues` | 60 | `03667462f7b80a90b21c383663d885a4eec45f59f65fc73cba69e85c605a3f8b` |
| `expire-pending-payments` | 79 | `c251112c129a8ccc88987aadca12903402b99f465018e00a5ecc4497026e5e1c` |
| `handle-verification-decision` | 103 | `6c30fd18308e64da6f1325f2c822945a70280d0c3474fe968204861ebd695a02` |
| `handoff-support-action` | 58 | `766c32944ce8015131bb76a49ce31a1765e9ac5d667bb7e638ef924407f9f19c` |
| `payment-action` | 129 | `5a6a5d09479cc0f3612ddc8df12cd369b815cfdc512342e27d0c03e4df14e344` |
| `paystack-webhook` | 113 | `f74fd7d4bf068d2f46dce489d416cddf791b0d2aafdec7edcd833a723a8f59ef` |
| `process-job-queue` | 130 | `ca04dde4840ad35757a383437c054222eef304efd2577482b54aba1e6e77f760` |
| `ready-made-order-action` | 114 | `cc5c3dd203d9c5fec823d75ab0a76e864fc3cf1f299bea3f1f043d17d00252dd` |
| `stripe-webhook` | 163 | `8fd853ee71fdb965b403d5e2bc988ab34c687c4c2cd06a22f71686ac6573aa5b` |
| `studio-order-action` | 22 | `8ff8d1302cabfd1d3999de9c2b530bfe9c56c744fb8e9f17ebf74b69715c4b16` |

The migration rollout and SQL behavior are verified. A fresh Stripe TEST
payment, provider receipt audit, deliberately failed receipt, and real Pixel
and iOS notification taps remain **NOT VERIFIED**; no existing pre-migration
notification is being counted as fresh proof. C1 still waits for a genuine
order-specific dispatch quote and private proof image.

##### Fresh ready-made Stripe TEST payment and notification probe — 2026-11-08 18:40–18:56 UTC

To exercise the #115 receipt path through a real app checkout, the Dev QA
tailor relisted one unit of ready-made item `76c932a2-abf7-45a7-aa03-ce57df737290`
on the Pixel. Read-only Dev inspection confirmed its stock changed from zero
to one and it was live. The signed-in QA customer bought it on the iPhone 17
Pro Simulator using Stripe's published TEST card. The
[locked payment review](evidence/ready-made-dev-payment-review-20261108.png)
showed USD 125.00 item,
USD 10.31 Texas tax, USD 0 pickup, and USD 135.31 total. The order is
`DRP86SE0U` (`7c9a85af-e62a-45ee-86c6-4068d9b95447`), with payment
`f5311e09-3235-48c2-918c-00ff329066f1` and TEST PaymentIntent
`pi_3UZbADCrvCJ1ybBB1lY3bKqo`. The payment reached `SUCCEEDED` once for
13,531 minor units, and the order reached `CONFIRMED`. One ledger transaction
`9c7bf9fb-4e65-4a84-a7ae-950d934d14e0` balances: 13,531 debit to
provider clearing, 12,500 credit to tailor entitlement, 1,031 credit to tax
liability. Inventory fell back to zero. The
[Pixel tailor order screen](evidence/ready-made-dev-tailor-order-20261108.png)
showed this order.

The two `SEND_PUSH` jobs (`8cbd74e8-37d1-4934-ada4-7111f706a9cd` for
the customer and `7fda636c-2c4c-435f-90b7-5b8796767f03` for the tailor)
and confirmation email job `f9d01c4a-5e62-4305-9f79-8530e778bfa4` each
finished `SUCCEEDED` on their first attempt at 18:55 UTC. The accepted
tickets were reconciled by the supported `process-push-receipts` Edge path at
18:58 UTC (HTTP 200, three attempts checked). The tailor receipt became
`PROVIDER_ACCEPTED`. The customer receipt became `DELIVERY_ERROR` with Expo
`DeveloperError`: APNs rejected the iOS token as `BadDeviceToken` (400). The
#115 trigger corrected that notification job's final delivery outcome and
audit to `DEAD` with reason `DeveloperError`, while its queue execution
remained `SUCCEEDED`. No customer push tap can be proven. The prelaunch Ops
policy intentionally suppressed the routine provider case, as confirmed by
the Edge log `issue.prelaunch_routine_suppressed`.

The Android notification tray showed the new paid-order push, but tapping
it opened `com.drape.app.studiodev`, which had no QA tailor session, rather
than the signed-in `com.drape.app.preview` build. Android's resumed package
was inspected after the tap. Dev has only one Android push-token row for this
user, last updated November 4, so the Preview session did not register a
fresh token during this run. This is a **failed device-tap proof**, but it
does not establish a Preview deep-link defect. The regression stops under
the failed customer money-notification rule. There is no indication of a
second charge or ledger mismatch.

The Pixel Orders list and payment receipt displayed the captured USD 135.31
as `$135`, losing cents. The detail correctly labels USD 125 as the seller
amount. The ready-made receipt also showed irrelevant fabric-allowance copy.
These are observed wrong-display/UI issues, not a ledger mismatch. Current
merged main formats this receipt with two fraction digits, while the installed
Preview APK was last updated November 1. A current-build retest is needed
before attributing the rounding to current source. Notes and this correction
were sent to the dedicated app UI/UX chat.

Read-only EAS build history on November 8 showed no updates on the `preview`
branch. Its latest successful Android Preview build was
`44daf34a-b9e9-49aa-8d76-32d113c08335` from November 2, commit
`8fd7ed6a`, explicitly built without Firebase for an isolated proof. Two later
Preview builds from November 4 failed in Gradle. The old Dev app that received
the tailor push was installed October 1. Neither installed Android app is a
current-main, push-capable build with the QA tailor session. The signed-in
Preview app needs a current build with a matching Firebase client and a fresh
registered push token before its notification tap can be assessed. This new
ready-made order is a notification probe; it does not complete C1 or D1.

#### Device-build follow-up — November 8

The current-main iOS Simulator development build
`840ef96c-a0d3-45b6-9db5-02a5ce754b49` was built from `8d9c16a3`,
installed on the iPhone 17 Pro Simulator, and loaded the signed-in Dev QA
customer through Metro after the generated Studio document was built. Its
code-signing entitlements are empty: there is no `aps-environment`. At runtime,
`expo-notifications` warned that obtaining an iOS Simulator push token may
fail because of an iOS issue. The earlier customer `BadDeviceToken` receipt
therefore remains a failed provider-delivery proof; installing current JS did
not establish a working APNs path. No new payment or provider notification was sent.

A simulator-only `simctl push` with the existing Dev ready-made order ID
displayed a foreground notification banner on this signed-in customer build.
The attempt to tap the transient banner did not produce verified order
navigation, so notification-tap routing also remains **NOT VERIFIED**. This
injection did not call Expo or APNs, create a queue job, or change money state.
Expo config introspection contains `aps-environment: development`, while the
installed simulator app's code-signing entitlements are empty. A simulator
banner does not establish provider delivery for this build.

The first current-main Android development build
`30784468-40af-48df-ac8f-7a02f40ec541` failed in Gradle before producing
an APK. Expo SDK 54's generated Gradle file read
`android.enableMinifyInReleaseBuilds`, while the pinned older build-properties
plugin emitted only `android.enableProguardInReleaseBuilds` alongside enabled
resource shrinking. Gradle rejected that combination. PR
[#122](https://github.com/Drape-ltd/drapeon/pull/122) upgrades the plugin and
adds an isolated prebuild contract. The contract fails on main and passes on
the PR branch; CI is green. EAS Android development build
`8a256656-bb0b-4795-a9fd-0256e954c925` finished successfully at
2026-11-08 20:11:16 UTC from exact PR head
`5bc7f1599caf33d7612358b9f2361fae9b30ae47`. The Pixel tap remains
NOT VERIFIED until a merged-main build
can register a fresh token and receive a new test notification.

#### E4 read-only reconciliation checkpoint — 2026-11-08 20:19 UTC

The Dev database and the matching Stripe TEST platform were queried without
changing state. For D1 order `DRP1ME4AJ`, Stripe PaymentIntent
`pi_3UXwFjCrvCJ1ybBB1EyLQVPr` has one captured charge of USD 135.31 and
one succeeded refund of USD 135.31 (`re_3UXwFjCrvCJ1ybBB1vkJGeJu`). The
Dev payment is `REFUNDED` with `amount = refunded_amount = 13531`; its single
`CAPTURE` and single `REFUND` commercial-ledger transactions each have
13,531 minor-unit debits and credits. For notification-probe order
`DRP86SE0U`, Stripe PaymentIntent `pi_3UZbADCrvCJ1ybBB1lY3bKqo` has one
captured charge of USD 135.31 and zero refunds. The Dev payment is
`SUCCEEDED`, with `refunded_amount = 0`; its one `CAPTURE` transaction has
13,531 minor-unit debits and credits. **These two payment/refund subsets
match to the cent. E4 overall remains PARTIAL** until all regression orders,
transfers, and device amounts have been reconciled.
