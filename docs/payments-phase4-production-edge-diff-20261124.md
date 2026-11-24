# Production payment Edge source comparison — 2026-11-24

Read-only `supabase functions download --use-api` into a separate directory per deployed function, compared byte-for-byte with `origin/main` `86e3bd5768f875fd17a23435dad049253a63d5af`. No function was deployed. The nine Production functions whose names cover webhooks, job processing, payout, refund or transfer are below. `reconcile-dev-tip-refund` and `recover-failed-refund-journal` exist in the repo but are not deployed to Production and are excluded. No deployed `withdraw*` function exists. Every listed entrypoint matches `main`; the changed files are bundled shared dependencies.

| Function | Production version | Differing bundled files vs main | Behavioral delta |
| --- | ---: | ---: | --- |
| `stripe-webhook` | 56 | 5 | New `bachsAmountMinor` exact padded-zero parsing; Ops issue refresh/dedupe; strict in-app notice failure; Dev-only SMS capture guard. Stripe signature and event entrypoint match. |
| `bachs-webhook` | 4 | 5 | Same Bachs amount parser, Ops issue refresh, strict in-app notice; required Stripe idempotency header in bundled helper. The terminal-refund padded decimal fix from merged #252 is absent in this deployed bundle. |
| `process-job-queue` | 64 | 2 | Dev-only SMS capture guard; order media path normalization in signed emails. |
| `payout-account-action` | 39 | 4 | Bachs amount parser, Ops issue refresh, and staff-draft auth-session guard. |
| `payout-setup-request` | 48 | 6 | Staff-draft auth guard, app callback return URL, bounded Ops notification request, project-aware return scheme and CORS. |
| `refund-order-payments` | 35 | 4 | Bachs amount parser, Ops issue refresh, required Stripe idempotency header. |
| `release-order-payouts` | 36 | 2 | Ops issue refresh/dedupe and shared issue type. |
| `reverse-stripe-transfer` | 30 | 2 | Ops issue refresh/dedupe and shared issue type. |
| `monitor-payout-changes` | 28 | 8 | Ops issue refresh, bounded notifications, project-aware push/CORS, transactional email template updates and app return URL. |

Other non-behavioral differences are a shared `EXPLORE_SECTION_AUTO_MOVE` issue enum and whitespace in an Ops policy helper. `git log origin/main -- <path>` traces the Bachs parser to #252 (`9d408900`), required Stripe idempotency to #212 (`b36d201d`), Ops issue refresh to the privacy routing repair (`f7fca6af`), staff-draft auth to claim guard (`3d04684b`), Dev SMS capture to claim work (`273da7ce`), order-media normalization to `604d58b1`, and strict in-app notice behavior to Explore work (`c62960e1`). The remaining callback/CORS/email/notification changes are merged `main` work and require a per-file review before promotion; this table is a release inventory, not an authorization to deploy.

## Proposed release unit — approval required

1. Refresh `main` and repeat the bundle diff immediately before release. Stop if either head or deployed version differs from this worksheet. Confirm Production project `wkfsrunetmgjdtcurmoj`, all routes `DISABLED`, and the reviewed source SHA.
2. Deploy in dependency order, each from the exact merged `main` SHA: `monitor-payout-changes`, `process-job-queue`, `payout-setup-request`, `payout-account-action`, `release-order-payouts`, `reverse-stripe-transfer`, `refund-order-payments`, `stripe-webhook`, `bachs-webhook`. Preserve each function's existing JWT setting. After each, call its unauthenticated action path without a provider signature or job token; require an explicit 401/403 auth refusal and no state change. For webhooks, use an unsigned synthetic POST and require 401; never send a live provider event for this probe. If a particular entrypoint returns a validation code before auth, stop and revise that probe before deployment proceeds.
3. Verify each new version and downloaded bundle against the approved `main` SHA. Run `scripts/phase4-production-postflight.sql`, Advisors, cron/queue/dead-letter reads, and zero-enabled-route check. Stop and use the reviewed forward-fix or previous-version rollback if a check fails. No route enablement is included.

This is a **read-only proposal**. The nine-function list and its exact `main` SHA require a separate founder approval before any Production Edge deployment.
