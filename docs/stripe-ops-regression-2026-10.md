# Stripe / Ops regression — October 2026

Environment: Supabase Dev `pqptfuqogvrajozfsqzi`; Stripe test mode only.
Production was not read or changed.

## C1 quoting blocker — ZipTax endpoint

Status: **FAIL — QUOTING BLOCKED**.

On 2026-11-02, fresh order `DRPZHHLGH`
(`8731637d-ac84-419b-8397-b2c62f878c50`) reached normal Pixel-tailor quote
submission twice. Both requests failed closed with HTTP 503 before a quote or
money state was written. Dev Edge request
`01a19d2f-cb74-768b-8ef3-a5264f1dbfa0` recorded a DNS failure for the configured
`api.ziptax.com` host. The repository endpoint had used that non-resolving host
since 2026-05-01.

ZipTax's official v6 REST documentation identifies the canonical endpoint as
`https://api.zip-tax.com/request/v60` and documents the v60 response envelope
at <https://docs.zip.tax/guides/rest-api/overview> and
<https://docs.zip.tax/guides/rest-api/by-address>. Read-only checks found zero
`ZIPTAX` rows in `tax_rate_cache` in both Dev and Production, with no earliest
or latest successful cache timestamp. This is a product defect that blocks all
new US/Canadian quotes; it is not classified as a passing provider outage.

Review found a second money-correctness defect in the first fix: ZipTax's
documented v60 response contains paired sales and use entries in `baseRates`.
Reconstructing the total from every base row would double the documented 7.75%
example to 15.50%. The corrected parser requires exactly one `SALES_TAX` entry
in `taxSummaries` and fails closed when that provider total is missing or
ambiguous; it never derives money from `baseRates`.

No quote was accepted, no payment was created, and no money moved. C1 remains
blocked until the reviewed endpoint/parser fix is merged, deployed to Dev, and
the same order resolves `78701` from live ZipTax rather than cache.

The first post-merge live retry reached ZipTax on 2026-11-02 but returned
provider code `110` because the request mixed address and postal-code lookup
modes. Dev ZipTax usage at that checkpoint was **0/100 metered calls** in the
current billing term; the regression has made **1 provider request attempt**
against the corrected host. Keep both counters current after every subsequent
live tax lookup because failed requests may not appear in the provider's
metered total.

Owner decision recorded on PR #103: transactional tax cache entries are scoped
to the normalized structured delivery address, never only the ZIP/postal code.
A ZIP can span city and special-tax-district boundaries, so a ZIP-level hit is
money-incorrect even when it saves a provider call. The first migration marks
legacy ZIP-only rows with a NULL address key so they are never eligible for an
address lookup. The adjacent forward migration then removes those legacy rows,
makes `address_key` required, and restores a primary key on
`(country_code, address_key)`. Dev contained one legacy row and zero
address-scoped rows before that migration; it now contains zero cache rows.

## Production migration ordering (plan only)

After the previously reviewed PAY-003 Batch 1 and C2 Batch 2, apply
`20261030133137_dev_ops_supabase_mfa_identity_receipts.sql` immediately followed
by `20261030151320_repair_local_mfa_receipt_triggers.sql` in the same schema
parity batch. Never ship the first migration without its adjacent repair. Its
local-MFA functions remain gated off outside the exact Dev project. The manual
QA-principal seed is never part of a Production batch.

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

Regression remains paused until the supported localhost fallback authenticates
two real Supabase users with verified TOTP MFA. The current environment-signed
`local-workforce` bridge is not acceptable evidence for this gate.

## A4 — Stripe TEST 3DS return on iPhone 17 Pro, 2026-11-11

Status: **PASS for the Dev 3DS return and money invariants**. This is a later
test result; the historical C1 and D4 stops above describe their earlier state.

The iPhone 17 Pro Dev client was reloaded from merged `main`
`889f8c023c05f0f18a3d144a29574b9654e75053` (PR #174). The QA customer
submitted ready-made pickup order `DRPCH7Z4V` using the Stripe TEST 3DS card
ending `3155`, completed the provider challenge, and returned inside Drapeon.
The order screen said payment was confirmed. Its in-app Receipt opened and
showed **Payment captured $135.31**, with $125.00 tailor work, free fulfillment,
and $10.31 TX tax. The receipt displayed the same PaymentIntent as the Dev
payment record. The read-only simulator screenshot is retained locally at
`/private/tmp/drape-a4-in-app-receipt-20261111.png`; it is not a repo artifact.

Read-only checks found exactly one Dev `order_payments` row
`2194cec6-a7d1-4b22-ade6-583930c8b9a7` for order
`563e8324-0e2f-4143-83b8-ab1cf7417e9a`, status `SUCCEEDED`, amount
13,531 USD minor units. Stripe TEST search by order ID found exactly one
PaymentIntent, `pi_3Uage5CrvCJ1ybBB1QETwWZ6`, status `succeeded`, amount
13,531, `livemode=false`, with charge `ch_3Uage5CrvCJ1ybBB1jWMJK56`.
Dev has exactly one linked `CAPTURE` journal
`1133e3a8-33ec-4a54-b6e9-b706f7d2c292`: debit `PROVIDER_CLEARING`
13,531; credit `TAILOR_ENTITLEMENT` 12,500 and `TAX_LIABILITY` 1,031.
The journal balances to zero minor units. No second Pay tap or provider
capture was made.

The same order queued two push jobs and one order-confirmation email job, each
with a `SUCCEEDED` worker status on attempt 1. The authoritative delivery
outcomes differ: customer push job
`2269efb5-d75a-4f20-9501-a6b1d2c7ed99` is `DEAD / DeveloperError`, tailor
push job `17224522-df8d-494c-bc5e-0b2c6070d5f7` is `SKIPPED / NO_TOKEN`,
and email job `f85f23a3-593d-4edc-baed-327a87f381e2` is `ACCEPTED`.
Therefore cross-device notification delivery and taps remain **NOT VERIFIED**;
the `SUCCEEDED` queue statuses do not prove push delivery. No resend was
triggered by this read-only check. The `DEAD` customer push produced one open
HIGH `Money-event push failed` Ops issue
`418ffdb7-aa7b-4048-bd63-daab94675b77` at 19:13 UTC. No Ops issue matched
the tailor's `NO_TOKEN` job in this read-only check. This proves a narrow
money-push alert path, not the full G1 alert and recovery case.

Follow-up read-only receipt inspection found two iOS device attempts for that
customer job. Both ended `DELIVERY_ERROR / DeveloperError`; Expo's underlying
APNs reason was `BadDeviceToken` (HTTP 400). One token row predates this test,
and the other was updated before the checkout. `push_tokens` stores platform
and device ID but no Expo project ID, so the database cannot prove which Expo
project issued either token. APNs rejected both tokens, but the exact
configuration cause remains unverified; this is not proof that the iPhone
itself failed. Across earlier jobs, those two token rows have nine attempts
and all nine failed with `BadDeviceToken`; both rows still exist. The receipt
worker only retires `DeviceNotRegistered`, so this repeated failure is a
separate token-retirement/credential diagnosis gate. Neither attempt was
resent or altered.

Current mobile registration calls `getExpoPushTokenAsync` with project ID
`4729d6f8-273a-43a9-abdf-6e4ca31ce83d`, which matches the Dev build
configuration. The two failing token rows are distinct installation IDs, but
the registration RPC stores neither project ID nor app variant. Thus source
configuration supports correct attribution for new registrations, while the
existing token provenance and APNs credential/bundle match remain unproved.
Expo's [push setup guide](https://docs.expo.dev/push-notifications/push-notifications-setup/)
identifies `projectId` as the token's project attribution.

The A4 device was an **iPhone 17 Pro Simulator**. The EAS `development`
profile explicitly builds for the simulator, and the installed
`co.drapeon.app.dev` simulator binary's code-signing entitlements contain no
`aps-environment`. That binary cannot establish whether either retained Expo
token was issued for APNs sandbox or production. Expo's credential dashboard
for `co.drapeon.app.dev` shows an assigned push key and valid Ad-hoc signing
credentials; Development distribution is not configured. Those records do
not identify either retained token's APNs environment. No signed
physical-device Dev build was inspected in this check.
Apple's [APNs key guidance](https://developer.apple.com/help/account/capabilities/communicate-with-apns-using-authentication-tokens)
also says a signing key can work in both environments; `BadDeviceToken`
alone does not prove a key-environment mismatch. Compare a fresh token from
the correctly signed physical Dev app, its bundle/project provenance, and
the sending environment before assigning a cause. No token was resent.

The current-main Preview app was not installed on the iPhone 17 Pro and no
finished iOS Preview EAS build was available. Android Preview build
`89619259-5201-4df2-a1b0-4f467ab2a5b6` (source `889f8c02`) failed in
`:app:processReleaseGoogleServices` on 2026-11-11 because its
`google-services.json` has no client for `com.drape.app.preview`; no APK was
produced or installed on the Pixel. Register that package in the Dev Firebase
project, update the EAS Preview `GOOGLE_SERVICES_JSON` file variable, then
build again. Source inspection confirms the Preview config uses
`drape-preview` for the Stripe provider and PaymentSheet return URL; an actual
Preview-build card screen remains **NOT VERIFIED**.
No Production state was changed.

## A3 — Customer order and receipt visual recheck, 2026-11-13

On the iPhone 17 Pro Dev simulator, the signed-in QA customer opened order
`DRPE5KNO1` and in-app receipt `DRP-2026-00000034`. The receipt showed one
captured payment of **$135.31**: $125.00 work/materials and $10.31 Texas tax.
Its PaymentIntent was `pi_3Ub70YCrvCJ1ybBB1SZx5Q2J`. A read-only Dev check
confirmed the order is `CONFIRMED`, with exactly one successful
13,531-minor-unit payment row and exactly one `CAPTURE / INITIAL_ORDER`
journal balancing 13,531 debits to 13,531 credits. This verifies the customer
order detail and receipt on the iPhone 17 Pro.

A3 is **not PASS** overall: the customer push remains `DEAD / DeveloperError`
with an open Ops case, and the exact-order tailor push tap remains **NOT
VERIFIED**. No notification was resent and no payment, order, or ledger state
changed during this visual recheck.

## C1, E4 and TIP — read-only money follow-up, 2026-11-13

### C1 — first tailor tranche

The `SHIP_CUSTODY_70` tranche for `DRPZHHLGH` is `RELEASED`. Read-only Dev
checks found one $84.00 USD payout, one provider operation, and one balanced
release journal. The journal debits `TAILOR_ELIGIBLE` and credits
`TAILOR_RELEASED` for 8,400 minor units. The Stripe TEST transfer is
`tr_3UXQPICrvCJ1ybBB1iqSYoR6`, for $84.00 USD, and the Money Desk request
`MD-98496EAEC9` is `SUCCEEDED` with that transfer reference. Stripe shows the
transfer as available in the provider balance; the payout row remains
`PROCESSING`, so bank arrival is not claimed.

The Pixel earnings check recorded in PR #184 showed $84.00 in provider
balance and $36.00 pending release from the $120.00 order total. This is
consistent with the released tranche and the remaining plan. No explicit
replay was run in this follow-up, so replay idempotency is **NOT VERIFIED**.
Two C1 money-event push-failure Ops issues remain open, and the notification
tap is **NOT VERIFIED**. The earlier payout-failure case is resolved. The
remaining $24 and $12 tranches were still locked and not yet due at this
check; their prior expected eligibility dates are Nov 14 and Nov 25.

### E4 — failed provider refund and journal correction

The $155.00 Stripe TEST refund remains failed at the provider: its refund
record is `FAILED`, while the payment remains `SUCCEEDED` with zero refunded.
The provider record is the only refund record for that payment. Stripe's
Test-mode dashboard showed the single refund request failing; this read-only
verification made no new provider request.

The false $155.00 `REFUND` journal and its `REVERSAL` each balance to zero,
and the reversal exactly offsets the original journal lines. The associated
"Refund completed but ledger reconciliation failed" Ops issue is `RESOLVED`.
The separate "Stripe refund failed" and "Payment status transition needs
review" Ops issues remain `OPEN`; they were not closed by this check. No
direct SQL repair or blind webhook replay was performed.

### TIP — existing $5.00 Stripe TEST refund reconciliation

Money Desk request `MD-37FA97EF21` is `SUCCEEDED` for $5.00. Read-only Dev
checks found the existing Stripe TEST refund `re_3UUGXZCrvCJ1ybBB0mLEjCbg`
as `CONFIRMED`, the payment `REFUNDED` with 500 minor units refunded, exactly
one provider refund record, and one balanced 500-minor-unit TIP `REFUND`
journal. Stripe's Test-mode dashboard showed the existing refund's creation
and update events and one refund request. This follow-up created no second
provider refund and made no additional money change.

All checks above were read-only against Dev and Stripe TEST. No Production
state was read or changed.
