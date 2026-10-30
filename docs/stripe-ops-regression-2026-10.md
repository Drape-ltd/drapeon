# Stripe + Ops Full Regression — October 2026

Status: STOPPED — B3 money-state defect  
Scope: Supabase Dev `pqptfuqogvrajozfsqzi` and Stripe test mode only  
Branch: `codex/stripe-ops-regression`  
Base: `c654fea0068998e00b28581a0559ba2d3d4600a0` (`main`, fetched 2026-10-29)

## Safety preflight

| Check | Evidence | Result |
| --- | --- | --- |
| Git isolation | Clean task clone; unrelated `release/20261004-onboarding-experience` checkout left untouched | PASS |
| Supabase target | Exact host `pqptfuqogvrajozfsqzi.supabase.co`; database reports `DEVELOPMENT` | PASS |
| Stripe server key mode | Protected Dev readiness reports `STRIPE_SECRET_KEY` mode `test`; no value printed | PASS |
| Stripe publishable key mode | Local Dev configuration reports `pk_test_`; no value printed | PASS |
| Stripe webhook secret | Protected Dev readiness reports configured; two enabled test-mode endpoint records target the exact Dev webhook URL | PASS |
| Production boundary | No Production database, function, provider, deployment, merge, or OTA action performed | PASS |

The protected beta readiness endpoint returned overall HTTP 503 because of
non-Stripe readiness checks. Its Stripe key, key mode, and webhook-secret checks
all passed. This regression does not treat overall readiness as green until the
individual failing checks are classified.

## Setup state

| Setup case | Expected | Actual | Result |
| --- | --- | --- | --- |
| OPS-1 workforce principals | Two active, reviewed Dev-only named admins with fresh local MFA simulation | `founders@drapeon.co` (`3eef54ba-7b15-4b51-b74d-a181249d7fcb`) and `stripe.qa.ops.checker@drapeon.co` (`bc7284fc-d6f6-493f-a6be-6114242d6ecf`) are active Dev-only admins, review due 2026-11-28. Owner explicitly approved these exact grants. | PASS |
| OPS-1 Stripe route | Dev-only Stripe route provisioned through Ops and activated by two distinct principals | Route `92c4facd-6aa4-413b-8099-32a3e8cd2a3b`, request `fbb66838-78cb-4b0e-881e-ba1d8344c176`. Founder approval recorded; same-principal replay returned `duplicate=true` and left approval count at one; checker approval enabled the route. The canonical portal is missing the route controls, so the same audited RPC workflow was used directly. | PASS with defect OPS-001 |
| Delivery-country rule | Ready rule for each exercised checkout destination | US rule `88b9071b-aba1-411a-9dda-73ee773c47e3`, version 1, status `READY` | PASS |
| Stripe Connect tailor | Hosted test onboarding and verified US test bank `110000000 / 000123456789` | Existing hosted-onboarding fixture `acct_1UTarBEKQKBPdqpO` is linked to Dev tailor `35b872b8-fff8-4ef7-aa6f-e846df2e5483`; bank `ba_1UTatDEKQKBPdqpOZlOnd4Xn` has routing `110000000`, last4 `6789`, transfers active, payouts enabled. Destination `3690b7e3-c56c-4b37-a2e2-7023ae3c1e67` was refreshed by signed event `evt_1UW2gwEKQKBPdqpOTFzXvfYf`. | PASS |
| First-withdrawal safety gate | A real positive, matching-currency test bank withdrawal is required before destination activation | Test transfer `tr_1UW2hyCrvCJ1ybBBa8y0VBJD` funded the connected account; $1.00 test payout `po_1UW2iBEKQKBPdqpOSi0mdFDd` became `paid`. Signed payout events populated the provider ledger; the review then cleared and activated destination `3690b7e3-c56c-4b37-a2e2-7023ae3c1e67`. A paper-only review was rejected first. | PASS |
| Webhook forwarding | Exact Dev endpoint with test signing secret, or Stripe CLI listener, recorded | Two enabled Stripe test endpoints target `https://pqptfuqogvrajozfsqzi.supabase.co/functions/v1/stripe-webhook`: one for payment/refund/transfer events and one for Connect/payout events. Signed `account.updated` and payout events processed successfully. Equality/replay proof remains in B1/B2. | PASS for setup; B tests pending |

## Regression matrix

`NOT RUN` means no conclusion has been drawn. IDs and screenshots will be added
to the detailed case records when each case is exercised.

| Group | Cases | Status | Notes |
| --- | --- | --- | --- |
| A — Checkout & payment | A1–A7 | PASS after two isolated fixes | A1/A2/A3/A4/A5/A6/A7 exercised; see IDs below |
| B — Webhooks | B1–B4 | FAIL / STOP | B1, B2, B4 pass. B3 exposes fully refunded payment overwritten to `SUCCEEDED` by a late success event. |
| C — Payouts | C1–C7 | NOT RUN | Setup transfer/payout recorded separately from order cases |
| D — Refunds & disputes | D1–D7 | NOT RUN | D4 is a mandatory stop/report checkpoint |
| E — Ops portal | E1–E7 | PARTIAL | E2 same-principal duplicate check passed; canonical route controls missing |
| F — Money timelines | F1–F3 | NOT RUN | Customer/tailor browser and mobile screenshots required |
| G — Monitoring | G1 | NOT RUN | Baseline Sentry/alert classification pending |

## Defects

### PAY-003 — late `payment_intent.succeeded` overwrites a fully refunded payment

- Severity: money-loss / accounting-integrity stop condition
- Repro: with the payment webhook endpoint briefly disabled in Stripe TEST,
  create and fully refund PaymentIntent `pi_3UW3hkCrvCJ1ybBB1COMXpUa`, then
  re-enable the endpoint. Deliver real signed event
  `evt_3UW3hkCrvCJ1ybBB1lluA7vq` (`refund.created`) before real signed event
  `evt_3UW3hkCrvCJ1ybBB1hJ59Y47` (`payment_intent.succeeded`).
- Expected: the full refund remains terminal. A late success may reconcile the
  capture evidence but must not replace `REFUNDED` or advance the order as paid.
- Actual: after the refund event, payment
  `de3017c8-5b7c-42d4-92b4-6f7555971f1c` was `REFUNDED` with
  `refunded_amount=15500` and the order remained `PAYMENT_PENDING`. The later
  success event changed the payment to `SUCCEEDED`, returned processing result
  `confirmed`, and moved order `1cb51583-7a85-4b41-a4b7-a480ae940d05` to
  `CONFIRMED`; `refunded_amount=15500` and `partial_refund_count=1` remained.
- Provider truth: test refund `re_3UW3hkCrvCJ1ybBB1JO4jVIZ` succeeded for the
  full `$155.00 USD`; charge `ch_3UW3hkCrvCJ1ybBB1l7CSGok` is fully refunded.
- Impact: an out-of-order but valid signed Stripe event can make a fully
  refunded order appear paid/confirmed, allowing fulfillment or payout logic
  to act on the wrong terminal state.
- Fix status: not started. Regression execution stopped immediately as required.

### PAY-002 — retry after a failed PaymentIntent reused the terminal attempt key

- Severity: stuck-money
- Repro: fail an initial payment, then retry the same order. The stable prepare
  idempotency key reused the failed PaymentIntent instead of creating a clean
  attempt; a later success required Ops/manual recovery.
- Fix: terminal failed/canceled attempts now derive a deterministic
  `-R-<attempt-id>` prepare key, while concurrent/in-flight prepares preserve
  the original key.
- Tests: `_shared/payment-recovery_test.ts` failed before the helper existed and
  passes all five cases after the change; `deno check payment-action/index.ts`
  passes. Dev function only was deployed for regression verification.
- Verification: order `d7c67889-19da-4d6e-abfd-1868ee78bbf0` used failed PI
  `pi_3UW32ECrvCJ1ybBB1cOHOWQv`, then replacement PI
  `pi_3UW32ZCrvCJ1ybBB1DfvnAGw`; exactly one failed and one successful attempt.

### PAY-001 — ready-made route snapshot was unreadable to the service role

- Severity: stuck-checkout
- Repro: A2 closed and released inventory before charge because
  `snapshot_ready_made_payment_route` ran as invoker and the service role has no
  broad `payment_routes` table read grant.
- Fix: migration `20261029233955_fix_ready_made_route_snapshot_service_role.sql`
  makes the narrow snapshot function `SECURITY DEFINER`, pins an empty search
  path, and restricts execute to `service_role`.
- Tests: `ready_made_route_snapshot_service_role_security.sql` proved the
  pre-fix posture and the post-fix security contract. Migration applied only to
  Dev; A2 then completed successfully.

### CFG-001 — Dev ZipTax lookup unavailable

- Severity: stuck-checkout / external dependency configuration
- Repro: ready-made checkout returned HTTP 503 with `Tax could not be resolved
  from the configured provider.`
- Containment: an isolated, 24-hour Dev-only `tax_rate_cache` row for postal
  `78799`, rate zero, source `REGRESSION_FIXTURE`, allowed the remainder of the
  payment suite to execute. This is not asserted as real tax behavior.
- Fix status: not started.

### OPS-001 — canonical Ops portal cannot administer payment routes

- Severity: stuck-money / operational blocker
- Repro: in Development, request any `/ops` route in `apps/web`; middleware
  unconditionally redirects to the canonical `apps/ops` application. The
  payment-route and delivery-country forms/actions still exist only in
  `apps/web`; `apps/ops` contains no equivalent controls.
- Expected: a named, fresh-MFA administrator can create, sandbox, approve,
  enable, and kill-switch a route from the canonical Ops portal.
- Actual: no reachable UI exists for those controls. The audited database
  functions work and correctly enforce named principals, evidence, first-bank-
  withdrawal readiness, and two distinct approvals.
- Impact: normal route enablement and the one-step kill switch require a direct
  database operator, defeating the documented portal workflow and delaying a
  response when a route must be disabled.
- Fix status: not started. This is a migration/capability gap, not a cosmetic
  tweak; it will be isolated from money-path fixes.

## Detailed setup evidence

### OPS-1 — two-person Stripe route enablement

1. Confirmed the Stripe CLI default request mode is test and all relevant
   provider responses reported `livemode=false` where the object exposes it.
2. Created the US/USD Stripe route disabled, advanced it to `SANDBOX_ONLY`, and
   created/readied the US delivery rule through the audited Ops functions.
3. Emitted a signed `account.updated` event. Webhook inbox row
   `bafc105f-26c4-48e6-9f41-0093e9a3915d` was signature-valid, processed once,
   and produced the canonical payout destination.
4. Attempted to clear the destination with capability evidence alone; the
   database rejected it because a real paid bank withdrawal was absent.
5. Created a $2.00 test transfer and $1.00 test bank payout. The payout reached
   `paid`; provider payout event `evt_1UW2iCEKQKBPdqpORXue2DrI` is one of the
   signed terminal events recorded for the payout.
6. Cleared the destination, submitted the founder approval, replayed the same
   principal (idempotent, still one approval), then submitted the independent
   checker approval. The route became `ENABLED` only on approval two.

Expected: no enablement until an active destination, ready delivery rule, real
test withdrawal evidence, and two distinct named approvals exist.  
Actual: all database gates behaved as expected.  
Result: PASS, with OPS-001 for the missing canonical UI.

## Detailed case evidence

Each case record must include steps, order/payment/provider/Ops identifiers,
expected versus actual behavior, PASS/FAIL, cleanup, and screenshot paths for UI
cases. Secret values, passwords, card data, bank details beyond Stripe's public
test fixtures, and private evidence URLs must never be recorded here.

### A+B checkpoint

- A1 custom order: PASS. Order `ebdf1459-2bcd-4f59-9029-1f0cb24de1a0`,
  quote `d98d535d-c6cf-476d-8466-cc41dcfd6bbd` v1, PI
  `pi_3UW2xBCrvCJ1ybBB16pYR1hq`, charge
  `ch_3UW2xBCrvCJ1ybBB17rOiJu0`, `$250.00 USD`, signed success event
  `evt_3UW2xBCrvCJ1ybBB1Yh7UFuy`, one successful payment row, order confirmed.
- A2 ready-made: PASS after PAY-001. Order
  `18d0bd41-e6ba-4891-aea2-13cdbd669945`, PI
  `pi_3UW2vdCrvCJ1ybBB1tLqb7ov`, charge
  `ch_3UW2vdCrvCJ1ybBB19DY5vVq`, `$155.00 USD`, one successful payment row,
  order confirmed.
- A3 declines and retry: PASS after PAY-002. Generic decline and insufficient
  funds produced clear Stripe decline evidence and no duplicate per-attempt
  row. The verified retry order and replacement PIs are recorded under PAY-002.
- A4 3DS: PASS. Successful order `96d805d1-4a5d-4746-8fc5-a53579fefc69`,
  PI `pi_3UW33yCrvCJ1ybBB1fR22zqY`, charge
  `ch_3UW33yCrvCJ1ybBB1FHy0bTG`, challenge result `authenticated`, order
  confirmed. Failed order `e16f38b9-8fe7-4464-a3ec-d65e131980f8`, PI
  `pi_3UW35CCrvCJ1ybBB0mMBoCUF`, ended `PAYMENT_FAILED` with no charge.
  Abandoned order `c95fe5fa-9d6f-45a6-8374-55f758ba0c97`, PI
  `pi_3UW37SCrvCJ1ybBB0sFQNHnz`, was canceled by
  `expire-pending-payments`, ended `EXPIRED`, and had no charge.
- A5 double tap/two tabs: PASS. Two simultaneous prepare calls returned the
  same PI `pi_3UW366CrvCJ1ybBB0ePBtt0q`. Two simultaneous confirmations yielded
  one success/charge `ch_3UW366CrvCJ1ybBB0ezas2Iu` and one
  `payment_intent_unexpected_state`; order
  `95a5aed8-b047-4a95-b101-b530b4199bc1` has exactly one payment row.
- A6 disclosure: PASS for exercised zero-commission fixture. Order total was
  exactly `12500` item + `3000` delivery + `0` platform fee + `0` fixture tax =
  `15500 USD`; Stripe captured `15500`.
- A7 immutability: PASS. An authenticated attempted fee-schedule edit after
  acceptance was rejected with `Payment route configuration is immutable;
  create a new version`. Route and order snapshot remain version 1,
  `customer-disclosed-provider-costs-v1`, `$155.00 USD`.
- B1 duplicate: PASS. Replaying A1 event increased only `receive_count` to two;
  the original processing time and single payment row were preserved.
- B2 bad signature/stale timestamp: PASS. Fake event
  `evt_regression_bad_signature_20261029` returned HTTP 401, created no trusted
  webhook row, and changed no order/payment state.
- B3 out of order: **FAIL / STOP**. See PAY-003.
- B4 missed/delayed: PASS. For order
  `8501ca41-8722-4650-a958-be3f40a17ccb`, Stripe PI
  `pi_3UW38OCrvCJ1ybBB08EarVXN` was authoritative `succeeded` while the isolated
  Dev order was placed back at stale `PAYMENT_PENDING`. The normal recovery job
  returned `confirmed=1` and restored `CONFIRMED` without another charge.

No C–G case was started after PAY-003. No Production action occurred.

