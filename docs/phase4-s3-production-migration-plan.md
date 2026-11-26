# Phase 4 S3 Production migration review draft

Status: **forward repair built in Dev; prepare only for Production**. No Production write, provider call, route change, or approval to apply.

| Version | Source effect | Production read-only baseline, 2026-11-25 |
| --- | --- | --- |
| `20261110042832` | Replace tranche source-payment, claim-identity, work-funding, reservation, and finalization functions to allow accounted non-tailor refunds. | Version absent. Existing function bodies need a semantic diff; this is a replacement, not an additive apply. |
| `20261110130000` | Add reviewed payout-claim retry authorization table, service-only validation guards and reservation RPC. | Version and table absent. |
| `20261110140000` | Add definite payout-rejection reconciliation RPC. | Version and named RPC absent. |
| `20261110150000` | Tighten provider-operation identity guard and add close-unstarted-tranche RPC. | Version and new RPC absent; existing guard must be compared. |
| `20261111120000` | Replace failed-refund journal and tranche source-payment functions. | Version and named failed-refund RPC absent; source-payment function may already have a newer body. |

Production currently has **zero enabled payment routes**. The five ledger versions are absent. Those findings do not prove that replacing functions is safe: later migrations may have changed the same bodies. S3 remains held until a Production-shaped local compile, prerequisite/type comparison, and source-to-live function diff identify a forward-only release. In particular, do not replay an old `CREATE OR REPLACE FUNCTION` over a newer live body merely to fill the ledger.

### Isolated compile rehearsal — 2026-11-26

The five source definitions compiled in order inside a rollback-only local transaction after adding the exact PAY-003 schema already present in Production to the older rehearsal baseline. The historical `20261110140000` file lacks a final SQL semicolon; a separator was added **between files in the local harness only**, without editing source. All five reached rollback completion and the transaction left no schema changes. This checks SQL compilation, not equivalence with the current Production function bodies or idempotent replay. The replacement-function semantic diff remains a release blocker.

Dev history records all five exact S3 source versions. A read-only Dev catalog
check confirmed the reviewed retry table and close-unstarted-tranche RPC are
present, with zero enabled payment routes. These checks establish Dev object
presence; they do not prove the current function bodies still match each
historical source after later migrations.

**Confirmed source ordering conflict:** repository scan found the already-live
PAY-003/C2 forward set replaces `public.guard_payout_forward_status` in
`20261118223234` and `20261118223241`, after historical S3
`20261110130000`. It also replaces
`public.reconcile_failed_order_payment_refund` in `20261118223008` and
`20261118223018`, after historical S3 `20261111120000`. Replaying either S3
source file would restore an older body over the Production money guards.
Therefore these historical versions must **not** be executed as the S3 release
batch. Separate the missing additive table/RPC effects into a new forward
repair, preserve the current PAY-003/C2 bodies, and decide any history-only
markers only after exact live-definition equivalence is proven. The successful
local source compile is not approval to replay these files.

### Production name-only catalog audit — 2026-11-26

A read-only `pg_proc` check across `public` and `payment_internal` found the
following source S3 functions **absent** in Production:
`payment_internal.tranche_source_payment_available(uuid,uuid,uuid)`,
`validate_payout_claim_retry_authorization()`,
`prevent_payout_claim_retry_authorization_rewrite()`,
`apply_reviewed_claimed_payout_retry(uuid,text,text)`,
`close_unstarted_reviewed_claimed_retry(uuid)`,
`load_reviewed_claimed_tranche_retry(uuid,uuid,text,text,text)`,
`reconcile_definite_payout_rejection(uuid,uuid,jsonb)`, and
`close_unstarted_settlement_tranche_payout(uuid,text,text)`. The named
`payout_claim_retry_authorizations` table is absent. The other S3 function
names exist, including the newer PAY-003/C2 guards, but name presence does
not establish body or grant equivalence. `payout_provider_operations_check`
exists, but the `reviewed_retry_id` column is absent. Ten
provider-operation triggers are enabled; their definitions
still need comparison. The Production route count remained zero ENABLED.

This supports a new forward migration for the absent table and callable
objects. It does **not** authorize copying source S3 files wholesale: their
`CREATE OR REPLACE FUNCTION` statements would overwrite live functions, and
the source retry migration also drops and recreates the provider-operations
CHECK constraint. The forward unit needs a line-by-line dependency and
privilege review before any Production batch is proposed.

### Current constraint and ACL prerequisite — 2026-11-26

Read-only catalog comparison confirmed that Production's
`payout_provider_operations_check` allows operation 1 without a reviewed
correction, or a later operation with one reviewed correction and a Money Desk
request. Dev's current check additionally accepts a reviewed retry, with
exactly one of `reviewed_correction_id` and `reviewed_retry_id`. The forward
repair must add the absent retry column/FK, then replace the check using a
`NOT VALID` constraint followed by `VALIDATE CONSTRAINT`; it must preserve
the existing correction branch. The separate default-ACL repair
`20261126080246` must precede S3. New retry-table and function ACLs must
explicitly revoke `PUBLIC`, `anon` and `authenticated`; the per-batch
`aclexplode` post-check must find zero client grants or client-executable new
functions. Existing PAY-003/C2 function bodies must not be replaced by the
historical S3 text.

The eight absent Dev functions currently total about 53 KB of definitions.
Copy their **current** definitions from merged main/Dev only after comparing
every ID comparison with Production's UUID/text column types; the historical
source is not an acceptable substitute. No historical S3 version will be
marked applied when this forward repair runs.

**Dev rehearsal finding, 2026-11-26:** A candidate carrying those eight
current Dev definitions applied as Dev version `20261126082447`, and its
rolled-back reapply and ACL checks passed (eight service-only functions, three
enabled table guards, zero client grants, zero enabled routes). A disposable
Production-shaped schema also compiled the candidate with PAY-003/C2 in a
rolled-back transaction. Further type comparison found a runtime blocker:
Production `order_payments.order_id` and `payouts.id` are UUID, while Dev uses
text; the copied `tranche_source_payment_available` and retry functions
compare these fields to text without a Production-safe cast. Compilation does
not execute the relevant PL/pgSQL paths. **Do not promote `20261126082447`**
or describe this as a Production-ready repair. Keep it Dev-only and build a
new Production-forward version with native UUID comparisons and focused
runtime tests. The candidate must not be included in any Production batch.

### Forward-only replacement built on 2026-11-26

The Production proposal is exactly two new versions, in order:

| Version | Effect | Dev and local proof |
| --- | --- | --- |
| `20261126173651` | Add the retry authorization table, `reviewed_retry_id` FK, revised provider-operation CHECK, two table guards and eight service-only functions. Add the CHECK `NOT VALID`, validate it, then replace the old check in one transaction. | Applied once in Dev; local Production-shaped apply/reapply and runtime calls passed. |
| `20261126174309` | Merge the reviewed-retry branch into the existing payout status guard, preserve S1 source binding while adding retry-ID immutability, and add failed-refund journal reversal while retaining PAY-003/C2 evidence and aggregate checks. | Applied once in Dev; local Production-shaped apply/reapply and guard/runtime calls passed. |

**Post-S1 read-only Production baseline, 2026-11-26:** S1 is applied; this forward repair must be reviewed against the S1 body, not the earlier identity guard. `prevent_payout_provider_operation_identity_change()` now hashes to `30599cdbccc3b744d0107096d9e979ce`. The first S3 version also replaces S1's `reconcile_definite_payout_rejection(uuid,uuid,jsonb)`, currently hash `d93ddeadeaf1ff155f9a4a2460abdbb8`. The remaining merged-function baselines are `guard_payout_forward_status()` = `6c8a0a67e665cee6d348066422458adb` and `reconcile_failed_order_payment_refund()` = `638e9bc40c35b233202998fa819257c6`. Re-hash and compare full definitions immediately before any apply; stop on any change or lost S1/PAY-003/C2 behavior. S2 must be applied and checked first. Production routes remain disabled.

**Fresh read-only Production preflight after S2 merge `f932fb88`, 2026-11-26:** #343, all five S1 versions and all five S2 versions are each recorded once; S3 forward `20261126173651` and `20261126174309` are absent. The four replacement-function hashes above remain unchanged. `payout_provider_operations_check` is still the pre-retry expression: operation 1 has no reviewed correction or Money Desk request, and later operations require both (definition MD5 `d638db24632d168128967aeb8e2f57e0`). The retry table and `reviewed_retry_id` column are absent. Seven truly new function names are absent: `payment_internal.tranche_source_payment_available`, `apply_reviewed_claimed_payout_retry`, `close_unstarted_reviewed_claimed_retry`, `close_unstarted_settlement_tranche_payout`, `load_reviewed_claimed_tranche_retry`, `prevent_payout_claim_retry_authorization_rewrite` and `validate_payout_claim_retry_authorization`. The eighth function touched by the first version, `reconcile_definite_payout_rejection`, already exists from S1 and is replaced; it must not be counted as absent. There are zero payout claims, provider operations, provider refund rows and enabled routes. Repeat this preflight and full definition comparison at apply time; this read does not authorize Production apply.

The Dev-only candidate `20261126082447` remains recorded in Dev, with its
exact source archived outside `supabase/migrations`. It is not a Production
version. None of the five historical S3 versions will be replayed or marked
applied in Production. Both new versions have forward-only rollback refusals.

The focused PostgreSQL 17 harness uses Production UUID column types for
orders, payment order IDs, payouts, payout order IDs and disputes, with text
settlement/claim order IDs. It applies and reapplies both forward versions,
invokes all eight additive functions, fires both retry-table guards, and
exercises the three merged functions. A synthetic payment reaches the
UUID-to-text settlement comparison. The suite also checks normal payout
forward status, provider identity immutability, refund-evidence rejection,
the retry CHECK and absence of client EXECUTE. This is focused negative and
structural proof; a full reviewed retry and failed-refund reversal remain
Dev workflow proofs before live payout enablement.

A separate local Production-shaped database with PAY-003/C2 compiled both
versions and ran the six callable functions on nonexistent synthetic IDs
inside one rolled-back transaction. Dev postflight found both new versions
recorded once, eight additive functions, zero client EXECUTE on them or the
three merged functions, both retry guards enabled, the retry CHECK present
and zero enabled routes. Read-only Production counts found zero payout claims,
provider operations and refund claims, both new versions absent and zero
enabled routes.

## Read-only preflight to finish before review

Confirm the Production project ref `wkfsrunetmgjdtcurmoj` and environment guard; the five versions absent; UUID/text types for orders, payouts, payment and claim IDs; row counts of payout/refund claims and provider operations; current definitions and EXECUTE grants of every replaced function; absent retry authorization table, indexes, guards and new RPCs; and zero enabled routes. Compare each `pg_get_functiondef` and `pg_get_triggerdef` to source and later merged migrations without publishing customer rows or function secrets.

## Proposed release and postflight

The S3 Production batch is two exact forward versions, only after #343, S1
and S2 are verified in Production. Recheck the hashes and semantic bodies of
the three replaced functions immediately before apply; stop if any differ
from the reviewed baseline. Confirm the retry table, column, guards and eight
additive names are absent, the existing provider-operation CHECK has its
pre-retry expression and zero routes are enabled. Rehearse the final source
in a Production-shaped disposable database and seek separate founder
approval. Apply each approved version in its own transaction with the
project guard and history row, stopping at the first error. Never use broad
`db push` or history-only markers for absent behavior.

After a separately approved release, check exact ledger rows, table RLS and grants, unique constraints, enabled guard triggers, function signatures/search paths/EXECUTE grants, payout/refund claim counts, Advisors, job failure counts, and zero enabled routes. On a mismatch, retain the previous definitions and propose a reviewed forward fix. Never retry a provider payout or refund as a rollback.

The per-batch `aclexplode` post-check must return zero `PUBLIC`, `anon` or
`authenticated` grants on the new retry table and its eight new functions.
The three replaced functions must remain non-client-callable. Verify all
eleven names exist before treating an empty ACL result as a pass; the source
explicitly revokes client access and grants only `service_role` execution.

```sql
with acl as (
  select 'table'::text as kind, c.relname::text as object_name,
         a.grantee, a.privilege_type
  from pg_class c cross join lateral
       aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
  where c.oid='public.payout_claim_retry_authorizations'::regclass
  union all
  select 'function',p.proname::text,a.grantee,a.privilege_type
  from pg_proc p cross join lateral
       aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  where p.proname in (
    'tranche_source_payment_available',
    'validate_payout_claim_retry_authorization',
    'prevent_payout_claim_retry_authorization_rewrite',
    'apply_reviewed_claimed_payout_retry',
    'close_unstarted_reviewed_claimed_retry',
    'load_reviewed_claimed_tranche_retry',
    'reconcile_definite_payout_rejection',
    'close_unstarted_settlement_tranche_payout',
    'guard_payout_forward_status',
    'prevent_payout_provider_operation_identity_change',
    'reconcile_failed_order_payment_refund')
)
select kind,object_name,coalesce(grantee::regrole::text,'PUBLIC') as grantee,
       privilege_type
from acl
where grantee=0 or grantee in ('anon'::regrole,'authenticated'::regrole);
```
