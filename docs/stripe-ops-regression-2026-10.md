# Stripe / Ops regression — October 2026

Environment: Supabase Dev `pqptfuqogvrajozfsqzi`; Stripe test mode only.
Production was not read or changed.

## Production migration ordering (plan only)

After the previously reviewed PAY-003 Batch 1 and C2 Batch 2, apply
`20261030133137_dev_ops_supabase_mfa_identity_receipts.sql` immediately followed
by `20261030151320_repair_local_mfa_receipt_triggers.sql` in the same schema
parity batch. Never ship the first migration without its adjacent repair. Its
local-MFA functions remain gated off outside the exact Dev project. The manual
QA-principal seed is never part of a Production batch.

Migration readiness rule: when a migration has a behavioral test, that test
must pass against Dev inside a single `BEGIN ... ROLLBACK` transaction before
the pull request is marked ready.

## D4 — refund racing payout release

Status: **NOT RUN — fixture rejected before the race**.

At `2026-10-30 04:04:00Z`, two independent Dev database sessions were
scheduled for the same fresh QA tip. The payout reservation committed, while
the refund reservation was rejected by `guard_tip_refund_real_approval` because
the QA request did not contain the required real Money Desk decision and active
execution-attempt receipts. This is invalid fixture evidence, not a D4 product
PASS or FAIL.

- Tip: `aab041dd-d811-470c-b8c3-8933977b8cea`
- Payment: `8bd5e007-e8c4-43e1-a3ba-a416970cc424`
- Invalid request (removed): `e0c526f5-153d-4b8b-b31b-8f33e55a47bd`
- Temporary payout claim (removed): `5cb52148-7953-4ee3-a2a8-84425e78c109`
- Temporary cron jobs: `73`, `74`; both unscheduled, zero remaining jobs
- Provider calls: zero
- Payout rows: zero
- Ledger movement: zero

The append-only tip reservation event prevents deletion of the exact QA tip
and its synthetic payment. The temporary claim and invalid request were
removed; the retained tip is marked `HELD` with an explicit QA-invalid fixture
reason and has no payout ID. Do not reuse it.

Regression remains paused until the supported localhost fallback authenticates
two real Supabase users with verified TOTP MFA. The current environment-signed
`local-workforce` bridge is not acceptable evidence for this gate.
