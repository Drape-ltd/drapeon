# Production-forward tailor drafts + claims release pack

**Status:** draft only. No Production migration, Edge-function deployment,
secret change, Ops flag change, or client rollout is authorized by this file.

**Base:** `49e5114b701534b44d10c652de2eeba0dec76b5e` (the merge of #216).

## Why this is a new forward batch

Production does not contain the Development-only draft/claim migration history.
The ordinary linked `supabase db push --dry-run` correctly stops before making
any change because the repository also contains older, unrelated source
versions that precede Production's current migration ledger. Do **not** use
`--include-all` or replay that history.

This PR instead adds one five-migration batch, in source order:

1. `20261123174412_prod_forward_tailor_claim_draft_foundation`
2. `20261123174413_prod_forward_tailor_claim_email_bootstrap`
3. `20261123174414_prod_forward_tailor_claim_transition_finalize`
4. `20261123174415_prod_forward_tailor_claim_security_boundary`
5. `20261123174416_prod_forward_tailor_draft_purge_schedule`

They build the final state from Production's current UUID
`tailor_profiles.id` model: lifecycle state; private draft media; hashed
invites; email paths/codes/jobs; bootstrap sessions; claim/finalize receipts;
claim, finalize, recovery and route-guard RPCs; terminal provider cleanup;
NG/GH optional postcode handling; and the private-media purge schedule.

The security-boundary migration uses the live `pg_class`/`pg_namespace`
catalog to stamp `deny_staff_draft_claim_session` on **every** current
RLS-enabled `public` table, then asserts none are missing. Each policy calls
the `SECURITY DEFINER` identity helper through `not (select
public.is_staff_draft_identity())`, so Postgres evaluates it once per
statement rather than once per scanned row. It also keeps the
PostgREST pre-request hook and the separate Realtime policy. This is a second
layer: normal RLS remains the first line of table-level enforcement.

## Required release rehearsal

Before founder approval, run this exact sequence against a **local** Postgres
restore made from a schema-only Production dump (no data). The CLI direct-host
dump path is IPv6-only in this environment. Run the following **locally in the
founder's terminal** to use Production's IPv4 session pooler. It prompts for
the password without printing or persisting it; do not paste a password into
chat, a PR, or a shell history.

```bash
read -rs 'PGPASSWORD?Production database password (hidden input): ' PGPASSWORD; echo
export PGPASSWORD
pg_dump --schema-only --schema=public --no-owner --no-privileges --dbname='postgresql://postgres.wkfsrunetmgjdtcurmoj@aws-0-us-east-2.pooler.supabase.com:5432/postgres?sslmode=require' --file=/private/tmp/drape-production-public-schema.sql
unset PGPASSWORD
```

Restore that dump to a disposable local Postgres database, then apply the five
exact migrations in ascending version order. The resulting claim/draft-object
diff against Development must be empty after normalization for ownership and
the documented UUID/text profile-ID difference. Attach that empty diff to
`docs/evidence/` before requesting the Production go.

Then diff, normalized for ownership and the known UUID/text ID representation,
against the Development schema. The comparison must include only claim/draft
tables, columns, constraints, indexes, functions, grants, RLS policies and
triggers. The allowed differences are:

- `tailor_profiles.id` is UUID in Production and legacy text in Development;
- the deployed Production public-profile helper has UUID/text casts and the
  established Production public-profile predicate.

Any other diff is a stop condition. Run both existing proofs after the restore:

```bash
bash scripts/test-tailor-claim-email-postgres.sh
bash scripts/test-tailor-claim-email-consumed-postgres.sh
```

The schema dump command is currently blocked locally by the Supabase CLI's
`pg_dump` container DNS resolution of `db.wkfsrunetmgjdtcurmoj.supabase.co`.
It has not read or changed Production. The connector was used only for
read-only catalog checks, which confirmed UUID profile IDs and the current
public-profile helper/policy shape. This release cannot be approved until a
schema-only dump and the empty-equivalence result are attached.

## Production dry run (read-only)

At promotion time, first record the Production migration ledger and prove all
five exact forward versions are absent. The normal linked dry-run is expected
to report the pre-existing historical drift; record its output as evidence but
do not add `--include-all`. The scoped preflight must additionally prove:

- `tailor_profiles.id` is UUID and `tailor_profiles.lifecycle_state` is absent;
- `public.users`, `tailor_pickup_details`, `media_assets`, `audit_logs`,
  `portfolio_*`, `seller_items`, `ops_workforce_principals`, `storage.buckets`,
  and `util.invoke_edge_function(text,jsonb,integer)` exist in the expected
  shape;
- no draft/claim forward table already exists;
- `pg_cron` is available; and
- the Production public-profile helper can be replaced with the lifecycle-safe
  UUID/text-cast definition.

Stop on any deviation. This is a dry run only; no `db push`, SQL DDL, migration
repair, function deployment, secret update, or flag update is authorized.

## Exact apply commands — hold until a founder says go

These are deliberately individual `psql --single-transaction` applications,
not `supabase db push`. Run each line only after the previous file succeeded;
stop at the first error. `DRAPE_PRODUCTION_SESSION_POOLER_URL` is a locally-set
secret connection URL for the same IPv4 pooler above and must never be echoed.

```bash
for migration in 20261123174412_prod_forward_tailor_claim_draft_foundation.sql 20261123174413_prod_forward_tailor_claim_email_bootstrap.sql 20261123174414_prod_forward_tailor_claim_transition_finalize.sql 20261123174415_prod_forward_tailor_claim_security_boundary.sql 20261123174416_prod_forward_tailor_draft_purge_schedule.sql; do
  psql "$DRAPE_PRODUCTION_SESSION_POOLER_URL" --single-transaction -v ON_ERROR_STOP=1 --file "supabase/migrations/$migration" || exit $?
  supabase migration repair --status applied "${migration:0:14}" --linked || exit $?
done
```

Before that loop, link the CLI to `wkfsrunetmgjdtcurmoj` and independently
confirm its target. The repair records only the exact file that just applied.

### Development record-only step

The five `prod_forward` files must **not** execute in Development: Development
already has the iterative claim schema. Only after the schema-equivalence
check is empty, link the CLI to `pqptfuqogvrajozfsqzi`, verify the target, and
record the five source versions as applied:

```bash
for version in 20261123174412 20261123174413 20261123174414 20261123174415 20261123174416; do
  supabase migration repair --status applied "$version" --linked || exit $?
done
```

This record-only step changes Development's migration ledger, not its schema.

## Approved sequencing after an explicit go

1. Apply the one five-migration batch in a separately approved Production
   session, stopping on its first error. Record the exact history versions.
2. Deploy and record each Edge-function version individually, in this order:
   `tailor-draft-action`, `tailor-claim-action`, `purge-tailor-drafts`, then
   `account-profile-action`.
3. In a separate reviewed Ops deploy, set `DRAPE_TAILOR_CLAIMS_ENABLED=1`.
   Confirm the Draft tailors route appears only after that deploy.
4. Do **not** enable claim GA yet. First obtain Termii sender approval and a
   real Nigerian delivery proof. Then perform a reviewed
   `PHONE_OTP_MODE=enforced` rollout, regression-test existing customers and
   tailors, and only then enable claim traffic.
5. Build and submit the 1.0.4 iOS and Android clients only after the database,
   functions, flag and phone provider sequence is verified.

Rollback is roll-forward only for schema. If a function deployment or flag
deployment fails, leave claims off, stop scheduling/traffic as appropriate,
and correct with a new reviewed forward change. Never remove a Production
migration record or replay Development history.
