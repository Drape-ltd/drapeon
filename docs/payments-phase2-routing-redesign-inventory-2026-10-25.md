# Phase 2 routing redesign: current-main inventory

Baseline inspected: `origin/main` at `0ae6c1f7160e74af9621d07b29e0bf39dba39cd5` (Phase 1 PR #65 merge, 2026-10-25). This is an inventory and disposition, not a migration or production approval.

## Existing pieces and disposition

| Existing piece | Current behavior / evidence | Disposition |
| --- | --- | --- |
| Shared currency/provider resolver and payout-gating's private duplicate | `packages/shared/src/currency-config.ts:104-116` maps NGN/GHS/KES to Paystack and USD/GBP/EUR/CAD to Stripe. `resolveSellerPayoutCurrency` and `resolveSellerOrderCurrency` at `:118-169` infer currency from profile/provider/item/customer fallbacks; there is no route-readiness or delivery-country gate. `packages/shared/src/payout-gating.ts:19-28` contains a second private copy of the same currency-to-provider switch. A source search found 20 non-test files containing a resolver call (including the private duplicate's file). | **EVOLVE one canonical shared resolver** to consume versioned route and delivery-country configuration; **remove/redirect the private duplicate** and migrate all 20 files below. Keep currency parsing/formatting helpers. All new order acceptance and pre-acceptance availability use the same canonical result; UI availability may render it but must not independently choose a provider. |
| SQL currency/provider resolver | `supabase/migrations/20260429000001_payment_currency_foundation.sql:53-68` defines `public.resolve_payment_provider_for_currency`, duplicating the shared resolver's currency map. Current source search found no non-migration runtime caller (only an audit-doc assertion and the rollback reference). | **RETIRE/REDIRECT** after dependency search. No second resolver may remain in runtime. Historical migration text remains immutable; the installed function can be removed by a later additive migration after confirming no database-side dependency. |
| Payment-currency foundation | `supabase/migrations/20260429000001_payment_currency_foundation.sql` adds durable account currency and a currency-based provider function; `supabase/MIGRATION_STATUS.md:122` labels it production-applied. | **EXTEND** the existing currency foundation with route and delivery-country configuration. Do not add another currency table or parallel provider map. |
| Order payout snapshot | `supabase/migrations/20260430000002_order_payout_snapshots.sql:1-14` adds locked payout currency/provider, Paystack recipient and Stripe account columns plus Ops override fields; `:39-62` backfills them from the current profile. Runtime readers include `release-order-payouts` and web/mobile money history. | **EXTEND the same `orders` snapshot row** with route ID/version, legal entity, charge provider/currency, provider-neutral destination ID, fee schedule version, delivery-country rule version, tax/duty snapshot, staged commercial-policy version, accepted earning, and tailor-terms version. Do not add a second order-snapshot table. Keep provider-specific locked fields only as historical compatibility readers until old orders are closed; new charges/refunds/payouts must consume the canonical order snapshot. |
| Payout setup and destination creation | `supabase/functions/payout-account-action/index.ts:31-80` exposes Paystack bank-list/verify/confirm and Stripe Connect start/refresh actions; it also writes provider-specific profile fields. | **EXTEND** the existing flow to write/read provider-neutral destination records and capability status. **RETIRE** Paystack recipient creation and bank-verification actions for new setup; Nigerian tailors see “Payout setup is coming soon” until Bachs onboarding is available. Keep Stripe setup only for countries proven by live account capability checks. |
| Provider-status UI and withdrawal records | Web: `apps/web/features/account/payout/payout-workspace.tsx:566-567,650,707`; mobile: `apps/mobile/app/(tailor)/profile/payout-setup.tsx:1104`; earnings currently expose provider-specific labels in `apps/mobile/app/(tailor)/earnings.tsx:79,320`. Existing schema distinguishes `payouts.provider_transfer_status` from `bank_settlement_status` and already has account-level `provider_payout_events` (`supabase/migrations/20260818100000_provider_settlement_lifecycle.sql:1-110`); Stripe webhook/monitor and account earnings read those events. | **EXTEND** these same surfaces and event records; do not create another withdrawal ledger. **REDIRECT** shared status/copy through the single transfer/withdrawal model. **RETIRE for new Stripe/Bachs earnings** any order-level bank-withdrawal association: a transfer ends at “In your provider balance”; bank withdrawals stay account-level (`provider_payout_events`, with no fabricated earning link). Keep direct-to-bank/Paystack fields only for historical readers during wind-down. |
| Ops payout destination and order routing reads | Ops currently reads locked provider and profile-specific destination columns, e.g. `apps/web/app/ops/action/route.ts:2199-2213`; payout readers also contain provider literals. | **EXTEND** the existing Money Desk/readiness surfaces with route and delivery-country readiness, actor/reason history, two-person enablement evidence, and one canonical order snapshot. **REDIRECT** new-order reads to that snapshot; retain legacy fields only for historical orders. |

## Canonical target / retirement boundary

1. Exactly one runtime route resolver decides a route from customer charge corridor, tailor destination country/currency, route state/capabilities, and delivery-country readiness. The existing shared currency resolver is the starting point; the duplicate SQL currency map is retired/redirected after all callers are migrated. A UI availability helper only renders the resolver's result and is not a second provider resolver.
2. Exactly one order snapshot remains: the existing `orders` row, extended in place. Acceptance writes the route, entity, destination, fee/tax/duty and terms snapshots atomically with the exposure-measurement hook. Subsequent payment/refund/payout phases read that snapshot, never fresh profile or route lookups.
3. Add versioned per-route configuration and a separate delivery-country readiness table. Keep every Bachs route disabled. Enabling requires two distinct approvers and evidence IDs for collection, settlement, transfer and tailor withdrawal.
4. Provider-neutral `payout_destinations` becomes canonical for new orders. Existing `tailor_profiles.paystack_recipient_code` / `stripe_connect_account_id` and the order's old provider-specific locked columns are compatibility-only for existing/test readers; enumerate and remove/redirect each new-order writer before calling Paystack retired.
5. Reuse `provider_payout_events` for account-level bank withdrawals. New Stripe/Bachs claims must not turn an account withdrawal into an order/earning status; any legacy `payouts.bank_settlement_status` reader for those providers is compatibility-only and should resolve to `NOT_APPLICABLE` for the individual transfer. Paystack's historical direct-to-bank outcome may retain its own reader until wind-down ends.

## Locked Phase 2 behavior to implement in the existing system

- **Legal entity and receipt snapshot:** Nigeria NGN/Bachs orders use Drape
  Marketplace Limited (CAC); supported international Stripe orders use O4 GROUP
  LLC (Wyoming). The customer-facing descriptor is `DRAPEON` on both providers.
  Receipts say “Drapeon, operated by <legal entity>”, sourced from the accepted
  order snapshot. Legal entity is not inferred again after acceptance.
- **Route disposition:** Nigeria NGN-tailor → NGN Bachs checkout is
  `SANDBOX_ONLY`; UK/US-issued cards on that route stay unavailable for live use
  until Bachs confirms acceptance, fees, settlement and dispute handling in
  writing. A customer sees and pays the NGN amount; an FX estimate is secondary,
  with source and timestamp. Refunds use the exact charged NGN amount. Stripe
  US is the only country with saved production Stripe destinations and is the
  only Stripe country eligible for a `SANDBOX_ONLY` route row. Live inspection
  confirmed the two profile-bound destinations are both US, but neither is
  payout-ready; there is no live checkout route. Recheck current provider
  capabilities before creating canonical destination records or enabling any
  route.
  Ghana and Kenya are `DISABLED`; no vague Euro-area row is created. Every other
  destination country remains `DISABLED` until an eligible tailor/destination
  exists and the complete path is evidenced. No Bachs route is `ENABLED` in
  Phase 2.
- **Separate delivery-country gate:** UK requires a recorded VAT-registration
  flag and the checkout VAT rule for parcels at or below £135; US checkout shows
  that the customer pays duties; EU remains disabled pending IOSS review;
  Nigeria is domestic/no-import-gate. Paid checkout requires both a ready
  payment route and a ready delivery-country rule, including for a Nigerian
  tailor shipping to a UK/US customer.
- **Neutral destination and acceptance snapshot:** destination records carry
  provider, legal entity, country, currency, transfer/payout capabilities,
  immutable `fees_collector`, first-withdrawal review state and account-level
  withdrawal tracking. Acceptance atomically snapshots route ID/version, entity,
  charge provider/currency, destination, fee schedule, delivery-country rule,
  tax/duty treatment, staged commercial policy, accepted earning and tailor
  terms; the exposure-cap reservation hook is in that same transaction. Default
  cap is no cap while exposure is measured. Later charge/refund/payout logic
  reads this one accepted `orders` snapshot, not fresh profile or route data.
- **Paystack wind-down:** remove Paystack from new checkout selection and new
  recipient setup/writes. Existing orders, if any, finish on their snapshotted
  provider using temporary historical/test readers. The end condition is zero
  open or unsettled Paystack orders, transfers/refunds/disputes and no remaining
  dispute-window obligation; only then remove the historical readers and keys.
  Recheck production accepted-order/destination counts before any cutover; the
  already-approved preflight found no accepted orders, but does not replace the
  cutover-time check.
- **Availability and operational control:** a customer who cannot place a paid
  order sees “This tailor isn't taking paid orders right now” before writing a
  brief. Tailors see the concrete readiness requirement; Nigerian payout setup
  says “Payout setup is coming soon” until Bachs onboarding exists. Ops can
  inspect and disable each route and delivery-country rule with actor, reason
  and history. Enabling a route requires two distinct approvers and evidence
  IDs for collection, settlement, transfer and tailor withdrawal.
- **Cross-platform and release gates:** the shared resolver/readiness result and
  accepted snapshot are used by customer web, tailor web, iOS, Android, Ops,
  charges, refunds and payouts. Test route/corridor selection, country gates,
  immutable snapshots, capability loss, audited kill switch, two-person enable,
  and Paystack unavailability for new orders. Rehearse additive migrations and
  rollback scripts on local Supabase, then apply each finished migration to Dev
  once. Carry forward the unresolved Phase 1 bank-payout return receipt,
  fabric charge-to-release proof, QA notification-suppression check, and
  authenticated money-timeline visual check into the integrated verification.
  Production migrations, Edge deploys and route enablement remain separate
  releases requiring explicit approval.
6. **Production Stripe destination preflight (read-only, 2026-10-25):** the
   approved DB aggregate found two account-shaped Stripe destination IDs with
   profile country `US` and two malformed/unknown placeholders. The Stripe
   Dashboard was then inspected in **Live mode**, account by account. It lists
   three US connected accounts; two are the profile-bound destinations and one
   is a QA account. Both profile-bound accounts are `Restricted`, with payouts
   paused, outstanding requirements, and no external payout destination. One
   both show Payouts and Transfers paused. The QA account is also restricted and
   is excluded from the profile-bound destination count. Therefore **US is the only production
   Stripe destination country found, but zero production destinations are
   currently capability-ready**. US may be configured `SANDBOX_ONLY`; every
   other Stripe payout-country route stays `DISABLED`, and no route is enabled
   for checkout. Do not create destination records or enable a route until a
   current Stripe API capability check confirms a usable transfer and payout
   path. The inspection was read-only and changed no accounts/settings. Four
   Paystack recipient references remain historical-only and do not create
   routes.

### Resolver caller inventory (20 non-test source files)

Every caller below must be audited and either redirected to the canonical
route-resolution result or changed to consume the accepted order snapshot. No
caller may reconstruct provider from currency after acceptance.

- **Shared policy and UI:** `packages/shared/src/currency-config.ts`,
  `packages/shared/src/payout-gating.ts`,
  `apps/mobile/components/account/CurrencySettingsScreen.tsx`,
  `apps/mobile/lib/money-history.ts`, `apps/mobile/lib/payments.ts`,
  `apps/web/lib/ops-data.ts`, `apps/web/app/ops/action/route.ts`.
- **Edge functions:**
  `supabase/functions/_shared/fabric-release.ts`,
  `supabase/functions/_shared/payout-watchdog.ts`,
  `supabase/functions/account-profile-action/index.ts`,
  `supabase/functions/commercial-adjustment-action/index.ts`,
  `supabase/functions/custom-order-action/index.ts`,
  `supabase/functions/fabric-workflow-action/index.ts`,
  `supabase/functions/material-advance-action/index.ts`,
  `supabase/functions/order-tip-action/index.ts`,
  `supabase/functions/payment-action/index.ts`,
  `supabase/functions/payout-account-action/index.ts`,
  `supabase/functions/ready-made-order-action/index.ts`,
  `supabase/functions/release-order-payouts/index.ts`, and
  `supabase/functions/tailor-profile-action/index.ts`.

## Phase 2 retirement list and estimate

These are explicit Phase 2 outcomes, not parallel infrastructure:

| Existing path/representation | Phase 2 action | Retirement boundary |
| --- | --- | --- |
| Currency-only provider resolver as an independent provider decision | **Redirect every caller** to the evolved canonical route resolver; retain currency parsing/formatting helpers | Remove the old resolver export once the last runtime caller is migrated and compile/search checks show no dependency. |
| Installed SQL `resolve_payment_provider_for_currency()` duplicate map | **Retire** through an additive migration after database dependency search; keep historical migration text immutable | Drop the installed duplicate only after the canonical shared resolver is the only runtime route decision. |
| New-order Paystack recipient setup and recipient-code writes | **Remove or redirect** to neutral destinations; Nigerian setup explains that Bachs onboarding is not yet available | Immediate for new setup/new orders; historical Paystack readers stay until wind-down ends. |
| Provider-specific locked payout columns as the source for new orders | **Redirect all new acceptance, charge, refund and payout reads** to the extended existing `orders` snapshot | Legacy columns become read-only compatibility and are removed only when historical orders and dispute obligations are closed. |
| Per-order bank-withdrawal status for Stripe/Bachs earnings | **Redirect** to account-level `provider_payout_events` and provider balance | Retire from new per-earning presentation in Phase 2; preserve direct-to-bank historical Paystack presentation during wind-down. |
| A second route map or order-snapshot table | **Do not build** | Explicitly prohibited; exactly one resolver and one `orders` snapshot remain. |

### Revised effort

With the explicit reuse boundary, estimate **6–8 engineering days (about
45–55% of a greenfield build)** after the Phase 1 PR is reviewed and merged. This
assumes the existing currency foundation, `orders` snapshot, payout setup,
provider-status events, and Ops money surfaces are extended in place rather than
re-created. Indicative work split: evolve the one resolver and add route plus
delivery-country readiness **1–1.5 days**; provider-neutral destinations and
in-place snapshot/acceptance hook **1–1.5 days**; Ops readiness, audit, kill
switches, and two-person enablement **1–1.5 days**; customer/tailor web and mobile
states **2–3 days**; retire/redirect duplicate resolver and Paystack new-setup
paths while preserving historical readers **0.5–1 day**; local migration
rehearsal and integrated evidence **1–2 days**. Work overlaps; this is a planning
range, not a commitment. It excludes provider onboarding, Bachs confirmations,
legal review, production release, and newly discovered data repair. Phase 2 code
still branches from updated main only after Phase 1 review/merge; this inventory
is the implementation map, not a second routing build.

## Sequence and current blockers

### Implementation-branch re-audit (2026-10-26)

The baseline resolver list above is a starting inventory, not proof that every
caller was retired. A source search on the Phase 2 branch currently finds
`resolvePaymentProviderForCurrency` in 19 non-test files (including the shared
resolver module and the payout-gating compatibility module). The call sites are
not all route decisions: some maintain legacy profile metadata or format Ops and
historical money views. Keep those categories distinct when removing the old
currency helper.

- **Canonical new-order path observed:** custom quote acceptance calls
  `resolveConfiguredPaymentRoute` and sends that route plus the existing
  `orders` snapshot fields to the acceptance RPC
  (`supabase/functions/_shared/payment-route-acceptance.ts`). Ready-made paid
  checkout also resolves the configured corridor and snapshots it before
  checkout (`supabase/functions/ready-made-order-action/index.ts`). The current
  checkout adapter intentionally supports Stripe only; Bachs remains unavailable.
- **Acceptance resolver cleanup (completed 2026-10-26):** custom and ready-made
  acceptance no longer veto the configured versioned route because a provisional
  `*_locked` provider field or the legacy currency map disagrees. Their snapshot
  RPCs still verify the exact configured route, destination provider/country/
  currency/entity/fee collector/capabilities, quote/order currency, delivery
  rule, and environment, then write the canonical route provider to the same
  `orders` snapshot. Bachs remains blocked by the explicit checkout-path gate.
- **Installed SQL helper is not drop-safe:** the acceptance RPC callers were
  removed in additive Dev migrations `20261026060247` and `20261026060718`. A
  read-only Dev function-source audit still finds
  `sync_tailor_payout_currency_fields` (legacy profile metadata maintenance).
  The catalog dependency view was empty, but PL/pgSQL source references are not
  reliably represented by `pg_depend`. Do not drop the helper until the metadata
  trigger is deliberately replaced or retained and documented.
- **Historical compatibility:** new accepted-snapshot phases reject mismatches
  and use the accepted destination; branches with no accepted snapshot retain
  currency/profile fallbacks for existing orders. Do not remove those fallbacks
  until the approved Paystack wind-down condition has been rechecked and met.
- **Paystack new setup:** the Edge `payout-account-action` returns
  `PAYOUT_SETUP_COMING_SOON` for list/verify/confirm actions before any provider
  request. The legacy `payout-setup-request` endpoint now returns the same
  response for `provider=PAYSTACK`, before rate-limit/database work, so it cannot
  create a new manual Ops setup request. Old action names remain only as a
  compatibility shim; existing saved-account/status fields and historical
  webhook, refund, checkout-reconciliation, and payout handlers remain for
  already accepted work. Web/mobile setup controls are unavailable for new
  NGN/GHS/KES setup, and active copy is route-neutral (`7181af5e`, `cc5f708f`).
  Authenticated connected-browser visual verification remains open.

**Next safe implementation boundary:** the accepted-snapshot consumer audit is
closed for current charge/refund/payout paths; the payout watchdog was also
corrected to report its accepted provider snapshot. A full clean local replay is
still blocked by fixture/environment-dependent historical migrations; this
limitation is recorded in the progress log. Remaining verification is the
authenticated Dev route/delivery/destination flow (which needs a dedicated
QA-safe principal and matching destination), followed by the web/mobile visual
pass. Production saved-Stripe destination countries remain a separately
approved, production-read hard stop; no route may be enabled from the current
evidence. Replace or formally retain the profile metadata trigger before
retiring the old SQL helper.

### Charge/refund/payout snapshot consumer audit (2026-10-26)

The source audit is now complete for the current implementation. For an order
with `accepted_route_snapshot_at`, money paths use its provider/currency and
the snapshotted `payout_destination_id`; malformed or mismatching snapshots
fail closed. The only provider-from-currency branches left in these paths are
the explicit no-snapshot compatibility branches for already accepted legacy
orders, retained for the approved Paystack wind-down. New custom and ready-made
acceptance must create the snapshot first.

- **Charges:** `payment-action` uses the accepted charge snapshot; tips,
  material advances, fabric shortfalls, and paid commercial adjustments use
  `acceptedOrderChargeRoute`. Ready-made and custom orders snapshot the route
  at acceptance/checkout. Bachs remains explicitly unsupported in current
  payment execution, so its route cannot reach paid checkout.
- **Refunds:** `refund-order-payments` passes the accepted provider/currency to
  shared refund logic; a settled payment attempt that disagrees with that
  snapshot opens a Money Desk case and is not sent to a provider.
- **Payouts:** ordinary/residual order releases, settlement tranches, tips,
  consultations, material advances, and fabric releases load the pinned
  destination for accepted orders. No snapshot order falls back to profile
  payout details. Provider webhook phase/order attribution is by linked payment
  attempt, not event metadata.
- **Historical references kept:** `payment-action`, tip/material/fabric/
  adjustment actions, payout releasers, and fabric/watchdog compatibility
  branches can still read currency/profile fields when the accepted snapshot is
  absent. They must be retired only after the historical-order wind-down
  condition is met; do not reinterpret them as new-route selection.
- **Customer checkout:** the web redirect-window decision now follows explicit
  provider (`PAYSTACK`/`BACHS`) rather than inferring Paystack from currency.
  Automated checks pass; the required authenticated visual pass remains open.

**Remaining route-readiness gap:** Dev's route, delivery-rule, and neutral
destination tables are still empty. The audited Ops provisioning RPCs and UI
now create only allowlisted route/delivery templates in `DISABLED`; the route
can move only to `SANDBOX_ONLY` through a separate audited action. They do not
enable checkout. The approved Stripe sandbox account is US/USD with transfers
and payouts enabled and no currently-due requirements, but its linked profile
is not explicitly tagged as QA, has no payout-country code, and has no recorded
first-withdrawal review in the Phase 2 destination table. Do not bind that
account to a different profile or mark a destination ready until the account's
profile identity, country/currency, and withdrawal evidence are safely matched.
The Phase 2 config tables remain empty, so integrated availability/acceptance
proof against persisted Dev route records is still pending.

- **Phase 1 landing (rechecked 2026-10-25):** PR [#65](https://github.com/Drape-ltd/drapeon/pull/65) merged to `main` as `0ae6c1f7160e74af9621d07b29e0bf39dba39cd5`. The Phase 2 branch `codex/payments-phase2-routing-redesign` starts from that merge. The PR's separate production release gates remain unchanged: merge does not apply its database migration or deploy Edge Functions. Production migration and Edge releases still require explicit approval. Phase 1's previously identified integrated-proof gaps remain listed above for the Phase 2 integrated test pass; merging is not being described as production database promotion or full end-to-end signoff.
- **Merge/deploy order (re-audited 2026-10-26):** this Phase 2 branch now includes web/Ops code as well as additive SQL migrations. Merging to `main` triggers the production web deploy but does not apply migrations or deploy Edge Functions. The connected production schema compatibility of the current web branch has not been proven, so do not merge/promote its web code ahead of either (a) a separately approved, correctly ordered production migration batch or (b) an explicit test proving every affected web path remains compatible with the old production schema. Production migrations, Edge deployments, and routes remain separate releases requiring scoped approval; this note does not authorize any of them.
- The approved production aggregate reports two profile-bound Stripe destination IDs with country `US` and two malformed/unknown placeholders. Live Dashboard inspection confirmed both profile-bound accounts are US and Restricted, with payouts and transfers paused, outstanding requirements, and no external payout destination. A third US account is QA-only. Thus US is the only production Stripe destination country found, but there are zero capability-ready production destinations. No destination records may be created and no route is enabled until current Stripe API capability evidence confirms the complete path. The separate Sandbox recipient's simulated payouts are test evidence only.
- Production migrations, Edge deployments, and any route enablement remain separate, explicitly approved releases.

- **Current Phase 2 estimate after redesign amendment:** 6–8 engineering days,
  about 45–55% of greenfield, after Phase 1's reviewed PR is merged. This
  replaces the earlier 7–10 day estimate: the work extends the one existing
  resolver, currency foundation, `orders` snapshot, payout setup, provider
  events and Ops surfaces instead of building parallel routing and snapshot
  systems. The estimate covers implementation and integrated verification of
  the route redesign; Phase 1 landing, fresh Stripe capability evidence, Bachs
  written confirmations, legal review, production release and newly discovered
  data repair remain prerequisites or exclusions.
