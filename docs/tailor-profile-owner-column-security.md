# Tailor profile owner-column repair (Dev)

## Scope

`tailor_profiles` is a public catalogue table. Before this repair, its
authenticated role also had column-level `SELECT` grants for private trust and
payout data. A signed-in non-owner could therefore request private columns from
an otherwise public live tailor row.

This branch introduces the `auth.uid()`-scoped
`get_my_tailor_account_profile()` RPC for browser-account owner reads. It does
not return document/selfie URLs, verification handoff identifiers, or provider
recipient/account identifiers. The revocations are staged so existing mobile
clients never lose a field before their RPC-capable replacement is released.

## Release plan

1. **A — additive:** promote `20261117194812` (the owner RPC) and
   `20261117202000` (the policy predicates), then merge the web code that reads
   the RPC. Neither migration revokes a profile column.
2. **B0 — immediate narrow reduction:** promote
   `20261117204214_stage_tailor_profile_private_column_revokes`. It revokes only
   `id_selfie_document_url`, `id_verification_handoff_id`, and
   `is_test_profile` from `authenticated`. The released native client does not
   project these fields; the remaining client-facing fields are untouched.
3. **Mobile release:** ship and verify the RPC-capable iOS and Android clients.
4. **B — deferred full reduction:** only after a minimum-version/adoption gate
   proves old mobile clients can no longer reach the API, create a *new forward
   migration* to revoke the following remaining fields from `authenticated`:
   `id_verification_metadata`, `id_verification_method`,
   `id_verification_rejected_at`, `id_verification_rejection_reason`,
   `id_verification_status`, `id_verification_submitted_at`, `id_verified_at`,
   `payout_account_change_count`, `payout_account_change_locked_until`,
   `payout_account_last_changed_at`, `payout_account_type`,
   `payout_account_verified`, `payout_account_verified_at`, `payout_currency`,
   `payout_destination_hold_until`, `payout_provider`,
   `payout_reverification_required`, `paystack_recipient_code`, and
   `stripe_connect_account_id`.

The B migration is intentionally not in this PR: adding it to the normal
migration directory would make it eligible for an accidental batch promotion
before the mobile gate is satisfied.

## Server-side access audit

The B0-only field `is_test_profile` remains an internal filter in
`read-gateway`; that function constructs its database client with the service
role and returns an explicit public projection, not the field itself.
`publicFulfillmentOptions` receives that same service-role client from
`read-gateway`. No Ops browser client reads a B0 field. The static contract
asserts the `read-gateway` service-role construction so a later client-key
regression is caught in review.

## Dev evidence

- Before the repair, a signed-in non-owner's zero-row projection of protected
  columns returned HTTP 200. No tailor values were read.
- After the staged Dev replay, B0's three fields receive access denial while
  the safe public projection and owner RPC return HTTP 200. The 19 B fields
  remain explicitly deferred for released-mobile compatibility.
- `20261117202000` moves dependent portfolio and shop RLS checks into
  boolean-only security-definer predicates. This fixes the Dev tailor profile
  without restoring private column grants.
- The authenticated Dev tailor profile and payout views load successfully after
  the policy repair. The verified policy definitions now use only
  `is_my_tailor_profile(...)` or `is_public_tailor_profile(...)` for those
  dependent checks.
- Dev reports zero authenticated column-level `SELECT` grants across B0's three
  fields. The automated Dev check confirms all three projections are denied,
  the safe public projection returns HTTP 200, and the owner RPC returns HTTP
  200.
- Supabase's Security Advisor lists the new RPC under its general
  `authenticated_security_definer_function_executable` advisory. That is
  intentional: account owners need authenticated execution. The RPC has a
  fixed `public, pg_temp` search path, revokes `PUBLIC` and `anon` execution,
  and filters exclusively on `auth.uid()`; it does not return the document,
  handoff, or provider-account identifiers.
- The authenticated web profile and payout checks passed.
- **Fresh Android Dev client — passed:** the verified Dev QA tailor signed in to
  the current branch bundle served from this worktree (not the previously
  installed/stale bundle). Dashboard, Orders, Profile, Profile edit, Shop, and
  Trust & access all loaded after the owner-RPC and B0 changes. No profile or
  payout data was edited. The prior released Dev client was also exercised
  after B0; the same surfaces loaded, which confirms the three B0 revokes do
  not break it.
- **Fresh iOS Dev client — deferred:** the Simulator was blocked by an
  unrelated macOS Calendar location-permission prompt. It was not accepted or
  dismissed during this check. iOS remains a required release gate before the
  later B migration; this is not an application failure.

## Dev migrations

- `20261117194812_restrict_tailor_profile_owner_columns`
- `20261117202000_harden_tailor_profile_policy_helpers`
- `20261117204214_stage_tailor_profile_private_column_revokes`

All three are recorded in Dev migration history. `20261117194812` was first
applied in Dev while it included the broader revoke block; before any
Production use, its source was rewritten into release stage A. That is an
explicit Dev-only exception to the applied-migration immutability rule, made
while the migration was unmerged; future changes must be new forward
migrations. Dev was then restaged to A/B0: the 19 mobile-dependent grants were
restored directly in Dev, B0 was applied, and temporary generated
migration-history markers `20261117200206`, `20261117202413`, and
`20261117204653` were reverted in favor of their exact source versions. This
exception and the exact Dev history repair are recorded in the PR. Production
was not queried or changed by this repair.

## Release dependency

This branch is rebased on `ae1811f8`, the merge of PR #218. Re-run the Dev
migration and regression checks before any promotion.

## Production promotion plan — pending founder approval

### Scope and dry run

On 2026-11-17, a read-only comparison of the local migration directory with
the Production migration ledger found 114 historical source versions that are
not recorded in Production. They are **not** part of this security promotion.
Do not use a broad `supabase db push`, `--include-all`, or a directory-wide
promotion for this release.

The six explicitly scoped versions below are all absent from the Production
ledger. They must be applied only by exact version, in timestamp order, with a
maximum of five migrations in a batch:

| Batch | Versions | Production effect |
| --- | --- | --- |
| 1 | `20261117171105`, `20261117190000`, `20261117191500`, `20261117194812`, `20261117202000` | Restores the public catalogue's authenticated-only shared-order policy; preserves Production's established column-grant baseline (the two grant-repair migrations are no-ops when no table-wide grant or narrow broken state exists); adds the owner-scoped profile RPC; and changes dependent portfolio/shop RLS policies to boolean-only owner/public helpers. No profile-column access is revoked in this batch. |
| 2 | `20261117204214` | B0 only: revokes `authenticated` access to the three released-client-unused columns `id_selfie_document_url`, `id_verification_handoff_id`, and `is_test_profile`. It does not revoke any payout or operational-status field. |

Before each batch, verify read-only that all exact versions in that batch are
absent, their prerequisite tables/functions exist, no unexpected
`tailor_profiles` table-wide `SELECT` grant is present, and there are no
enabled payment routes. If any preflight condition differs, stop rather than
substituting a broad migration command.

### Required postflight checks

After **batch 1**, before any web merge:

- confirm the five exact source versions are recorded and no unrelated
  migration was applied;
- as the Production QA tailor, call `get_my_tailor_account_profile()` and
  verify HTTP 200 without logging returned profile values;
- signed out, request the public catalogue and a public tailor profile and
  verify each returns HTTP 200;
- confirm portfolio and ready-made item public reads still work through the
  rewritten RLS policies;
- review Security Advisor findings and database health, recording only finding
  IDs/categories; and
- confirm all payment routes remain disabled.

After **batch 2**, repeat all batch-1 checks and additionally:

- as a signed-in non-owner, make zero-row (`limit=0`) projections for each B0
  column and verify access is denied (HTTP 401/permission denial), without
  reading any value;
- run the currently released mobile client through the tailor dashboard,
  orders, profile edit, shop, and trust surfaces to prove B0 remains compatible;
- verify the QA tailor owner RPC still returns HTTP 200; and
- recheck Advisors, database health, and the disabled-route invariant.

No web merge, mobile release, stage-B revoke migration, route enablement, or
other Production migration is included in this approval request. iOS must
complete the equivalent tailor-screen pass before the web merge; Android has
already passed both the current branch and released Dev client checks.

## Check notes

- Focused contract, mobile typecheck, and web lint pass (web lint has its
  existing warnings only).
- Android current-branch visual regression passed as recorded above. The mobile
  bundle was started against Dev with the active public project key held only in
  the process environment; no local credential file was created.
- `pnpm launch:contracts` passed locally under Node 22 on 2026-11-17. The
  default shell still selects Node 18, so this command must continue to be
  invoked through the repository's Node 22 runtime for release evidence.
