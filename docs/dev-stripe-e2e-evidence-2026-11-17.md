# Dev Stripe regression evidence — 2026-11-17

Scope: a Dev-only Stripe test-mode regression window. No Production payment route
was enabled and no live payment was created.

## Release baseline

- Source commit: `a40e244c497b3e8b6951457ab5a592a1af26e2db`.
- Production deployment: 14 approved Edge functions, source-matched after
  deployment (539 of 539 returned bundle files matched; zero missing or changed).
- The accepted indirect-bundle drift remains documented separately: ten functions
  were intentionally not redeployed because their existing Stripe calls already
  supply idempotency keys.

## Dev test window

- Stripe route: `92c4facd-6aa4-413b-8099-32a3e8cd2a3b`
  (`us-usd-usd-stripe`).
- It was changed from `DISABLED` to `SANDBOX_ONLY` only for the fixture, then
  returned to `DISABLED` at `2026-11-17T05:59:59.054518Z` with an audit reason.
- Stripe account and cards were test mode. No Bachs or Production route changed.

## Collection and refund evidence

| Scenario | Order | PaymentIntent | Webhook inbox | Result |
| --- | --- | --- | --- | --- |
| Custom order, promotion applied after acceptance | `1e627732-7b02-4498-825a-4fabef5f98d7` | `pi_3UcfKGCrvCJ1ybBB1ptz1hTr` | `abfad4d3-4201-4c35-8dc0-87d462f6a30f` / `evt_3UcfKGCrvCJ1ybBB16qeKLiK` | Captured USD 508.79; webhook `PROCESSED`; payment later fully refunded. |
| Ready-made order | `3ae876d9-cd18-4b5a-8685-fe0d479a7302` | `pi_3UcfKMCrvCJ1ybBB0O3ZfAfX` | `63312216-8dd9-4fe8-9f38-678facabdd19` / `evt_3UcfKMCrvCJ1ybBB0grnRVmh` | Captured USD 132.81; webhook `PROCESSED`. |

Promotion campaign: `467c69fe-8d3f-440c-8d75-cf10ee75d16b`.

The custom-order refund used the normal trusted `refund-order-payments` path:

- Payment: `ac4e4a3d-10e7-435b-8fdc-c6e03027f9bb`
- Refund: `re_3UcfKGCrvCJ1ybBB1qAFD7Hp`
- Stripe confirmed `succeeded`, amount USD 508.79.
- Dev `order_payments` status is `REFUNDED`, with `refunded_amount = 50879`.

## Customer mobile observation

On the Dev iOS simulator, the ready-made order detail loaded and its receipt
showed a captured USD 135.31 total, `Drapeon, operated by O4 GROUP LLC`, the
tailor-work, tax, and total lines, and the provider reference. The fixture had
zero customer processing fee, so no fee row was expected on that receipt.

The simulator also showed a `TypeError: Network request failed` toast while the
order/receipt itself successfully rendered. Simulator logs tie it to refused
loopback connections on ports `8096` and `19085`, not the Dev Supabase API or
the successful order/receipt requests. It appears to be a local development
runtime dependency (for example, a Metro/Expo companion service) rather than a
payment-path failure. This is not accepted as a clean mobile smoke test; restore
the local companion and re-run the visual pass before treating it as sign-off.

## Still deliberately unproven

- Production wrong-mode signed Stripe webhook test: requires a separately
  approved, safely configured test webhook secret/endpoint. Do not fabricate an
  event or change Production webhook configuration as part of this evidence.
- Full customer/tailor web and mobile visual regression, including the fee label
  when non-zero and the tailor view. The paid-order data remains available in Dev,
  but the Stripe route is intentionally off.

