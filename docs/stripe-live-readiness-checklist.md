# Stripe live readiness checklist

This is evidence collection for a future live proof. It does not authorize a
live charge, transfer, payout, or route enablement.

## Webhooks and signatures

- [ ] **Live endpoint inventory:** screenshot or export the Stripe Dashboard's
  live webhook endpoint list, showing each endpoint URL and subscribed events.
  Include both the platform endpoint and any Connect endpoint if one exists.
- [ ] **Endpoint-secret source:** for each live endpoint, record the endpoint
  ID (`we_...`) and confirm its signing secret is stored only as the Production
  `STRIPE_WEBHOOK_SECRET` or rotation-overlap `STRIPE_WEBHOOK_SECRETS` secret.
  Do not copy a secret into this document or a screenshot.
- [ ] **Environment isolation:** capture a live-event delivery from the live
  Dashboard and a test-event delivery from the test Dashboard, showing their
  distinct endpoint modes. The application also rejects a signed event whose
  `livemode` does not match its Supabase environment.
- [ ] **Rotation rehearsal:** record the date, endpoint ID, and outcome of one
  dual-secret webhook rotation rehearsal: add the new secret, deliver a signed
  event, remove the old secret after the overlap, and confirm both delivery and
  deduplication.

## Keys, checkout, and PCI boundary

- [ ] **Restricted live key:** screenshot the live restricted key's permission
  summary (never the key value). It must grant only the payment, refund,
  transfer, Connect-account, and read permissions Drapeon actually uses.
- [ ] **Client key separation:** capture the Production web/mobile build
  configuration showing only the live publishable key is client-visible; test
  keys must appear only in Dev/sandbox configuration.
- [ ] **Radar and SCA:** screenshot live Radar rules and the payment settings
  that require 3DS/SCA where applicable for UK/EU cards.
- [ ] **PCI assertion:** retain the Stripe Checkout/Elements integration view
  and code-search evidence that Drapeon stores no PAN or CVC in the database,
  logs, or Sentry.

## Connect and payouts

- [ ] **Capability proof:** for the intended live connected account, capture
  the account ID, `transfers` capability, `payouts_enabled`, and any current or
  past-due requirements. Do not capture identity documents.
- [ ] **Payout schedule / withdrawal evidence:** capture the account-level
  payout schedule and the party that pays any withdrawal fee. Per-order
  withdrawals must not be inferred from an account-level payout.

## One approved live proof

- [ ] **Approval record:** document the founder-approved amount, payer,
  recipient, route, rollback/refund plan, and who may act before starting.
- [ ] **Collection:** record only the Stripe IDs for the small live PaymentIntent
  and Charge, its signed webhook event ID, the Drapeon payment-attempt ID, and
  the ledger transaction ID.
- [ ] **Transfer:** record the payout-claim ID, payout-attempt ID, Stripe
  transfer ID, and provider-confirmed terminal status.
- [ ] **Account payout:** record the account-level Stripe payout ID and terminal
  status. Do not attribute that withdrawal to a single earning unless Stripe
  provides that link.
- [ ] **Refund/recovery:** if the proof is cancelled or fails, record the
  reviewed refund/reversal ID and final outcome. Transfers and payouts are not
  assumed reversible.

## Monitoring sign-off

- [ ] **Webhook health:** capture current Production queue depth, payment-webhook
  dead-letter count, and the alert route for repeated invalid signatures.
- [ ] **Synthetic check:** record a non-money live webhook-health synthetic and
  its alert owner. A synthetic must never manufacture a payment event.
- [ ] **Evidence owner:** name the Operations owner and retention location for
  the IDs and screenshots above.
