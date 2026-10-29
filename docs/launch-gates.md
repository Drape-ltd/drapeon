# Payment launch gates (Phases 1–4)

This is a tracking document, not permission to enable a route. Phases 1–3 can be
released with every route `DISABLED`; Phase 4 owns live proof and enablement.

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
  issuer-specific restriction is needed).
- Bachs written fee-model confirmation for the platform-owned checkout plus
  separate-transfer flow. Bachs documents `customer_bears_fee: false` as the
  per-checkout instruction that the account creating that checkout absorbs the
  fee, independently of who collects it. However, `fees_collector` is described
  as an account-level setting for that account's charges: platform-paid fees
  apply to direct charges, while destination-charge fees come from the charge
  regardless. Our intended flow charges on Drapeon's platform account and later
  makes separate transfers, so the docs do not establish whether a connected
  tailor account's `fees_collector` has any effect on that platform checkout.
  Get Bachs to confirm the platform account's `fee_handling`, the effective
  `fees_collector` for recipient-only connected accounts, and who bears the fee
  when platform balance is insufficient. Bachs also documents that this fallback
  can silently move the fee back to the charge. The actual applied fee and
  `fee_paid_by` are only available after settlement, not as a guaranteed
  pre-checkout quote. The payment endpoint does not report settlement net, so
  implementation retains the signed collection event's `settlement_amount` and
  `processing_fee`; it finalizes the fee ledger only when that event fee matches
  the later payment read. Do not hard-code or promise a provider-fee amount
  before account-specific pricing and this flow's semantics are confirmed.
  Before enabling a route, prove that its accepted customer total/disclosure and
  settled-net reconciliation match the actual Bachs fee outcome. Sources:
  [Processing fees](https://docs.bachs.io/connect/processing-fees) and
  [Checkout sessions](https://docs.bachs.io/guides/checkout/checkout-sessions).
- Bachs written answer: connected-account withdrawal scheduling/control and
  first-withdrawal review timing. Do not promise a controllable hold or date
  without evidence.
- Bachs written answer: GHS/KES funding and FX corridors. Ghana and Kenya stay
  disabled; do not implement a bridge or those routes in Phase 3.
- The scoped write-capable Bachs sandbox credential and account-event webhook
  signing secret are configured in Dev. The separate connected-account event
  endpoint is disabled pending signing-secret rotation after its original
  secret appeared in local tool output. Rotate it, configure both Dev signing
  secrets, then enable the endpoint before connected-account proof.
- Dev created a sandbox recipient and hosted onboarding link through the Drapeon
  action. The recipient still has identity and payout-destination requirements;
  its Drapeon destination is inactive. A hosted-link receipt is not evidence of
  completed onboarding, collection, transfer, or withdrawal.
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
