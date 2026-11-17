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

The iOS simulator receipt initially inspected was **not** the new fixture. It
was an older ready-made order (`DRPCOKT4G`, receipt `DRP-2026-00000031`) whose
USD 135.31 receipt exactly matches its own USD 135.31 successful payment. It
must not be used as evidence for the USD 132.81 fixture.

The new ready-made fixture is internally consistent: its locked order total,
`order_payments.amount`, Stripe PaymentIntent `amount`/`amount_received`, and
commercial receipt `total_amount` are all USD 132.81. Its receipt is
`DRP-2026-00000036`. The USD 2.50 apparent difference was therefore a
test-evidence attribution error, not a money discrepancy.

Amount trace for the actual fixture: order `3ae876d9-cd18-4b5a-8685-fe0d479a7302`,
payment `f94e9260-6f4e-492e-84fa-9ef7ba1fab13`, PaymentIntent
`pi_3UcfKMCrvCJ1ybBB0O3ZfAfX`, capture `ch_3UcfKMCrvCJ1ybBB0PDILVDZ`, and
receipt `DRP-2026-00000036` each record `13281` minor USD units. The apparent
USD 135.31 value instead belongs to older order
`5d6b84a4-1c49-42a7-ba53-0b4a10f48633`, payment
`b549c1fd-3fee-41c2-be7e-73797c1b456e`, PaymentIntent
`pi_3UajqrCrvCJ1ybBB1XtiYXw4`, and receipt `DRP-2026-00000031`, each at
`13531` minor USD units.

The older inspected mobile receipt showed `Drapeon, operated by O4 GROUP LLC`,
the item, tax, and total lines, and the provider reference. The new fixture has
zero customer processing fee, so no fee row is expected for it.

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
- The Dev runtime wrong-mode webhook proof remains pending the existing Dev
  endpoint signing secret through a secure handoff. Static coverage is green:
  `deno test supabase/functions/_shared/stripe-webhook-livemode_test.ts`
  (`3 passed, 0 failed`). A mismatch is intentionally rejected before it is
  queued, so its runtime evidence is an audit/rejection record rather than a
  payment-webhook inbox row; it cannot reach payment processing.

## Visual-pass environment result

- The local customer web server at `127.0.0.1:3018` loads its public shell, but
  no authenticated Dev customer or tailor session is present. It therefore does
  not establish the two fixture receipts or tailor order views.
- The iOS Simulator currently has no visible Drapeon app instance to reopen.
  The prior rendered receipt remains attributable only to the older order noted
  above. The local loopback failures on ports `8096` and `19085` cannot be
  mapped to a source-defined companion service, so no unknown daemon was
  started.
- The Android baseline runner was attempted twice without clearing logs or
  creating data. Its first run was blocked by sandboxed ADB startup; the
  permitted host run confirmed that no expected Pixel customer or A17 tailor
  device is attached. No Android UI evidence was generated.
- Result: customer/tailor web, iOS, Android, and Ops visual checks remain
  **unproven**, not failed. The Dev route is still `DISABLED`; the two paid
  fixture orders remain available for a later authenticated visual pass.

