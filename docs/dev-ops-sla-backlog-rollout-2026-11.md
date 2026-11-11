# Dev Ops SLA scheduler backlog rollout — 2026-11-11

Status: **review proposal; no scheduler or backlog action applied**. This covers
Dev only. Production requires its own inventory and release approval.

## Read-only first-run preview

The live `enqueue_ops_slack_sla_reminders()` selection was reproduced without
calling the function. At the 2026-11-11 check, it selected 55 open cases: 40
`SLA_REMINDER_DUE` audit rows and 15 one-time backup-team escalations. The
largest reminder cohort was 22 HIGH reliability cases from
`process-job-queue`. Nine MEDIUM trust/safety cases would receive a reminder
audit row. The 15 escalations were MEDIUM trust/safety cases with their three
reminders already exhausted. The remaining nine reminders were HIGH or
CRITICAL money-desk, reliability, or operations cases.

A second read-only selection after the seven historical money-push cases were created (2026-11-11 01:56 UTC) still returned **55**: 40 reminders, 15 escalations and at most 31 immediate Slack jobs. None of the seven new historical alert cases was due for this first run. No scheduler or case was changed by the recheck.

The current audit trigger suppresses immediate Slack for MEDIUM reminders and
for automatic digest-only escalations. Thus the first run can enqueue **up to
31 immediate `SEND_OPS_SLACK` jobs** for HIGH/CRITICAL reminders; its existing
quiet-period rule may reduce that number. These are limits from code and a
point-in-time preview, not a promise that the queue will be identical later.

## Controlled Dev rollout after review

1. Finish the separate seven-case historical money-push recovery and verify
   its cases, notices, replay, and unchanged money baseline. Keep those cases
   separate from this SLA backlog. Inspect the 15 proposed escalations in Ops
   by source and current outcome. Do not bulk-close, pause, or reset cases to
   make the preview smaller; handle any fixture cleanup through a reviewed Ops
   action.
2. Immediately before applying #152, recheck project identity, exact pending
   migration version, absent cron, live bounded worker/grants, trigger filter,
   candidate counts by action and severity, and existing Slack queue health.
   If the function or trigger differs, or the first-run volume materially
   exceeds this preview, stop for a fresh review.
3. Apply the reviewed migration from merged main to Dev under exact version
   `20261111003000`. It registers the 27/57-minute schedule; it does not invoke
   the worker in the migration. Observe the first scheduled run. Record its
   `cron.job_run_details`, reminder and escalation audit counts, case-event and
   receipt counts, `SEND_OPS_SLACK` jobs with terminal outcomes, and any retry
   or dead-letter. Verify the 15 escalations are digest-only and each lifecycle
   has no duplicate escalation on the next scheduled run.
4. If the scheduled run fails or the Slack queue cannot drain, unschedule using
   the committed rollback after checking its marker and current job body.
   Existing audit/case changes are not undone by unscheduling; reconcile them
   through the normal Ops case workflow. Never delete audit or notification
   rows to force a clean retry.

This plan restores an overdue reminder lane. It does not declare the existing
cases resolved or make E3 pass. E3 still needs an operator outcome on the
overdue cases and evidence that new cases receive timely reminders and a
terminal notification outcome.
