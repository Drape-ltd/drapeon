# Phase 4 S1 Production migration review draft

Status: **prepare only**. No Production migration, route, Edge or provider action is authorized by this document. Source is the five exact, already-merged migrations below. They must be reviewed together with their rollback files and applied individually, in order, only after a fresh founder approval.

| Version | Source effect | Production baseline, read only on 2026-11-25 |
| --- | --- | --- |
| `20261102180324` | Add tax-cache `address_key`, blank-key check, and address/postcode indexes; temporarily remove old primary key. | `address_key` absent; tax cache has 0 rows. |
| `20261102182653` | Delete legacy NULL-address tax-cache rows, require non-NULL address key, replace unique index with `(country_code,address_key)` primary key. | Tax cache has 0 rows, so the DELETE would currently affect 0 rows. **Stop if that count changes.** |
| `20261102200000` | Add guarded `provider_attempt_number` to fabric candidates. | Column absent; `order_fabric_candidates.id` is UUID. |
| `20261102204053` | Add source-transaction binding to payout provider operations, tighten identity trigger, add service-only binding RPC. | Column absent; `payout_provider_operations.id` is UUID. |
| `20261102210052` | Replace fabric payout uniqueness index and add service-only definite-rejection reconciliation RPC. | `payouts.id` and `fabric_candidate_id` are UUID. |

All five source versions are absent from Production migration history. A full dependency/ACL comparison and Dev idempotence proof are still required. `20261102182653` is a **data-deleting historical migration**; the schema/data separation rule is satisfied only if fresh preflight again proves zero rows. If any row exists, stop and make a separate reviewed data disposition plan instead of applying this source version.

### Isolated compile rehearsal — 2026-11-26

The existing `drape-prod-schema-rehearsal` local Postgres container had 217 public tables, zero tax-cache rows, and none of the three S1 columns listed above. Its source schema has no `supabase_migrations.schema_migrations` table, so this rehearsal checks SQL compilation and schema dependencies, **not** ledger behavior. The five unchanged source files ran in order inside one `BEGIN`/`ROLLBACK` transaction with `ON_ERROR_STOP` enabled. All five reached `S1_ROLLBACK_COMPLETE` without an error; a follow-up catalog query found zero of the added columns, confirming the rollback. The rehearsal did not test reapplication or prove every Production ACL/dependency matches this container.

Dev read-only catalog checks found all three added columns, both service RPC
signatures and the fabric payout index. Its first two source versions were
already in migration history; the last three had generated apply markers.
Using the supported **Dev-only history repair**, the generated markers
`20261102222854`, `20261102222858`, `20261102223006` were reverted and the
corresponding source versions `20261102200000`, `20261102204053`,
`20261102210052` marked applied, without rerunning SQL. A final read found
exactly the five S1 source versions and none of the three generated markers.
Dev still had zero enabled routes. This validates object presence and ledger
alignment, not equality of any function body later replaced by another Dev
migration.

## Fresh preflight, before each exact version

Run read-only against project `wkfsrunetmgjdtcurmoj`; record the aggregate results and stop on drift:

```sql
select current_database(), current_user;
select version from supabase_migrations.schema_migrations
where version in ('20261102180324','20261102182653','20261102200000',
                  '20261102204053','20261102210052') order by version;
select count(*) as tax_cache_rows from public.tax_rate_cache;
select table_name,column_name,data_type from information_schema.columns
where table_schema='public' and
 ((table_name='tax_rate_cache' and column_name in ('country_code','postal_code','address_key')) or
  (table_name='order_fabric_candidates' and column_name in ('id','provider_attempt_number')) or
  (table_name='payout_provider_operations' and column_name in ('id','provider_source_transaction_id')) or
  (table_name='payouts' and column_name in ('id','fabric_candidate_id')))
order by table_name,column_name;
select c.relname, co.conname, pg_get_constraintdef(co.oid) as definition
from pg_constraint co join pg_class c on c.oid=co.conrelid
where c.relname in ('tax_rate_cache','order_fabric_candidates','payout_provider_operations','payouts')
order by c.relname,co.conname;
select tablename,indexname,indexdef from pg_indexes
where schemaname='public' and tablename in ('tax_rate_cache','payouts')
order by tablename,indexname;
select count(*) filter (where status='ENABLED') as enabled_routes from public.payment_routes;
```

Also compare the current function signatures, trigger bindings, RLS and service-role grants for every function/table that the five source files replace or extend. A source version with an existing effect but missing history needs a separate ledger-repair decision; do not rerun it.

## Apply guard and postflight

The release operator must use the exact-version migration workflow, one version per transaction. Before each transaction, verify the Production project ref, the Production-only release marker, the source version still absent, and that the preceding S1 version is recorded. Execute the unchanged source SQL and record its source version in the same transaction. Stop at the first error; never mark a version applied without running its SQL. A broad `db push` is prohibited. This draft intentionally contains **no executable apply command** until the Production-shaped rehearsal and review agree on the safe guard wrapper.

After each version, verify its ledger row and only its intended schema effect. After all five, verify the tax-cache primary key and zero legacy rows; fabric attempt column/check and payout index; binding and reconciliation RPC definitions/EXECUTE grants; identity trigger binding; Advisors; health; queues; and zero enabled payment routes. Do not create a provider transfer or payout as a synthetic postflight.

Rollback preference is a reviewed forward fix. The tax-cache primary-key pair is coupled: if the second version fails after the first, stop checkout promotion and restore a valid primary key through a scoped repair, not a broad rollback. For the payout-guard functions, retain the exact previous definitions before apply so a forward repair can restore them if contract checks fail. No source migration file is edited after a Production apply.
