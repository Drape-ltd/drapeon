# Dev soft-deleted account email proof — 2026-11-19

## Scope

This proof is limited to Supabase Dev (`pqptfuqogvrajozfsqzi`). Production was
not read or changed, and the held Production QA export was not touched.

PR [#270](https://github.com/Drape-ltd/drapeon/pull/270) merged as
`b5deb8f969ebdd61e1105ee5c70bd40c8dbd78f2`. The Dev deployment and both QA
jobs below were pinned to that merge commit.

The normal request → approval → finalization path was not exercised end to end:
the account-settings deletion request intentionally requires a password
re-check. The delete-then-email ordering remains established by code review of
`finalize-account-deletions`: it soft-deletes the Auth user before enqueueing
the flagged `ACCOUNT_DELETION_COMPLETED` email. This proof exercises the worker
behavior after that ordering directly.

## Dev deployment

| Function | Before | After | `verify_jwt` | After artifact SHA-256 |
| --- | ---: | ---: | --- | --- |
| `process-job-queue` | v186 | v187 | `false` | `2c9efa41d3eca4cd4ed1138256a77bbfd32b8e3bc34ffa88b7af097bbed65db1` |
| `finalize-account-deletions` | v94 | v94 (unchanged) | `false` | `1ea83e3fe0ba6c66992d1e4293e94db8515fd2435050a4d395bb13fcf4644457` |

The v186 rollback artifact hash recorded immediately before deployment was
`77434f7d623e6c2e3888f9e0d9d392f554ef033187ac6aa6f3814fda9a996228`.

## Synthetic proof

The reused Dev-only Auth user
`3450e4cc-e837-4716-bb24-ab2a79503573` had a non-null `deleted_at` at proof
time. Its Auth email had already been anonymized by the soft delete.

### Flagged deletion-completion email

- Domain event: `a6e97b9b-3268-490b-86e2-fa913a140696`
- Queue job: `366c8098-4ff6-4862-b21b-bc80b6251379`
- Queue terminal state: `SUCCEEDED` on attempt 1 at
  `2026-11-19 17:40:01.902611 UTC`
- Delivery outcome: `ACCEPTED`, provider `RESEND`
- Provider reference: `01a1f4e4-dc09-71c9-848f-1f4265a53ea6`
- Resend `last_event`: `delivered` at `2026-11-19 17:40 UTC`

The provider result was read from the authenticated Resend delivery record. No
Resend API key value was read, printed, stored, or committed.

### Unflagged ordinary account email

- Domain event: `555c2604-1394-4ca5-9b06-3922989f3844`
- Queue job: `7e8e2f76-b265-402b-9de3-d7c73a686f22`
- Queue terminal state: `SUCCEEDED` on attempt 1 at
  `2026-11-19 17:40:01.787525 UTC`
- Delivery outcome: `SKIPPED`
- Delivery reason: `MISSING_USER`
- Provider reference: none; Resend was not called

The queue row is `SUCCEEDED` because an intentional missing-user skip is a
successful terminal worker outcome. The channel-level delivery audit is the
authoritative `SKIPPED/MISSING_USER` result.

## Cron and health observation

The scheduled `process-notification-jobs` cron ran successfully at both
`17:40:00 UTC` (the proof cycle) and `17:45:00 UTC` (the required additional
cycle). Function logs show `POST 200` for Dev `process-job-queue` v187 on both
cycles and no 5xx response in the observation window.

After the second cycle:

- new `DEAD` jobs created since the proof began: **0**;
- total `DEAD` remained **476** (474 actionable, 2 already reviewed);
- `PROCESSING` remained empty;
- the proof jobs retained their terminal outcomes above.

The historical Dev dead-letter backlog was not retried, reviewed, or changed.
Production deployment remains blocked pending review of this evidence.
