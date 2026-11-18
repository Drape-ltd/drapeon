# R1: Push-notification production forward repair

Status: **DEV VERIFIED; PRODUCTION NOT APPLIED**

## Production preflight — read-only 2026-11-18

**Result: ready for the three-version batch.** All three exact source versions
are absent. The existing prerequisites are present:

- `notification_delivery_outcomes` has all columns used by the upsert,
  including `event_id`, `job_id`, `channel`, recipient/order links, `status`,
  `reason`, provider fields, `metadata`, and `terminal_at`. Its existing unique
  key is `notification_delivery_outcomes_job_id_key` on `(job_id)`; the table
  has 460 rows and zero duplicate job IDs.
- `job_queue.event_id` is present.
- `push_delivery_attempts` has the existing token, ticket, status, error,
  timestamp, receipt-check and notification fields used by the deployed worker
  and receipt reconciler. `notification_job_id` is the one intended new column
  in this release.
- `register_push_token(text,text,text)` exists. The new
  `register_push_token_with_provenance(text,text,text,text,text,text,text)` is
  intentionally supplied by step three.

The deployed `process-job-queue` bundle (version 60,
`196afebe…a8fc`) currently reads `push_tokens.id`, `token`, `user_id`, and
`quarantined_at`; it inserts the delivery-attempt fields `user_id`,
`push_token_id`, `ticket_id`, `status`, `notification_kind`, `order_id`,
`message_id`, `error_code`, `error_message`, `next_check_at`, and
`notification_job_id`. It has a temporary fallback that omits the job link
when that final column is absent. Step one removes the need for that fallback;
step two's trigger then reconciles the linked attempt without an Edge deploy.

The deployed `process-push-receipts` bundle (version 27,
`92fe98e2…e37e`) uses delivery-attempt identifiers, token/ticket/status,
receipt-check timestamps/counters, provider acceptance, error fields and
`updated_at`; it removes only definitely unregistered Expo tokens. Every one
of those existing fields is present. Its status updates will invoke step two's
trigger after this repair.

### Released-mobile registration check

The mobile source added `register_push_token_with_provenance(...)` at commit
`87c7f98d` on 2026-11-11. App Store Connect build metadata could not be read
because the account has an unaccepted/expired agreement, so the exact released
iOS build cannot yet be asserted from Apple.

Production runtime evidence over 2026-11-11 through 2026-11-18 shows 12
successful calls to the legacy `register_push_token` RPC and no observed calls
to the provenance RPC. Production `push_tokens` activity is small but live:
1 row created, 2 updated, and 2 touched in the last 14 days (24 total rows).
Therefore the missing provenance RPC is not established as the cause of the
current dead jobs. It does become a release dependency for any mobile build
containing commit `87c7f98d`; R1 supplies it before such a build is promoted.

## Incident

Production `SEND_PUSH` jobs have failed because deployed `process-job-queue`
expects the newer push receipt/provenance schema while Production does not have
it. The observed database error is `column push_tokens.quarantined_at does not
exist`. The repair is schema-only: it does not enqueue, replay, send, or delete
any notification.

## Exact migration batch

Apply these migrations in order and as a single, dedicated Production batch:

1. `20261118023004_prod_forward_push_notification_schema.sql`
2. `20261118023124_prod_forward_push_notification_receipt_contract.sql`
3. `20261118023335_prod_forward_push_token_provenance.sql`

They are intentionally split by dependency:

| Step | Change | Data/scheduler effect |
| --- | --- | --- |
| Schema | Adds missing provenance/quarantine columns, `notification_job_id`, constraints and index. | No backfill or scheduler change. |
| Receipt contract | Restores the receipt reconciliation functions and trigger after their tables/columns exist. | No job replay or provider call. |
| Provenance | Restores registration/quarantine functions and a token-change trigger. | Existing tokens change only on a future token update or three future bad-device failures. |

Rollback files are rehearsal-only. Production recovery is forward-only.

## Dev and local evidence

- Local isolated PostgreSQL apply → assertion → rollback passed through
  `scripts/test-push-production-forward-postgres.sh`.
- Dev has the exact source versions recorded and the three schema/function
  layers installed.
- The Dev worker and receipt proof completed through the deployed
  `process-job-queue` and `process-push-receipts` functions. The safe QA job
  reached an Expo ticket, then the receipt reconciler recorded a terminal
  `DeveloperError` and changed the job-level outcome to `DEAD`. This proves the
  new job link, receipt trigger, reconciliation function and durable outcome
  agree on a provider failure. It did not send any Production notification.

### Dev QA worker fixture

| Item | ID / value | Safety boundary |
| --- | --- | --- |
| QA job | `b5faf0f8-3b3f-4dcc-9b2f-e8dca1f60f02` | Dev only; `SEND_PUSH`, one attempt. |
| QA push-token row | `b1c5d0f8-3b3f-4dcc-9b2f-e8dca1f60f02` | Intentionally invalid Expo token; no real device. |
| QA tag | `push-forward-20261118` | Limits log/database lookup and later cleanup. |
| Accepted-ticket attempt | `1d6ba3d2-c29c-4e76-a39d-e8471da52912` | Receipt was checked once and ended `DELIVERY_ERROR` / `DeveloperError`. |
| Job-level delivery outcome | `PUSH` / `DEAD` / `DeveloperError` | Reconciled at `2026-11-18T02:53:35Z`. |

The earlier all-zero-recipient fixture is retained only as an audit example: it
correctly hit the foreign-key guard and was never capable of delivering a push.
The valid QA recipient used for the completed run is a documented Dev QA
account; no production identity or customer account was used.

## Production preflight (read-only)

Before applying, verify all of the following:

1. The three exact migration versions are absent from migration history.
2. `push_tokens`, `push_delivery_attempts`, `job_queue`, and
   `notification_delivery_outcomes` exist with their expected native ID types.
3. The new columns, constraints, index, functions and triggers are absent (or
   report any unexpected partial state and stop). Confirm the existing
   `notification_delivery_outcomes` unique key on `job_id`, `job_queue.event_id`,
   delivery-attempt receipt fields, and `register_push_token(text,text,text)`
   before applying.
4. Capture aggregate counts only: `SEND_PUSH` jobs by status, push attempts by
   status, delivery outcomes by status, and currently quarantined tokens.
5. Record the current two dead `SEND_PUSH` jobs by ID, age and event purpose
   for a separate relevance decision. **Do not replay them in this release.**

## Production postflight

1. Confirm all three history versions, columns, constraints, index, functions,
   function grants and both triggers are present.
2. Confirm service-role-only execution for reconciliation/provenance helpers;
   public/anon/authenticated roles must not receive direct execution.
3. Recheck the same aggregate queue counts and query logs for a fresh
   `quarantined_at does not exist` error. Check health and database advisors.
4. Confirm payment routes remain unchanged and disabled where they were
   disabled before the repair.
5. Review the two previously dead jobs outside the release window. Replay only
   a still-relevant notification through the normal, idempotent job path.

## Explicit non-goals

- No Production Edge deploy.
- No provider, Bachs, Stripe, Expo or webhook call.
- No push replay, notification resend, data backfill or scheduler change.
- No resolution of the separate `tailor_claim_invites` Dev-only feature leak.
