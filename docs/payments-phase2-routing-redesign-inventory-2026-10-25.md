# Phase 2 routing redesign: current-main inventory

Baseline inspected: `origin/main` at `04e984a771358fc18c32d8f197ca2f2e364c8667` (2026-10-25). This is an inventory and disposition, not a migration or production approval.

## Existing pieces and disposition

| Existing piece | Current behavior / evidence | Disposition |
| --- | --- | --- |
| Shared currency/provider resolver | `packages/shared/src/currency-config.ts:104-116` maps NGN/GHS/KES to Paystack and USD/GBP/EUR/CAD to Stripe. `resolveSellerPayoutCurrency` and `resolveSellerOrderCurrency` at `:118-169` infer currency from profile/provider/item/customer fallbacks; there is no route-readiness or delivery-country gate. A source search found 20 non-test files calling `resolvePaymentProviderForCurrency`. | **EVOLVE this resolver** into the single canonical route resolver that consumes versioned route and delivery-country configuration; migrate all 20 caller files. Keep currency parsing/formatting helpers. All new order acceptance and pre-acceptance availability must use the same canonical result; UI availability may display it but must not independently choose a provider. |
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
6. **Production country preflight (read-only, 2026-10-25):** the saved Stripe
   profile fields contain 4 distinct account-ID values. Two are profile-declared
   as `US` (two distinct, account-shaped `acct_*` IDs; referenced in both legacy
   Stripe columns), and two have no usable account-shaped ID and country `UNKNOWN`.
   The two `UNKNOWN` values do not establish a payout country. Thus **US is the
   only candidate Stripe destination country**; the profile-indicated US route is
   `SANDBOX_ONLY` provisionally and every other Stripe payout-country route stays
   `DISABLED`. No route is enabled for checkout until current account/capability
   evidence is complete. The profile country is not proof of
   the connected account's actual country or transfer/payout capability. The
   Stripe API check remains **OPEN**: local CLI startup was blocked while it
   tried to change permissions on its protected config, and browser control timed
   out. Do not create destination
   records or enable a route before current Stripe API evidence. The read exposed
   no account IDs in the report and changed no rows/settings. Four Paystack
   recipient references remain historical-only and do not create routes.

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

With this redesign boundary, the estimate remains **7–10 engineering days (about
60–70% of greenfield)** after the Phase 1 PR is reviewed and merged. Indicative
work split: canonical resolver plus route/delivery-country readiness **1–2 days**;
provider-neutral destinations plus in-place immutable order snapshot and
acceptance hook **1–2 days**; Ops readiness/audit/kill switches/two-person
enablement **1–2 days**; customer/tailor web and mobile states **2–3 days**;
retiring/redirecting duplicate resolver and Paystack new-setup paths while
preserving historical readers **0.5–1 day**; local migration rehearsal and
integrated evidence **1–2 days**. Ranges overlap and are planning estimates, not
a commitment. They exclude provider onboarding, Bachs confirmations, legal
review, production release, and newly discovered data repair. Phase 2 code still
branches from updated main only after Phase 1 review/merge; this inventory is
the implementation map, not a second routing build.

## Sequence and current blockers

- Phase 1 has a separate current-main candidate: branch `codex/payments-phase1-main-reconcile`, at `fc7b0171`, 24 commits ahead of recorded `origin/main` `04e984a771358fc18c32d8f197ca2f2e364c8667`. The launch-contract gate now passes and the full Edge suite is 224/224. Final diff review found the approved database invariant preventing one order from having both `ORDER_EARNING` and `SETTLEMENT_TRANCHE` payouts was still missing. A migration and rollback draft are now present but not tested or applied. The candidate is not PR-ready until that guard has a local rehearsal and its complete diff is reviewed. Do not create a Phase 2 code branch before Phase 1 is reviewed and merged. The separate hardening worktree remains divergent and dirty only in `deno.lock`; do not use or alter it. Keep `deno.lock` excluded.
- **Merge/deploy order:** this candidate has no schema migrations or web code, so merging it cannot create a new web/schema compatibility dependency. Main's web deploy is not evidence that its Edge Functions have been deployed; those remain a separate, explicitly approved release. If a future candidate includes both web/schema dependencies, production schema must precede the web deploy or the web code must remain compatible with both schemas.
- The approved production aggregate reports two Stripe profile destinations with payout country `US` and two malformed/unknown-country placeholders. The **actual Stripe account countries and transfer/payout capabilities remain unverified**; no destination records may be created until current API evidence is collected. The profile-indicated US corridor is provisionally `SANDBOX_ONLY`; all other destination countries are `DISABLED`, and no route is enabled for checkout.
- Production migrations, Edge deployments, and any route enablement remain separate, explicitly approved releases.
