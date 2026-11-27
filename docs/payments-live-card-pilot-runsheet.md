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

## 1. Where we are (updated 2026-11-27)

| Item | State |
| --- | --- |
| Bachs live account, compliance task | Done |
| Production secrets: live API key, webhook secrets, platform account ID | Set |
| Connected-account webhook `drapeon-prod-connected` | Enabled; seven event subscriptions read back 2026-11-27. **Connected signing proven 2026-11-27** by a real `account.updated` retry at 16:46:40 UTC after the secret change. |
| Pilot tailor hosted KYC + payout destination | Done: capabilities ready, GTBank, 0 due/pending |
| Pilot tailor payout readiness (`payout_account_verified`) | True via #313 |
| Pilot tailor first-payout Ops review | **PENDING** (clears at release time, not before) |
| Pilot tailor trust video | Submitted; founder is deliberately not approving it yet |
| Production payment route `ng-ngn-ngn-bachs` | **DISABLED** (stays disabled for the pilot) |
| Live API key scopes | Scoped replacement set as `BACHS_LIVE_API_KEY`; balance, connected-account list and pilot-account retrieve returned HTTP 200. Old onboarding-only key revoked. |
| Platform account webhook | `whe_KVIObWSdk82bmKMs` enabled; eight event subscriptions read back 2026-11-27. First signed collection proof remains a pilot-day gate. |
| Production payment migrations S1–S4 (14 missing objects, #292 list) | **Applied and postflight verified**: S1 `7ff50dee`, S2 `f932fb88`, S3 `8d026268`, S4 `331daa93`; #343 default-ACL prerequisite `89e743ac` |
| Server-side proof allowlist (plan §"Controlled access design") | **Released** in merge `6ca5070c`: four guarded Production migrations and `phase4-proof-payment` v1 / `bachs-webhook` v13. `PHASE4_PROOF_ACTION_ENABLED` unset; 0 proofs and 0 enabled routes. Do not arm a proof yet. The release/transfer leg remains a pilot-day precondition. |

## 2. Must be true before pilot day

1. **S1–S4 applied to Production — done.** S1 `7ff50dee`, S2 `f932fb88`,
   S3 `8d026268`, S4 `331daa93` (with #343 `89e743ac`). Each batch used
   guarded, exact-version transactions and passed its postflight. Re-run
   `release:gate` catalog guard (#315) immediately before the pilot and confirm
   the 14 payment objects still exist; that final preflight remains owed.
2. **Proof allowlist released; proof still unarmed.** Merge `6ca5070c`
   deployed the service action and signed webhook changes. Recheck the action
   flag is unset, no proof exists, and the route is `DISABLED` before the
   founder approves one exact tuple and proof window. The tranche-transfer leg
   is still a pilot-day precondition tracked with #318.
3. **Live key and webhook checklist below**: the scoped runtime key and both
   signed endpoints are configured; prove the connected secret with a harmless
   account update and the platform secret with the first pilot collection.
4. **Approvers ready**: both named Production approvers can sign in to Ops with
   fresh MFA; requester is excluded from approving their own request.
5. **Customer card**: confirm the founder's card is accepted by Bachs NGN card
   checkout (a non-Nigerian card may be declined or carry FX). Have a backup
   Nigerian card holder if not.
6. **Edge provenance**: every Bachs-touching Production function redeployed
   from one merged `main` SHA, recorded on the proof issue.
7. **Ops case opened** with the amount, participants (by account reference
   only), expected timeline and incident owner.

### Exact Bachs live key and webhook checklist — preparation only

- [ ] **Runtime key scopes.** Use separate Production-only keys where the
  deployed functions support them. The proof checkout and reconciliation need
  `payments:write` (includes read); connected-account onboarding and refresh
  need `connected_accounts:write` (includes read); tranche release and recovery
  need `transfers:write` (includes read); account balance checks need
  `balance:read`; refunds need `refunds:write` (includes read); withdrawals
  need `payouts:write` (includes read); dispute inspection needs
  `disputes:read` (`disputes:write` only if this key submits evidence); and
  the handler's provider-event lookup needs `webhooks:read`. Do not grant
  `webhooks:write` to the runtime key solely to receive deliveries. If the
  endpoint is provisioned by API rather than dashboard, use a separate
  short-lived key with `webhooks:write`, then revoke it. Compare these scopes
  with every deployed API call before key creation. [Bachs permissions](https://docs.bachs.io/api-reference/permissions).
- [ ] **Platform account endpoint (`event_source=account`).** Register the
  Production account-level HTTPS `bachs-webhook` destination for
  `collection.succeeded`, `collection.failed`, `collection.underpaid`,
  `refund.created`, `refund.paid`, `refund.failed`, `dispute.created`, and
  `dispute.updated`. The current handler deliberately sends
  `collection.underpaid` to Ops review. Do not subscribe this endpoint to
  `checkout.completed`, `checkout.expired`, or `transfer.created`: the current
  handler would classify those as unimplemented and open Ops issues.
- [ ] **Connected-account endpoint (`event_source=connect`).** Keep the
  existing endpoint for `account.updated`, `capability.updated`,
  `payout_destination.approved`, and `payout_destination.rejected`; add
  `payout.created`, `payout.paid`, and `payout.failed` to observe the pilot
  tailor's connected-account withdrawal. Do not subscribe to
  `account.tasks_requested` until the handler supports it. Bachs routes an
  event from a connected account to its parent's `connect` endpoint, while an
  `account` endpoint receives only the platform's own events. Confirm the
  endpoint's `event_source` and exact event selection before enabling
  delivery. [Bachs Connect event routing](https://docs.bachs.io/guides/webhooks/overview#connect-events),
  [Bachs payout events](https://docs.bachs.io/connect/payouts#pay-out-as-an-account).

**Endpoint readback, 2026-11-27 (IDs and event names only):**

| Endpoint | Event source | Subscriptions |
| --- | --- | --- |
| `whe_KVIObWSdk82bmKMs` | `account` | `collection.succeeded`, `collection.failed`, `collection.underpaid`, `refund.created`, `refund.paid`, `refund.failed`, `dispute.created`, `dispute.updated` |
| `whe_S5nCwgjcBHewyq3H` | `connect` | `account.updated`, `capability.updated`, `payout_destination.approved`, `payout_destination.rejected`, `payout.created`, `payout.paid`, `payout.failed` |

Bachs permits synthetic `bachs trigger` only in sandbox. The live dashboard
does not provide a synthetic delivery control, so the first real pilot
collection is the platform endpoint's signed-delivery proof. Do not infer
that signing works merely because the endpoint and secret were configured.

**Connected signing evidence, 2026-11-27:** Provisioning validated two
distinct entries in `BACHS_LIVE_WEBHOOK_SECRETS` before the secret write;
Supabase does not expose their values for runtime readback. A temporary
connected-account display-name edit was saved and restored, but did not emit
a new `account.updated` by the time of this check. As a safe fallback, Bachs
retried the real event `evt_fb60b523566224a99f1ea874d94510d3` to the
connected endpoint. The existing inbox row
`fccb1aca-be53-4f7b-b3f2-5578409a500e` remained signature-valid, its
`receive_count` rose to 2, and `last_received_at` became 16:46:40 UTC, after
the secret replacement. There was no new invalid-signature rejection. This
proves the connected signing path because the handler verifies the signature
before deduplicating the replay. The display-name edit did not emit a fresh
event, and no further account edit is needed. [Bachs signature rules](https://docs.bachs.io/guides/webhooks/overview),
[sandbox-only triggers](https://docs.bachs.io/developer-portal/local-testing).
- [ ] **Post-setup guard.** Read back key scopes and both endpoint event lists,
  verify the connected `account.updated` proof, then recheck zero enabled
  routes, zero proofs, and the proof action flag still unset. The platform
  endpoint's first signed collection is the pilot-day check above. Checkout
  and transfer progress use their existing API response, provider-ID
  reconciliation, and Ops checks until dedicated webhook handlers are reviewed
  and deployed. No real payment starts from setup alone.

### Dev kill-switch rehearsal — 2026-11-26

The service-only `ops_disable_payment_route` RPC moved the Dev Bachs sandbox
route `d70aeeca-6e54-4f2d-a4c4-a82893c686a5` from `SANDBOX_ONLY` to
`DISABLED`. The synthetic Dev QA Ops actor was used through the service RPC;
there was no human Access session or approval. Route audit
`3ee8a9ee-e55e-4e98-9082-b7ab5530e3ce` and Ops audit
`809bc71b-a3d6-4796-92b4-bcad184f74ab` record that distinction. The
latest Dev NGN/Bachs route version is also `DISABLED`; the shared resolver's
disabled-route refusal contract passed (38/38 currency-config tests).

A fresh synthetic Dev quote/order `f4280000-0000-4000-8000-000000000001`
opened proof `164ea2eb-848d-4f9f-9258-00ff5262d6eb`, which the service
kill RPC immediately moved to `KILLED`; audit event
`f179f07a-b8fe-450b-8f59-b996a7b45f60` was recorded. A new checkout
authorization returned `PHASE4_PROOF_CHECKOUT_REFUSED`. No Bachs provider
request or payment was made. Dev postflight: all three routes present, both
Bachs versions `DISABLED`, **zero enabled routes**. This verifies the service
RPC path and database refusal; an Access-authenticated human Ops click remains
to be rehearsed before any live route enablement.

## 3. Pilot day sequence (each step: act → verify → record in the Ops case)

1. **Preflight (read-only):** route still `DISABLED`; no other enabled route;
   proof allowlist active with the exact tuple; queues/webhook healthy; no
   stray Bachs orders.
2. **Customer brief:** founder's customer account sends a custom brief to the
   pilot tailor profile. Tailor quotes ₦5,000 (or the approved amount).
3. **Checkout:** customer accepts; sees the `Payment processing` disclosure;
   pays by card on the Bachs hosted page.
   **Within 10 minutes of payment, `collection.succeeded` must appear in
   `payment_webhook_events` with `signature_valid=true`.** If it does not:
   kill the proof, confirm payment by provider GET, hold the order for Ops,
   correct the platform signing secret, and do not open another checkout.
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

**Kill or expiry after checkout opens:** closing the allowlist immediately
refuses any new proof authorization, but does not cancel the already-open Bachs
hosted checkout. Keep its order and payment attempt under Ops review until
Bachs confirms expiry or the ordinary payment-expiry reconciliation closes it.
If a signed collection was paid after the proof deadline, record the payment
and one capture ledger entry, then hold order confirmation and payout release
for Ops refund review. Judge this by the signed event's paid/created timestamp,
never the webhook processing time; a missing timestamp also requires review.
KILL requires immediate review regardless of the reported payment time. If
checkout creation succeeded but its provider-ID upsert failed, hold the signed
event in Ops review without claiming that capture was ledger-recorded. Do not
drop the money event or assume that a
`checkout.expired` event rules out a later collection. This is a failed pilot
that needs reconciliation, not permission to open a second checkout.

Any unknown, duplicated, unsigned, late or mismatched event fails the pilot.
Stop and open the Money Desk path; never retry with a new business key. A valid
signed late collection is still booked and held for Ops refund review as above.

## 4. Surfaces to check at each step

Customer web + mobile order detail and receipt · tailor web + mobile order,
earnings and payout page · Ops order, Money Desk and payout review · database
rows (order, attempt, ledger, claim, operation) · Bachs dashboard (payment,
transfer, payout, webhook deliveries) · email/push outcomes.

## 5. Not in scope for this pilot

Route enablement, Stripe, Paystack, non-NGN currencies, bank-transfer
checkout, other tailors or customers, public discovery. Route enablement stays
a separate two-approver decision after a successful pilot.
