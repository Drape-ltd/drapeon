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

The current-main Preview app was not installed on the iPhone 17 Pro and no
finished iOS Preview EAS build was available. Source inspection confirms the
Preview config uses `drape-preview` for the Stripe provider and PaymentSheet
return URL; an actual Preview-build card screen remains **NOT VERIFIED**.
No Production state was changed.
