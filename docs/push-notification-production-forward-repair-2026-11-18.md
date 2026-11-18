# R1: Push-notification production forward repair

Status: **DEV VERIFIED; PRODUCTION NOT APPLIED**

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
   report any unexpected partial state and stop).
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
