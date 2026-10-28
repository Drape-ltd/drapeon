# Phase 3 payment integration progress

Phase 3 branches from main merge `7de90b8f` (PR #66). This log does not authorize a Production release or route enablement. All payment routes remain `DISABLED`; Phase 4 owns live proof and enablement.

## Step A — Phase 1–2 closeout

- PR #68 merged as `33ba45ec` after green static-contract and Cloudflare checks. Its forward-only repair migrations were applied and verified separately in Production. The docs-only merge produced a successful Production Workers build and a new 100% Worker deployment.
- PR #66 rebased onto that main without touching the unrelated `deno.lock` worktree change. `pnpm launch:contracts` passed on Node 22: 90 shared Jest suites, 807 tests, all Edge entrypoints type-checked; PR static-contract and Cloudflare build passed.
- PR #66 merged as `7de90b8f` after separate approval. Its Production migration batches and 24 Edge functions had already been approved, applied and verified separately. Main's static-contract and Workers Build both passed; Cloudflare reports build outcome `success` for that exact commit and a new 100% `drape` Worker deployment at 2026-10-28 01:13:52 UTC.
- Production route read after the merge returned zero `payment_routes` rows, hence zero enabled routes. No route was enabled by either PR.
- Pre-existing Production observations remain open: nine historical DEAD jobs (not replayed), and intermittent `service-health` 503s predating the Edge release. See [Phase 3 production fix-up](phase3-production-fixup.md).
- Source gap found before Bachs money movement: current main has no migrations defining `payout_claims`, `payout_attempts`, or `order_payment_refund_claims`, though Dev has them. The approved, read-only Production catalog check confirmed all three tables are absent there. Phase 3 must restore a replayable, reviewed claims foundation before it can wire transfers or refunds. No Production data rows were read or changed.

## B1 — Server-only Bachs adapter foundation

- Commit `d5d057ba` adds a Bachs client that selects sandbox versus live by the exact Supabase environment and rejects a mismatched key prefix. It requires a fixed idempotency key for every write, never automatically retries an uncertain write, converts amounts through the shared minor-unit helper, and redacts provider error details from thrown errors.
- Tests: `deno test supabase/functions/_shared/bachs_test.ts` — 6 passed, 0 failed. `git diff --cached --check` passed before commit.
- Bachs sources: [API conventions](https://docs.bachs.io/api-reference/api-standards), [idempotency and uncertain-write recovery](https://docs.bachs.io/guides/idempotency), [separate transfers](https://docs.bachs.io/connect/split-payments/separate-transfers).
- Still needed for B1: provider-ID persistence immediately after responses and look-up reconciliation before any retry after an uncertain outcome. No Bachs route is enabled or charge created by this brick.

### B1 typed operations in progress

- Added recipient-account, hosted-onboarding-link, checkout, and separate-transfer request wrappers. They validate returned IDs and the exact currency/amount/destination/group against inputs before a caller may persist them. Checkout uses raw order-time pricing, the route's currency, `customer_bears_fee: false`, and an explicit expiry; no NGN constant is embedded in the adapter.
- Tests: both Bachs test files — 9 passed, 0 failed. Source: [account creation](https://docs.bachs.io/connect/guides/create-an-account), [hosted onboarding](https://docs.bachs.io/connect/guides/hosted-onboarding), [checkout options](https://docs.bachs.io/guides/checkout/checkout-sessions).
- Still needed: wire these wrappers to the existing claims and route snapshot, persist provider IDs immediately, and reconcile uncertain writes. These wrappers alone do not authorize or initiate a provider operation.

## External gates (not Phase 3 blockers)

See [Launch gates](launch-gates.md) for Bachs written answers, legal sign-off, and Phase 4 live route evidence. Visual QA remains deferred as requested.
