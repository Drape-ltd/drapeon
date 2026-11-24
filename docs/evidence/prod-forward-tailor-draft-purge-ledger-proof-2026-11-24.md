# Production-forward purge ledger repair proof — 2026-11-24

Scope: `20261124154325_prod_forward_tailor_draft_purges_table`. No Production
write was performed for this proof.

## Read-only Production inspection

Production returned `NULL` for both of these catalog lookups:

- `to_regclass('public.tailor_draft_purges')`
- `to_regprocedure('public.reconcile_cron_edge_outcomes(integer)')`

The missing ledger is the direct cause of the scheduled worker failure. The
absent shared reconciliation function is intentionally outside this repair and
requires a separate reviewed forward migration.

## Disposable local Production-shaped rehearsal

The repair migration was applied twice, each time in a single transaction.
The second application reported only the expected `already exists, skipping`
notices. The final catalog check confirmed:

- RLS enabled;
- no `SELECT` for `anon` and no `INSERT` for `authenticated`;
- `service_role` has `SELECT`, `INSERT`, and `UPDATE`; and
- exactly one `tailor_draft_purges_pending_idx` index.

## Development live-worker proof

Development's formerly deployed `purge-tailor-drafts` was an older function
version that did not use the ledger, so the current reviewed worker was
deployed to Development only. A clearly-labelled terminal Development fixture
was then processed by that worker. It returned HTTP 200 with `scanned: 1`,
`purged: 1`, `failed: 0`; its ledger row was retained with `step: DONE`,
`attempts: 1`, terminal status `REVOKED`, and a non-null `completed_at`.

Fixture identifiers are retained in the terminal session record, not copied
here. No claim token, phone number, email address, or Production data was used.
