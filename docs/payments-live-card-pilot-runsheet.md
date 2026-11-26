# Live card pilot run-sheet (Bachs · NG · NGN)

Saved 2026-11-24 to pick up later in the week. This is the working checklist for
the first real-card payment, built on top of
`docs/payments-phase4-controlled-live-proof-plan.md` (which remains the
authority on scope, allowlist contract and success evidence). Nothing here
authorizes a provider request; each live step still needs the founder's go.

**Proposed shape:** the founder's own customer account pays the founder's own
tailor profile (`a6419b26…`, Bachs-connected, GTBank) one small NGN amount
(suggested ₦5,000) for one custom order, followed end to end: collection →
order flow → handoff → first tranche release → transfer → withdrawal to the
bank, plus one refund drill.

## 1. Where we are (updated 2026-11-26)

| Item | State |
| --- | --- |
| Bachs live account, compliance task | Done |
| Production secrets: live API key, webhook secrets, platform account ID | Set |
| Connected-account webhook `drapeon-prod-connected` | Live, 7 events, signed deliveries 200 |
| Pilot tailor hosted KYC + payout destination | Done: capabilities ready, GTBank, 0 due/pending |
| Pilot tailor payout readiness (`payout_account_verified`) | True via #313 |
| Pilot tailor first-payout Ops review | **PENDING** (clears at release time, not before) |
| Pilot tailor trust video | Submitted; founder is deliberately not approving it yet |
| Production payment route `ng-ngn-ngn-bachs` | **DISABLED** (stays disabled for the pilot) |
| Live API key scopes | Onboarding only: no payments/checkout, transfers, refunds, balance |
| Account-level webhook (collection, checkout, transfer, refund, dispute) | **Not registered** |
| Production payment migrations S1–S4 (14 missing objects, #292 list) | **Applied and postflight verified**: S1 `7ff50dee`, S2 `f932fb88`, S3 `8d026268`, S4 `331daa93`; #343 default-ACL prerequisite `89e743ac` |
| Server-side proof allowlist (plan §"Controlled access design") | Draft [#351](https://github.com/Drape-ltd/drapeon/pull/351); Dev refusal checks passed, positive checkout and review owed |

## 2. Must be true before pilot day

1. **S1–S4 applied to Production — done.** S1 `7ff50dee`, S2 `f932fb88`,
   S3 `8d026268`, S4 `331daa93` (with #343 `89e743ac`). Each batch used
   guarded, exact-version transactions and passed its postflight. Re-run
   `release:gate` catalog guard (#315) immediately before the pilot and confirm
   the 14 payment objects still exist; that final preflight remains owed.
2. **Proof allowlist built, reviewed, merged, deployed** exactly per the plan
   contract: one proof ID, one customer, one tailor, one amount, one expiry,
   service-side only, normal gates still enforced, negative tests for a second
   order and an altered amount while the route stays `DISABLED`.
3. **Live API key for money movement**: a separate key with the minimum
   scopes for checkout/collection, transfers, refunds and balance read; founder
   copies it into Production secrets. Keep the onboarding key unchanged.
4. **Account-level webhook endpoint** on the platform account (separate from
   the connected-account endpoint): checkout completed/expired, collection
   succeeded/failed/underpaid, transfer, refund, dispute events → the same
   `bachs-webhook` URL. Signed test delivery recorded for each family.
5. **Approvers ready**: both named Production approvers can sign in to Ops with
   fresh MFA; requester is excluded from approving their own request.
6. **Customer card**: confirm the founder's card is accepted by Bachs NGN card
   checkout (a non-Nigerian card may be declined or carry FX). Have a backup
   Nigerian card holder if not.
7. **Edge provenance**: every Bachs-touching Production function redeployed
   from one merged `main` SHA, recorded on the proof issue.
8. **Ops case opened** with the amount, participants (by account reference
   only), expected timeline and incident owner.

## 3. Pilot day sequence (each step: act → verify → record in the Ops case)

1. **Preflight (read-only):** route still `DISABLED`; no other enabled route;
   proof allowlist active with the exact tuple; queues/webhook healthy; no
   stray Bachs orders.
2. **Customer brief:** founder's customer account sends a custom brief to the
   pilot tailor profile. Tailor quotes ₦5,000 (or the approved amount).
3. **Checkout:** customer accepts; sees the `Payment processing` disclosure;
   pays by card on the Bachs hosted page.
   Verify: signed collection event received (200), provider GET matches,
   order stage moves to paid, one capture ledger entry, customer + tailor
   notifications delivered and deep links open the order.
4. **Order flow:** tailor progresses the order; complete the real
   delivery/local-handoff evidence.
5. **First tranche release:** Ops clears the pilot tailor's first-payout review
   (two approvers), then the normal claim path releases the snapshotted first
   tranche. Verify: one claim, one provider operation, one transfer to the
   connected account, ledger agrees, tailor sees the earning.
6. **Withdrawal:** tailor withdraws to GTBank from their Bachs balance. Verify
   the account-level payout event reaches a terminal state and the ₦50
   withdrawal fee is shown separately.
7. **Refund drill:** only if an approved test condition is set up in advance;
   follow the reviewed Drapeon-funded path (transfers are not reversed).
8. **Close-out:** revoke/expire the proof allowlist; confirm the route is still
   `DISABLED` and no public order can reach Bachs checkout; queues, webhook,
   settlement monitor and Ops case healthy.

Any unknown, duplicated, unsigned, late or mismatched event fails the pilot.
Stop and open the Money Desk path; never retry with a new business key.

## 4. Surfaces to check at each step

Customer web + mobile order detail and receipt · tailor web + mobile order,
earnings and payout page · Ops order, Money Desk and payout review · database
rows (order, attempt, ledger, claim, operation) · Bachs dashboard (payment,
transfer, payout, webhook deliveries) · email/push outcomes.

## 5. Not in scope for this pilot

Route enablement, Stripe, Paystack, non-NGN currencies, bank-transfer
checkout, other tailors or customers, public discovery. Route enablement stays
a separate two-approver decision after a successful pilot.
