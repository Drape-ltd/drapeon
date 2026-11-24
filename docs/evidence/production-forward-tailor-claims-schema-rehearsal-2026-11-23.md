# Production-forward tailor drafts + claims: schema rehearsal

Date: 2026-11-23

## Scope and safety

- **Production was read only.** A schema-only dump of `public` was taken from
  `wkfsrunetmgjdtcurmoj` using the session pooler. It contains no rows.
- Dump SHA-256: `96d8412c340eeb36a3dea03ef7017dab4ce91702571375a041ae4c8a051e0811`.
- The dump was restored into a disposable local Supabase Postgres 17 container.
  Local-only compatibility stubs were used for non-`public` schemas omitted by
  a schema-only `public` dump; none are in this repository or release batch.
- No Production SQL, migration-history repair, Edge deployment, or setting
  change was performed.

## Forward batch rehearsal

The restored Production-shaped schema accepted, in order, the one reviewed
Production-forward batch:

1. `20261123174412_prod_forward_tailor_claim_draft_foundation.sql`
2. `20261123174413_prod_forward_tailor_claim_email_bootstrap.sql`
3. `20261123174414_prod_forward_tailor_claim_transition_finalize.sql`
4. `20261123174415_prod_forward_tailor_claim_security_boundary.sql`
5. `20261123174416_prod_forward_tailor_draft_purge_schedule.sql`

The rehearsal caught an internal `CREATE OR REPLACE FUNCTION` parameter-name
conflict in migration 1 before release. Both definitions of
`reorder_tailor_draft_media(uuid, uuid[])` now use `p_asset_ids`; the contract
test asserts that invariant.

The local post-apply catalog confirmed all nine claim/draft tables, their RLS
flags, both expected triggers, the PostgREST pre-request hook, the restrictive
Realtime policy, and cron job `purge-tailor-drafts` at `17 * * * *`.

## Development equivalence

Development is `pqptfuqogvrajozfsqzi`. Two Development-only forward cleanup
migrations were applied and recorded under the versions assigned by the
Development migration runner:

- `20261124034830_wrap_staff_draft_rls_identity_check.sql` — every current
  public RLS table and `realtime.messages` has the initPlan-wrapped restrictive
  `deny_staff_draft_claim_session` policy. Catalog coverage gaps: **0**.
- `20261124035736_remove_retired_tailor_claim_provider_bootstrap_rpc.sql` —
  removed the superseded service-role RPC
  `prepare_tailor_claim_provider_bootstrap_session(text, uuid)`. The shipped
  action uses `prepare_tailor_claim_provider_proof`; source search found no
  call to the retired RPC.

Normalized comparison of the claim/draft tables, columns, constraints, indexes,
RLS flags, policies, triggers, active claim RPC signatures, and role grants is
empty except for the documented Production shape:

- Production `tailor_profiles.id` and
  `tailor_claim_invites.tailor_profile_id` are `uuid`; Development's legacy
  profile ID is `text`. Production-forward functions cast only at the public
  text boundary (`resolve_tailor_claim_preview` / `is_public_tailor_profile`).
- The Production-forward public-profile predicate additionally requires
  `lifecycle_state = 'LIVE'`. This is intentional: it preserves Production's
  existing `is_live`, `is_verified`, and non-test checks while preventing a
  claim draft from being public.

No other behavioral policy, trigger, grant, or active claim-RPC difference
remains.

## Read-only Production preflight

Immediately after the rehearsal, the Production catalog was queried read-only:

- all five `20261123174412`–`20261123174416` forward versions are absent from
  `supabase_migrations.schema_migrations`;
- `tailor_profiles.id` is `uuid` and `lifecycle_state` is absent;
- `pg_cron` and `util.invoke_edge_function(text,jsonb,integer)` exist; and
- none of the five forward claim/draft tables exists yet.

This confirms the batch targets the expected starting state. It is preflight
evidence only, not authorization to apply it.

## Proofs

Run with Node `v22.23.5` after the rehearsal:

- `node scripts/production-forward-tailor-claims-contract.test.mjs`
- `bash scripts/test-tailor-claim-email-postgres.sh`
- `bash scripts/test-tailor-claim-email-consumed-postgres.sh`
- `bash scripts/test-tailor-claim-phone-guard-postgres.sh`
- `node scripts/check-staff-draft-rls-policy.mjs`
- `pnpm launch:contracts`
- `git diff --check`

All passed. The Production batch remains pending founder approval and must use
the per-file, single-transaction commands in the release pack.
