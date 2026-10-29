# Payment launch gates (Phases 1–4)

This is a tracking document, not permission to enable a route. Phases 1–3 can be
released with every route `DISABLED`; Phase 4 owns live proof and enablement.

## Cloudflare Production release control (OPEN)

This is an operational release-control issue, separate from payment-route
readiness. The account owner cannot currently complete Cloudflare's Google
sign-in because Google disabled the associated Gmail account for 30 days. A
similar Outlook address is a separate mailbox and cannot receive messages sent
to the Gmail address. Cloudflare's password reset supports accounts created
with social login, but sends the reset to the original Cloudflare account
email; changing that email requires account access and a verified original
address. See [Cloudflare email and password recovery](https://developers.cloudflare.com/fundamentals/user-profiles/change-password-or-email/).

Cloudflare's API connection currently requires reauthentication. Its deployment
bot reported Production Worker deployments from draft PR #79, including commit
`6d1471f0` and the completed build for `76021d8c`. The owner approved cancel and
rollback, but the active Worker version and rollback target have not been
verified and no rollback has been performed. The last pre-PR deployment
`fd89ffc6` is only a candidate until matched to an active Worker version.

Before pushing more commits to PR #79 or treating its web code as a release:
restore Cloudflare account access, verify the active Production Worker version,
complete the approved rollback if needed, and inspect the Production branch and
build command. Cloudflare lists account issues as eligible for Free-plan
support cases; support may require proof of account ownership and will not
change account settings on the owner's behalf. See [Contacting Cloudflare Support](https://developers.cloudflare.com/support/contacting-cloudflare-support/).

The repository now has a local fail-closed guard in the standard web `prebuild`
and the dedicated `cf:build` path. A Workers Build may produce the production
bundle only when its injected branch is `main`; missing branch metadata also
fails. Cloudflare documents the injected `WORKERS_CI` / `WORKERS_CI_BRANCH`
variables and the build-then-deploy sequence in its [Workers Builds
configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
and [branch control guide](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/).
This reduces the chance that a non-main build reaches its following deploy
command, but does not replace Cloudflare's Production branch-control setting or
protect a custom build command that bypasses the repository scripts.
The change is not pushed while the dashboard settings and active Worker version
remain unverified.

## Bachs phase-readiness boundary

The current Bachs checkout path is intentionally limited to `INITIAL_ORDER` and
`FULFILLMENT`. Consultation checkout remains blocked; an unexpected signed
success is recorded as money and sent to Money Desk without confirming the
booking. Bachs `MATERIAL_ADVANCE`, fabric-shortfall, `TIP`, and `ADJUSTMENT`
charges are refused by their server actions until their matching refund and
release paths are complete. Do not treat the Bachs collection, transfer, or
withdrawal work as proof for those phases.

Before a route is enabled, its evidence must identify every payment phase that
the route can accept. A phase without a proven Bachs collection, refund, and
release path must remain unavailable at the server boundary and be clearly
unavailable in the customer/tailor flow; it must never fall through to Stripe,
Paystack, or another destination. Phase-specific availability is separate from
the core order route and does not enable a route by itself.

## External provider and legal evidence for Phase 4

- Bachs written answer: UK/US-issued cards on an NGN checkout, applicable fees,
  and whether the issuer-country gate can be enabled. Quote acceptance does not
  run the gate. At the actual hosted-card handoff,
  `BACHS_CARD_ISSUER_GATE_ENABLED=true` fails closed because Drapeon currently
  has no issuer-country signal; the unset/default value is false. Do not enable
  a live NGN route until Bachs confirms the corridor and the checkout path can
  reliably distinguish supported issuer countries (or Bachs confirms no
  issuer-specific restriction is needed). Public docs list `NGN_CARD` as an
  NGN corridor, but do not state which issuing countries are accepted. The
  published fee page lists 2% for Nigerian-issued NGN cards, 5% + $0.40 for
  US-issued global cards, and a 1.5% international-card surcharge on the global
  base rate; it does not say how that surcharge applies to an NGN-denominated
  card checkout. These public rates are not an account-specific quote for
  Drapeon's NGN route. Sources: [Payment method support](https://docs.bachs.io/guides/payments/payment-method-support)
  and [Fees](https://docs.bachs.io/for-you/fees).
- **Documented fee behavior; written confirmation still needed for the NGN
  foreign-card corridor and Drapeon's actual pricing.** Our checkout is created
  on Drapeon's platform account, without `X-Account-Id` or a destination field;
  a later separate transfer is funded only after the charge settles and draws
  on the platform's `available_balance`. `customer_bears_fee: false` makes the
  account creating that checkout absorb the processing fee, so the customer
  pays the accepted total and Drapeon receives the charge net of the fee.
  `fees_collector` is a separate, immutable connected-account setting for fees
  on that connected account's own charges; the docs say platform-paid fees
  through that setting apply to direct charges, not destination charges. It
  therefore does not select the fee collection path for our platform-owned
  separate-transfer checkout. Keep the route's required `fees_collector`
  snapshot at account creation, but do not describe it as changing this checkout's
  fee. The public [separate-transfer guide](https://docs.bachs.io/connect/split-payments/separate-transfers)
  says the platform settles the fee from the customer charge before transfers;
  the [processing-fee guide](https://docs.bachs.io/connect/processing-fees)
  says the actual fee and `fee_paid_by` are reported after settlement. The
  payment endpoint does not report settlement net, so implementation retains
  signed collection-event `settlement_amount` and `processing_fee`, finalizing
  fee evidence only when the event matches the later payment read. Do not hard-code
  or promise a provider fee before Drapeon's account-specific pricing and the
  applicable NGN foreign-card rate are confirmed. Before enabling a route, prove
  that the accepted customer total/disclosure and settled-net reconciliation
  match the actual fee outcome.
- Bachs' public [payout documentation](https://docs.bachs.io/connect/payouts)
  says recipient-only connected accounts are not held for Bachs' first-payout
  review. Drapeon's `first_withdrawal_review_status` is an internal Ops review
  before the first platform transfer into a tailor's connected balance; it does
  not delay the tailor's later bank withdrawal. Keep those two stages distinct
  in UI and support copy. Written, account-specific confirmation is still needed
  for withdrawal scheduling/control and any additional review applied to this
  account. Do not promise a controllable hold or date without evidence.
- Bachs written answer: GHS/KES funding and FX corridors. Ghana and Kenya stay
  disabled; do not implement a bridge or those routes in Phase 3.
- The existing Dev Bachs sandbox credential has write scopes for connected
  accounts, payments, refunds, and transfers, but payout access is read-only. A
  separate sandbox-only key with `payouts:write` was created and saved in the
  Dev project as `BACHS_SANDBOX_PAYOUTS_API_KEY`; the original key and all
  Production credentials were left unchanged. The new key is used only by the
  Dev-only payout-proof client. The account-event webhook signing secret is
  configured in Dev. The connected-account endpoint's signing secret was rotated
  and stored in Dev, then the endpoint was re-enabled in Bachs Sandbox on
  2026-10-29. The dashboard now shows it enabled, but it still has zero delivery
  attempts; signed connected-account receipt verification remains unproven.
- The Bachs Sandbox dashboard shows the QA recipient as Active, but its name
  and payout destination are still currently due. A temporary, token-gated Dev
  helper made only `GET /v1/accounts/{id}` and
  `GET /v1/accounts/{id}/capabilities` requests, then was restored to HTTP 410
  and its temporary token removed. The response confirmed exactly
  `persons.name` and `payout_destination` as currently due; `payouts`,
  `transfers`, and `conversions` are active in sandbox. This matches Bachs'
  public [requirements guide](https://docs.bachs.io/connect/requirements),
  [API onboarding guide](https://docs.bachs.io/connect/guides/api-onboarding),
  and [capabilities guide](https://docs.bachs.io/connect/capabilities), so the
  extra DOB/phone/address/ID fields on the hosted screen are not reflected in
  this account's API requirements. We have not submitted a name, payout
  destination, identity data, or legal agreement. The matching Drape Dev payout
  destination remains inactive and first-withdrawal review remains `PENDING`.
  For the still-open sandbox proof, use only an explicitly fictional QA name and
  the published synthetic bank-transfer destination; do not submit the hosted
  screen's DOB, phone, address, ID number, or document, and do not accept terms
  on behalf of a fictional person. Bachs documents the completed-withdrawal
  fixture as bank code `999`, account number `0001112223`; see
  [sandbox testing](https://docs.bachs.io/connect/testing). Sandbox capability
  activation does not prove live onboarding/KYC readiness. Complete real-person
  onboarding only with the account holder's valid, authorized information and
  consent; do not claim end-to-end withdrawal proof before the app's persisted
  destination and withdrawal states are verified.
- A Dev-only API onboarding attempt on 2026-10-29 used only the fictional QA
  name and Bachs' published withdrawal-success fixture. The corrected request
  reached Bachs with the documented `fields` envelope, but Bachs returned HTTP
  400 and did not move either requirement. This is expected to remain an
  external proof gate: the `999` / `0001112223` fixture documents a simulated
  withdrawal outcome, while API onboarding requires a bank destination that
  resolves through Bachs' bank-account resolver. Do not substitute invented or
  real personal bank data. Complete the recipient with an authorized sandbox
  onboarding fixture from Bachs, then capture the signed account event and run
  the withdrawal proof in Phase 4. The temporary helper is restored to HTTP 410.
- Bachs' [Connect sandbox guide](https://docs.bachs.io/connect/testing) says a
  successful sandbox charge moves directly to `available_balance`, so it can
  prove the claim-backed transfer without waiting for live settlement. Sandbox
  withdrawals resolve asynchronously to a simulated result. The documented
  `bank_transfer` success fixture uses bank code `999` and account number
  `0001112223`; the failure fixture uses bank code `998` and account number
  `0001112224`. This proves event handling and account-level tracking, not live
  settlement delays or real bank clearing. Creating a withdrawal uses the
  [Payouts API](https://docs.bachs.io/connect/payouts).
- Signed sandbox `dispute.created` / `dispute.updated` receipts must be replayed
  and reconciled before route enablement. The subscription alone is not proof.
- Legal/tax signoff for any delivery-country rules that require it, including UK
  low-value VAT. The country gate stays disabled until its evidence is recorded.
- Live Bachs collection → settlement → transfer → tailor withdrawal proof, fee
  reconciliation, signed webhook receipt, and refund/dispute operational
  evidence for each route before enablement.

## Deferred integrated QA

- Authenticated web and mobile visual checks, including payout onboarding, money
  timelines, receipts, checkout return, and the existing Phase 1 carryover.
  These remain deferred at the user's request until after the implementation
  phases; they are not claimed as passed.
- Signed bank-payout failure/return receipt, fabric charge-to-release proof, and
  QA notification-suppression check remain part of the integrated proof set.

Every `ENABLED` transition is a separate Phase 4 release decision with two
distinct approvers, evidence IDs, and an audited rollback switch. This document
does not convert an external unanswered question into a Phase 3 implementation
blocker.

## Route enablement workforce gate (OPEN)

**Route enablement needs 2 distinct Ops principals with fresh MFA.** Before the
first enablement request:

1. Invite a second human through the Production Cloudflare Access/identity
   provider; do not share the founder login or an authenticator seed.
2. Provision that exact, named email as an active Production
   `ops_workforce_principals` record with the minimum route-approval role and a
   current access-review date. Cloudflare authentication alone grants no Ops
   authority.
3. Have each person enroll their own authenticator-backed MFA. Email OTP and a
   local device biometric are not accepted as workforce MFA.
4. Verify each principal independently reaches the dedicated sensitive Access
   application and receives a fresh-MFA assertion no older than 15 minutes.
5. Exercise a deny-only rehearsal: self-approval is rejected, a stale/normal
   audience is rejected, and the two distinct fresh-MFA principals can submit
   separate approvals for the same disabled route without enabling it.
6. Record both immutable principal IDs, assertion times, evidence IDs and the
   route-enable request ID. Only then request the separate Production enablement
   approval.

No second principal was created during Stage 0.
