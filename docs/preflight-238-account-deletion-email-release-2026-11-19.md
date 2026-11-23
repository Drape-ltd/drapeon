# Production preflight — PR #238 account deletion email

Read-only preflight completed 2026-11-19. **No Production function was deployed, no migration was applied, and no queue row was changed.** The QA export download remains on hold.

## Pin and live rollback sources

PR #266 was merged after its exact-head founder approval and green `static-contract`. The preflight was initially compared at `47333a265439b712cea17e12301297e5bff32acb`; before publication, `main` advanced through #245 and #263 to `b44370573bfcfbbec0ef9558955f89fe5b0a7b3f`. A path diff confirmed those later commits changed no `supabase/functions` files, so the closure comparison below is unchanged and is pinned to current `main` at `b44370573bfcfbbec0ef9558955f89fe5b0a7b3f`. PR #238 (`1e925b208ae7393a507bf16b065784bf2b065d4a`, merged 06:40:59 UTC) is included in that pin.

The complete live source closures were retrieved from Production and saved locally before any proposed change:

| Function | Live version / updated | `verify_jwt` | Live artifact SHA-256 | Rollback archive | Archive SHA-256 |
| --- | --- | --- | --- | --- | --- |
| `finalize-account-deletions` | v33 / 2026-08-30 19:48:46.656 UTC | `false` | `47f65cc6400f6e30181a7b9ed00557cb1dfdcd19e40851eec2eed043895f3c60` | `/Users/onaopemipodimowo/Documents/Codex/ops-238-preflight-backups/finalize-account-deletions-prod-v33.tar.gz` | `1e1375762b2a8e17e7b7725b534da9e902209f9cb53b9ca2e16deee133fe0a17` |
| `process-job-queue` | v61 / 2026-11-19 01:43:17.585 UTC | `false` | `83709d0d92c310a80cc48ac2967e39e01891cbf7445539f2a9c78f66907831e2` | `/Users/onaopemipodimowo/Documents/Codex/ops-238-preflight-backups/process-job-queue-prod-v61.tar.gz` | `850ce8a0da50a91852b5b7a876d81cd08e1cc3e0555544edfa97dad7e3029e49` |

The finalize rollback archive contains 6 live source files; the queue-worker archive contains 60. Archive metadata includes the project, version, JWT setting, source artifact hash, and capture time. Archive files remain outside the repository.

## Closure comparison with pinned `main`

### `finalize-account-deletions`

PR #238 changes the entrypoint by adding `allowMissingUserRecipient: true` to the `ACCOUNT_DELETION_COMPLETED` email payload. This preserves delivery to the saved recipient address after the Auth user is soft-deleted.

The other live-to-main differences are outside #238:

| Closure file | Difference in pinned `main` beyond #238 |
| --- | --- |
| `supabase/functions/_shared/env.ts` | Adds strict, exact-host Supabase environment classification that fails closed for unknown hosts (PR #66); adds environment-scoped Bachs webhook secrets and provider-neutral payment return URLs (PR #79 / #66); adds app-variant handling for hosted Paystack returns (PR #183). |
| `supabase/functions/_shared/logger.ts` | Routes telemetry through `telemetry-scrub.ts`; audit-write failure logs store a database code rather than the raw error message. Source commit: [`5f85ab86`](https://github.com/Drape-ltd/drapeon/commit/5f85ab863b3002f68c9adc19d4f09b7167eeeeda). This also adds `supabase/functions/_shared/telemetry-scrub.ts` to the current-main closure. |
| `supabase/functions/_shared/cors.ts` | Uses exact environment classification and a loopback-only dynamic-port Dev origin; adds `ops.drapeon.co` plus `x-correlation-id` and `x-drape-ops-access-assertion` to the allowlist. Relevant commits: [`8b091711`](https://github.com/Drape-ltd/drapeon/commit/8b09171139b7e4f7f7e19e592bd4c6bfccaf1f87), [`50bee788`](https://github.com/Drape-ltd/drapeon/commit/50bee78896ab7b9f294450c00c19916bf48d57e5), [`dc97da25`](https://github.com/Drape-ltd/drapeon/commit/dc97da259cfbad58b079494f837849f75721a1c6), and [`5f85ab86`](https://github.com/Drape-ltd/drapeon/commit/5f85ab863b3002f68c9adc19d4f09b7167eeeeda). |
| `supabase/functions/_shared/jobs.ts` | Adds `claimDueJobsById`, a wrapper for `claim_due_jobs_by_id(text, uuid[])` (source commit [`454e8a1b`](https://github.com/Drape-ltd/drapeon/commit/454e8a1bc868b7ef282c4b2035be9205a7ca7b66)). The finalize entrypoint does not call this helper. |

Current `main` also includes the new `telemetry-scrub.ts` dependency through the logger change. No other file in this live closure differed from current pinned `main`.

### `process-job-queue`

PR #238 changes the entrypoint to forward `allowMissingUserRecipient` only when the payload explicitly sets it to `true`. Its shared email changes recognize missing Auth users, skip mail for deleted users unless the explicit saved-recipient exception is enabled, validate the Resend API key, and normalize Resend idempotency headers. `_shared/order-email.ts` receives the same safe header handling. The new [`email-request-headers.ts`](https://github.com/Drape-ltd/drapeon/blob/main/supabase/functions/_shared/email-request-headers.ts) is an additional dependency in the pinned-main closure and is absent from live v61.

The only code change in this closure beyond #238 is [`supabase/functions/_shared/bachs.ts`](https://github.com/Drape-ltd/drapeon/blob/b44370573bfcfbbec0ef9558955f89fe5b0a7b3f/supabase/functions/_shared/bachs.ts): PR #252 (`9d408900`) accepts exact monetary strings with extra trailing zeroes while rejecting nonzero precision beyond the currency's minor-unit scale. This adds Bachs payment-path behavior to a main-based queue-worker redeploy. No other live closure file differs from current pinned `main`.

## Catalog checks and pending completion-email jobs

Production catalog checks confirmed the existing columns `account_deletion_requests.id/status/metadata`, `domain_events.id/event_type/payload`, and `job_queue.id/event_id/job_type/status/payload/created_at`. The existing `enqueue_domain_event` signature is present with the expected argument types. The current-main `claim_due_jobs_by_id(p_worker_id text, p_job_ids uuid[])` function is also present. The PR #238 changes add no table, column, enum, or migration requirement; they change email behavior and an existing JSON job payload.

Read-only count, joining `domain_events` to `job_queue` on `event_id` and filtering `event_type = 'ACCOUNT_DELETION_COMPLETED'`:

| Job type | Status | Count |
| --- | --- | ---: |
| `SEND_ACCOUNT_EVENT_EMAIL` | `SUCCEEDED` | 1 |
| `SEND_ACCOUNT_EVENT_EMAIL` | queued/pending (`PENDING`, `RETRYABLE`, `PROCESSING`) | **0** |

No job was retried, updated, or closed.

## Proposed deploy order — not executed

1. `finalize-account-deletions` from pinned `main` `b44370573bfcfbbec0ef9558955f89fe5b0a7b3f`, retaining `verify_jwt=false`. Rollback source is the v33 archive above.
2. `process-job-queue` from the same pin, retaining `verify_jwt=false`. Rollback source is the v61 archive above.

This document is a preflight only. No deployment is authorized or performed here; await the founder's review before any release.
