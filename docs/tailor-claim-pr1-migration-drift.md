# Tailor claim PR 1 migration drift

This is a blocking prerequisite for PR 2, not production migration authority.

## Observed state

- The canonical fresh schema and production lineage use `public.tailor_profiles.id uuid`.
- Development currently reports `public.tailor_profiles.id text`.
- PR 1 was first exercised in Development through multiple one-off migration versions before the consolidated repository migration existed. Development may therefore contain migration-history rows that have no matching repository file.
- A full fresh replay of the repository migration directory is independently blocked by older migrations, including `20260826120030_repair_legacy_stage_update_and_settlement_calls` and the `20260910211000` / `20260910214000` Ops SLA sequence.

## Required before PR 2

1. Export and compare Development, Production, and repository migration versions without writing to either environment.
2. Inventory the exact one-off PR 1 Development versions and their installed objects.
3. Reconcile Development with forward-only, reviewed migrations. Do not delete applied history rows or rewrite already-applied migration files.
4. Repair the older fresh-replay blockers and prove the complete repository chain on an empty database.
5. Re-run PR 1 and PR 2 tests against a schema whose ID types and migration history match the production lineage.

Until this is complete, a Development-only pass is not evidence that a database change is production-compatible.
