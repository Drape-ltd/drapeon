# Payment launch gates (Phases 1–4)

This is a tracking document, not permission to enable a route. Phases 1–3 can be
released with every route `DISABLED`; Phase 4 owns live proof and enablement.

## External provider and legal evidence for Phase 4

- Bachs written answer: UK/US-issued cards on an NGN checkout, applicable fees,
  and whether the issuer-country gate can be enabled. Until then, its issuer
  gate defaults **OFF** and no live corridor is enabled.
- Bachs written answer: connected-account withdrawal scheduling/control and
  first-withdrawal review timing. Do not promise a controllable hold or date
  without evidence.
- Bachs written answer: GHS/KES funding and FX corridors. Ghana and Kenya stay
  disabled; do not implement a bridge or those routes in Phase 3.
- Bachs sandbox proof credentials: a write-capable sandbox credential and
  configured webhook signing secret are needed for signed refund/transfer event
  replay. Current Dev credential is read-only; do not claim provider-write or
  signed-webhook proof without those credentials.
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
