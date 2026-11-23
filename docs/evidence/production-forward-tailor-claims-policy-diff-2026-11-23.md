# Production policy diff — tailor claims forward batch

Read-only Production catalog capture on 2026-11-23. No row data, credentials,
or schema change was read or written.

## Current Production definitions

`public.is_public_tailor_profile(text)` is a `STABLE SECURITY DEFINER` helper
with fixed `public, pg_temp` search path. Its predicate is:

```sql
tp.id::text = p_tailor_profile_id
and tp.is_live
and tp.is_verified
and not tp.is_test_profile
```

The public policies currently in use are:

| Table | Policy | Current public predicate |
| --- | --- | --- |
| `tailor_profiles` | `Public can view live tailor profiles` | `is_live = true AND is_verified = true AND is_test_profile = false` |
| `portfolio_photos` | `public: read public portfolio photos` | `is_public_tailor_profile(tailor_profile_id::text)` |
| `portfolio_items` | `public: view live portfolio` | `is_public_tailor_profile(tailor_profile_id::text)` |
| `seller_items` | `public reads live seller items` | `is_live AND is_public_tailor_profile(tailor_profile_id::text)` |

The owner policies on these tables are not changed by the forward migration.

## Existing PostgREST pre-request setting

The Production `pg_db_role_setting` row for `authenticator` currently contains
only `session_preload_libraries=safeupdate`, `statement_timeout=8s`, and
`lock_timeout=8s`. It has no `pgrst.db_pre_request` setting, so the planned
claim hook does not replace an existing authenticator hook. The repeatable
stop-on-difference query is in
[`production-forward-tailor-claims-preflight.sql`](production-forward-tailor-claims-preflight.sql).

## Forward definitions and behavioral diff

The forward migration changes only the public helper and the named public
`tailor_profiles` policy. It intentionally does **not** recreate the current
portfolio or seller policies: they retain their exact names, roles, commands,
and predicates and obtain lifecycle gating through the helper.

| Object | Forward behavior | Difference | Reason |
| --- | --- | --- | --- |
| `tailor_profiles` public policy | Existing predicate plus `lifecycle_state = 'LIVE'` | A non-`LIVE` row can no longer be public even if an accidental write sets `is_live` and `is_verified`. | Draft, invite, claiming, revoked, declined, or expired profiles must never enter Explore. Existing Production profiles receive the migration default `LIVE`, so their current public visibility is unchanged. |
| `is_public_tailor_profile(text)` | Existing UUID/text-compatible predicate plus `tp.lifecycle_state = 'LIVE'` | Dependent reads for a non-`LIVE` profile become false. | Makes the same invariant apply to portfolio and seller content. |
| `portfolio_photos` public policy | No DDL change; helper result changes only as above. | Private media of a non-`LIVE` profile is no longer readable. | Claim media remains private until finalize. |
| `portfolio_items` public policy | No DDL change; helper result changes only as above. | Items of a non-`LIVE` profile are no longer readable. | Fails closed with the profile lifecycle. |
| `seller_items` public policy | No DDL change; its current `is_live AND helper(...)` predicate remains. | Non-`LIVE` sellers no longer qualify through the helper. | Preserves the current item-level `is_live` condition and adds lifecycle safety. |

There are no other intended behavioral differences. In particular, the helper
retains the UUID/text cast required by Production and does not alter owner
policies or public policy roles.

## Required preflight output

Before any explicit Production go, run the read-only query in
[`production-forward-tailor-claims-preflight.sql`](production-forward-tailor-claims-preflight.sql)
and attach its definitions to the release record. Stop if policy names,
predicates, helper definition, or the `authenticator` pre-request setting differ
from this capture.
