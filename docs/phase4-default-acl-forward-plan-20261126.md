# Phase 4 default ACL repair — review before Production

Status: Dev applied; Production **prepare only / needs Ope**. Exact version
`20261126080246`. No Production SQL, route, Edge or provider action was run.

## Why this precedes S1–S4

The 2026-11-26 Production catalog read found 24 `postgres`-owned `public`
default grants to `anon` or `authenticated` across tables, sequences and
functions. `supabase_admin` has a separate similarly broad default ACL. Dev's
`postgres` `public` default ACL already had zero client-role entries. An
inherited grant on a new payment table can expose rows or permit table
operations before a later repair, so the S-batches remain held.

This migration revokes `postgres` schema-level table and sequence defaults
from `anon` and `authenticated`, and removes explicit schema-level function
EXECUTE grants to `PUBLIC`, `anon` and `authenticated`. PostgreSQL's built-in
`PUBLIC EXECUTE` default is **global**: a schema-level revoke alone cannot
remove it. Therefore the migration also revokes global default function
EXECUTE from `PUBLIC` for objects subsequently created by `postgres`. This
affects future `postgres`-owned functions in other schemas too; existing
functions and grants are unchanged. Review that scope before Production apply.
See [PostgreSQL ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html).

`supabase_admin` defaults are not modified by this `postgres` migration.
Every S-batch must still explicitly revoke new tables and sequences from
`anon` and `authenticated`, and new functions from `PUBLIC`, `anon` and
`authenticated`, before granting the exact caller privileges. This also
protects objects created under `supabase_admin`.

## Evidence and rehearsal

- Dev project guard read `DEVELOPMENT / pqptfuqogvrajozfsqzi`. Migration
  `20261126080246` is recorded once. The `postgres` `public` and global
  `pg_default_acl` post-check returned zero `PUBLIC`/`anon`/`authenticated`
  entries. Dev retained zero enabled payment routes.
- In a disposable PostgreSQL 17 container with Production-shaped default
  grants, a schema-level function revoke alone left a new function callable
  by `PUBLIC`. The reviewed migration, including the global revoke, made a
  newly created table, sequence and function unavailable to `anon`; the
  table was also unavailable to `authenticated`. A second apply was
  idempotent. A mismatched project guard failed before any ACL change. The
  full rehearsal was rolled back and is automated in
  `scripts/test-phase4-default-acl-postgres.sh`.
- Production read-only preflight returned `PRODUCTION /
  wkfsrunetmgjdtcurmoj`, 24 `postgres` schema-level client grants,
  version absent, and zero enabled routes. This is a catalog and local
  compile check, **not** a Production apply.

## Production release gate and postflight

After Ope approves this exact version, re-read the project guard, default
ACL entries for `postgres` and `supabase_admin`, version absence, and route
count. Stop if they differ from the baseline above. Apply this exact file
once through the supported migration workflow, not a broad `db push`.

Postflight: exact version recorded; `pg_default_acl` for `postgres` in
`public` has zero `PUBLIC`/`anon`/`authenticated` entries for tables,
sequences and functions, and its global function default has no `PUBLIC`
EXECUTE; existing function/table ACLs unchanged; `supabase_admin` defaults
unchanged; Advisors, health, queues and routes checked, with zero enabled
routes. The rollback file refuses to restore insecure defaults. If the
postflight fails, stop S1–S4 and prepare a reviewed forward fix.
