# Storage default ACL follow-up — plan only

No migration or Production change is included in this PR.

Read-only Production `pg_default_acl` inspection on 2026-11-26 found **24
client privilege entries** for objects owned by `postgres` in schema
`storage`: 16 table, 6 sequence and 2 function entries for `anon` or
`authenticated`. A separate 24 entries belong to `supabase_admin` in
`public`; the postgres migration cannot change that owner's defaults.
The merged `20261126080246` repair covers postgres-owned objects in `public`
and the role-global PUBLIC function default. It does not remove the
schema-specific `storage` entries or change any existing object ACL.

## Proposed separate security release

1. Inspect the actual owner of Storage's tables and functions and the grants
   required by Supabase Storage APIs. Confirm that changing future
   postgres-owned `storage` objects does not break object upload, signed URL
   issuance or bucket policy evaluation. Preserve existing object ACLs.
2. Add a new guarded forward migration that runs only these default ACL
   changes for role `postgres` in schema `storage`:
   `revoke all on tables from anon, authenticated`,
   `revoke all on sequences from anon, authenticated`, and
   `revoke execute on functions from public, anon, authenticated`.
   Do not repeat the role-global function revoke already supplied by
   `20261126080246`. Do not attempt to change `supabase_admin` as `postgres`.
3. Apply to Dev first. In disposable PostgreSQL, create new probe objects as
   `postgres` in `storage`, reapply the migration, and prove `anon` and
   `authenticated` cannot use them without explicit grants. Check the
   Storage API's signed and anonymous access paths against the intended
   bucket policies. No customer objects are needed.
4. Before any Production proposal, collect a fresh names-and-counts-only
   `pg_default_acl` preflight, version absence, project guard, Advisors and
   route state. Request a separate exact-version approval. Postflight must
   show zero postgres/storage client defaults, unchanged existing object
   ACLs, healthy Storage APIs and zero enabled payment routes.

The `supabase_admin` public defaults need a distinct owner-capable plan and
review. This document does not authorize that change or any Production apply.
