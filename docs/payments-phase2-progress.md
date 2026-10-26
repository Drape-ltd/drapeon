# Payments Phase 2 progress

## 2026-10-25 — Brick 1: canonical route resolver foundation

- **Branch/base:** `codex/payments-phase2-routing-redesign`, based on merged Phase 1 PR #65 at `0ae6c1f7160e74af9621d07b29e0bf39dba39cd5`.
- **Changed:** added a typed shared resolver in the existing `currency-config.ts` module. It matches one exact tailor-country + customer-charge-currency + tailor-payout-currency route, requires exactly one transfer/payout-capable destination, and independently requires exactly one ready delivery-country rule. It fails closed for missing/duplicate configuration, disabled routes, sandbox-only routes in production, unsupported corridors, unconfirmed issuer countries on enabled Bachs routes, and unavailable destinations/delivery rules. Removed `payout-gating.ts`'s duplicate private currency/provider mapping by importing the existing shared normalization/provider helpers. Added shared customer-block and reason-specific tailor guidance from resolver results; this is copy only and does not route or enable checkout. The web/mobile screens have not been wired to this helper yet.
- **Tests:** focused shared tests: 2 suites, 33 tests passed. Workspace typecheck: 5 package tasks passed. `pnpm launch:contracts`: passed (shared 86 suites / 750 tests, Deno checks/tests included; web lint 32 pre-existing warnings, 0 errors; mobile lint 392 warnings, 0 errors; other contract checks passed). `git diff --check`: passed.
- **Dev evidence:** none for this brick; it is pure shared policy code and no database, Dev project, provider, production, or route settings were changed.
- **Design deviations:** none. Bachs remains non-live; route resolution does not enable any route. This resolver is the single decision point, while existing currency-only callers still need migration in subsequent bricks before the legacy export can be retired.
- **Open items:** route configuration/delivery-country persistence and accepted-order snapshot migration; migrate all 20 caller files to consume the resolver before removing the currency-only provider helper; verify all charge/refund/payout paths read the accepted `orders` snapshot; clean-room local Supabase replay is blocked by existing migrations that require seeded orders; Phase 1 integrated proof gaps remain for the integrated test gate.

## 2026-10-25 — Brick 2: version selection and destination readiness

- **Changed:** the canonical resolver now selects the latest version for the exact payment corridor and delivery country. Older versions do not create false ambiguity, while a newer disabled or duplicate version fails closed and cannot fall back to an older ready row. Destination readiness now also requires matching legal entity and immutable fee collector, an active destination, transfer and payout capabilities, and cleared first-withdrawal review.
- **Tests:** focused shared tests: 2 suites, 34 tests passed; full shared suite: 86 suites / 751 tests passed. Workspace typecheck: 5 package tasks passed. `git diff --check`: passed.
- **Dev evidence:** none; no route rows or provider settings changed.
- **Design deviations:** none.
- **Open items:** persist/load the versioned route data and connect this resolver to customer/tailor/ops flows; add database tests for immutable snapshots and route-enable approvals; continue caller migration before retiring the currency-only helper.

## 2026-10-25 — Brick 3: Paystack new-setup wind-down

- **Changed:** removed the Paystack bank-directory, account-verification, and recipient-creation implementation from `payout-account-action`. Legacy mobile/web clients still receive a typed `PAYOUT_SETUP_COMING_SOON` response; payout status and historical payout readers remain. New NGN/GHS/KES setup is blocked in the shared setup copy, server action, both web payout surfaces, and mobile currency step. Existing saved payout details, order snapshots/history, Stripe setup, and in-flight legacy orders are not modified. Nigerian manual bank setup is also rejected by the server until provider setup is available.
- **Tests:** focused payout setup tests: 15 passed; full shared suite: 86 suites / 761 tests passed in serial mode. Workspace typecheck: 5 tasks passed. `deno check --sloppy-imports supabase/functions/payout-account-action/index.ts`: passed. `pnpm launch:contracts`: passed on rerun; mobile lint had 392 warnings / 0 errors and web lint 32 warnings / 0 errors. `git diff --check`: passed. One initial parallel Jest worker run segfaulted after 85 suites; rerun serially passed all 86 suites.
- **Dev evidence:** no Dev database writes, secrets, provider calls, or Edge deployment. Connected-browser visual check remains pending because the computer-control session timed out twice; the test evidence is static/unit/typecheck only.
- **Design deviations:** none. Paystack setup action names remain in the request schema as a compatibility shim for older binaries, but return 409 before any provider call. No new route is enabled.
- **Open items:** visually inspect the web payout screen with a connected browser; verify the same “coming soon” state on a mobile test build during the integrated cross-platform pass; route config/accepted-order snapshot migration remains uncommitted pending clean local database replay.

## Local database rehearsal preflight

- Colima/Docker was brought up locally. `supabase start` replayed the repository migrations from an empty database and failed on pre-existing rollback-only verification migrations that require seeded development orders (`20260731150100`, `20260801020100`, then `20260801020200`). Other verification migrations explicitly skip when those fixtures are absent, but these do not.
- Temporary local-only edits to four verifier files were restored immediately; no historical migration file changes remain. Supabase containers were stopped. The Phase 2 route-schema migration and rollback now exist as an uncommitted draft; neither has been run on local, Dev, or production.
- **Blocked:** exact clean-room local migration rehearsal until the repo has a supported local fixture/verification strategy. This is a baseline reproducibility issue, not a Phase 2 migration error. Continue independent application/shared work; do not apply Phase 2 schema to Dev until this gate is resolved.
- Further local replay attempts (including `supabase db start`) failed at the same financial-case verifier, and the CLI stopped the local database before an in-flight fixture could be inserted. The attempts made no source/history edits and no remote writes. Keep the new route-schema migration uncommitted until it can be replayed and rolled back locally.

## In progress — route/delivery schema foundation (not committed)

- Drafted an additive migration and rollback for versioned `payment_routes`, separate `delivery_country_rules`, provider-neutral `payout_destinations`, enablement approvals/audit, and the existing `orders` route snapshot. No rows are seeded; all new route rows must be created DISABLED. Snapshot writes require the future canonical acceptance operation. Prisma schema validation passes.
- **Not verified:** local replay fails before reaching this migration at the pre-existing financial-case verifier fixture requirement. The CLI tears down local Postgres after that error, so no local fixture could be injected. The migration and rollback have not been applied or rehearsed on any database. Keep both uncommitted until local replay and rollback pass; no Dev or production SQL was run.
