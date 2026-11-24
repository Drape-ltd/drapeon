# Bachs transfer monitor — Dev evidence, 2026-11-24

This change adds a dedicated `BACHS_TRANSFER_ONLY` mode to the existing
`monitor-settlements` function. It scans at most 50 existing Bachs settlement
tranche claims every 15 minutes, rotating pages so old unresolved claims do not
starve later ones. The scan selects only `PROVIDER_UNKNOWN`, `PROVIDER_PENDING`,
and `TRANSFERRED` claims. It never selects `RESERVED`, so the shared payout
executor runs in reconciliation-only mode and cannot start a new transfer.

The existing watchdog creates or refreshes an Ops issue linked to the payout
claim, uses a stable dedupe key, sends the Slack-backed Ops notification when
an overdue issue first appears or reopens, and tells Ops to inspect the saved
transfer reference rather than send a replacement. The same monitor finalizes
an already-paid transfer and resolves its watchdog issue. No payment route or
withdrawal gate is changed by this schedule.

## Dev verification

- Project: `pqptfuqogvrajozfsqzi` only. Deployed `monitor-settlements` v129
  with its existing `verify_jwt=false` setting preserved.
- Before scheduling, one Bachs settlement-tranche claim was `TRANSFERRED`.
  Manual scans returned HTTP 200 for request IDs `300451` and `300452`, each
  with `checked=1`, `confirmed=1`, `pending=0`, `blocked=0`. The second scan
  found the same existing transfer and did not create a replacement.
- Applied exact Dev migration `20261124160000`; the generated apply marker
  `20261124153147` was reverted using the supported migration-repair command.
  Dev now records only the source version. Cron
  `reconcile-bachs-transfer-claims` is active at `*/15 * * * *`.
- Dev route states after the change: two `DISABLED`, one `SANDBOX_ONLY`, zero
  `ENABLED`. No Production migration, Edge deployment, route change, or live
  provider call occurred.
- Focused mode/watchdog tests: 8 passed. Edge entrypoint typecheck and
  `git diff --check` passed.

The current Dev claim was already `TRANSFERRED`, so this runtime check proves
lookup/finalization and repeat behavior. The pending/overdue Slack branch is
covered by the focused watchdog tests; a fresh provider-pending stale claim
was not manufactured merely to send an alert. A natural stale claim will be
observed by the scheduled scan and can be recorded separately.

Promotion remains a separate Production release decision. Deploy the reviewed
Edge version before this exact cron migration; verify the mode manually on
Production with routes disabled before applying the schedule. Never use a
broad migration push.
