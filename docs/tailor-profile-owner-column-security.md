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

1. **Batch 1 — policy role, owner RPC, and safe B0a:** promote the guarded
   `20261117170000` replacement, then the baseline grant repairs,
   `20261117194812`, and the new forward migration `20261117194900`. Together
   they preserve any existing shared-order predicate while narrowing its target
   role, add the owner RPC, and revoke only `id_selfie_document_url` and
   `id_verification_handoff_id`, neither of which released web or native
   clients read. `20261117171105`, `20261117202000`, `20261117204214`, and the
   later duplicate Dev history marker `20261118022134` remain excluded from
   Production.
2. **Batch 2 — helper then B0b:** promote the production-forward policy-helper
   replacement `20261118014508`, then the new
   `20261118022149_stage_tailor_profile_test_flag_revoke`. The latter revokes
   `is_test_profile` only after portfolio and shop policies evaluate it through
   the security-definer helper. It must never run before that helper.
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

### Production policy baseline — read-only 2026-11-18

Production's current public policies prove why B0b cannot be part of Batch 1:

- `portfolio_items` policy `public: view live portfolio` has a direct
  `EXISTS` lookup of `tailor_profiles` requiring `is_live = true`,
  `is_verified = true`, and `is_test_profile = false`.
- `portfolio_photos` policy `Public views portfolio of live tailors` has the
  same direct `EXISTS` lookup and predicate.
- `seller_items` policy `public reads live seller items` requires the item to
  be live plus the same direct profile predicate.

Those policies run with the visitor's column permissions. Revoking
`is_test_profile` first would therefore turn signed-in public portfolio and
shop reads into permission errors. The B0a document fields do not appear in
any of those predicates.

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
- After the staged Dev replay, the two B0a document fields receive access
  denial in Batch 1. B0b's `is_test_profile` denial follows only after the
  Production-compatible helper is present; the safe public projection and
  owner RPC return HTTP 200.
  The 19 B fields remain explicitly deferred for released-mobile compatibility.
- `20261117202000` moves dependent portfolio and shop RLS checks into
  boolean-only security-definer predicates in Dev. Its Production-forward
  replacement, `20261118014508`, uses Production's existing public condition
  (`is_live`, `is_verified`, not `is_test_profile`) and casts IDs to text so it
  works on both Dev's text IDs and Production's UUID IDs. It never reads
  Dev-only `lifecycle_state`.
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

- `20261117170000_production_shared_order_policy_authenticated`
- `20261117194812_restrict_tailor_profile_owner_columns`
- `20261117194900_stage_tailor_profile_document_and_handoff_revokes`
- `20261117202000_harden_tailor_profile_policy_helpers`
- `20261117204214_stage_tailor_profile_private_column_revokes`
- `20261118014508_phase4_production_tailor_profile_policy_helpers`
- `20261118022134_stage_tailor_profile_document_and_handoff_revokes`
- `20261118022149_stage_tailor_profile_test_flag_revoke`

All eight are recorded in Dev migration history. The new role-only replacement
was applied to Dev after a UUID/text/missing-policy Docker rehearsal, with its
initial generated history marker repaired to the exact source version. It
preserved Dev's text predicate and authenticated policy role. `20261117194812` was first
applied in Dev while it included the broader revoke block; before any
Production use, its source was rewritten into release stage A. That is an
explicit Dev-only exception to the applied-migration immutability rule, made
while the migration was unmerged; future changes must be new forward
migrations. Dev was then restaged to A/B0: the 19 mobile-dependent grants were
restored directly in Dev, B0 was applied, and temporary generated
migration-history markers `20261117200206`, `20261117202413`,
`20261117204653`, and `20261118030335` were reverted in favor of their exact
source versions. This exception and the exact Dev history repair are recorded
in the PR. Production was not queried or changed by this repair.

## Production Batch 1 postflight — 2026-11-18

The separately approved Batch 1 applied only these exact source versions, in
order: `20261117170000`, `20261117190000`, `20261117191500`,
`20261117194812`, and `20261117194900`. Supabase-generated history entries
were normalized to those source versions without re-running any schema SQL.

- The guarded shared-order-policy replacement was a no-op, as expected:
  Production has no policy named `customers: read tailor profile for shared
  orders`.
- `get_my_tailor_account_profile()` exists, is security-definer with a fixed
  search path, permits `authenticated` only, and returned an object for the
  Production QA tailor without recording a profile value.
- Authenticated zero-row projections of `id_selfie_document_url` and
  `id_verification_handoff_id` both failed with `42501` permission denied.
- Signed-out catalogue, public-profile, and ready-made-shop gateway smoke
  requests each returned HTTP 200. The authenticated direct portfolio/shop
  table-access probe also completed without a permission error.
- Security Advisor/health were checked. The pre-existing advisor backlog was
  recorded by category only; this batch added no specific tailor-profile
  warning. Every payment route remains disabled.
- The notification queue currently has no natural post-R1 `SEND_PUSH` event
  from which to record the separate terminal-outcome proof. No test
  notification was manufactured, and the three stale notices remain untouched
  pending authorised Production Ops operators.

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

The original policy-rewrite source `20261117171105` is superseded for
Production: its recreated predicate compares Production's UUID
`orders.customer_id` to text. The scoped forward replacement
`20261117170000` changes only the policy role when that legacy policy exists;
it does not recreate, cast, or otherwise modify its predicate. The live
catalog on 2026-11-18 shows the named legacy policy is currently absent, so
the replacement is deliberately a safe no-op there. That catalog fact must be
rechecked at promotion time and recorded in the postflight.

The accompanying cross-schema audit is recorded in
[`production-id-type-compatibility-audit-2026-11-18.md`](production-id-type-compatibility-audit-2026-11-18.md).
It identifies separate R4 and R5 historical sources that are also unsuitable
for Production replay; those are gates on future forward repairs, not on this
security batch.

The seven explicitly scoped versions below are all absent from the Production
ledger. They must be applied only by exact version, in timestamp order, with a
maximum of five migrations in a batch:

| Batch | Versions | Production effect |
| --- | --- | --- |
| 1 | `20261117170000`, `20261117190000`, `20261117191500`, `20261117194812`, `20261117194900` | Applies the role-only shared-order policy repair when its legacy policy exists; preserves Production's established column-grant baseline (the two grant-repair migrations are no-ops when no table-wide grant or narrow broken state exists); adds the owner-scoped profile RPC; and revokes only `id_selfie_document_url` and `id_verification_handoff_id`. `20261117171105` is superseded and must not be promoted. |
| 2 | `20261118014508`, `20261118022149` | First installs the Production-forward UUID/text-compatible boolean-only helpers and rewrites dependent portfolio/shop RLS to Production's established public-tailor condition. It then revokes `is_test_profile`. No payout or operational-status field is affected. |

Before each batch, verify read-only that all exact versions in that batch are
absent, their prerequisite tables/functions exist, no unexpected
`tailor_profiles` table-wide `SELECT` grant is present, and there are no
enabled payment routes. For Batch 2, the preflight must prove every helper
reference exists with the expected type: `tailor_profiles.id`, `user_id`,
`is_live`, `is_verified`, and `is_test_profile`; `portfolio_items.tailor_profile_id`;
`portfolio_photos.tailor_profile_id`; and `seller_items.tailor_profile_id` and
`is_live`. It must also prove `lifecycle_state` is absent or otherwise unused
by the new helper. If any preflight condition differs, stop rather than
substituting a broad migration command.

### Resolved source mismatch — 2026-11-17

The approved read-only Production catalog preflight found that
`public.tailor_profiles.lifecycle_state` is **absent**. It is introduced by
`20261116120000_tailor_claim_drafts_pr1`, a Development-only migration whose
own header prohibits Production promotion before its feature PR is reviewed.
Stage A's original `is_public_tailor_profile(...)` helper reads that column, so
applying `20261117202000` now would create a helper that errors when its policy
runs.

The new `20261118014508` forward migration replaces that Production behavior
without promoting `20261116120000` or depending on `lifecycle_state`. It has
been applied and behavior-proved in Dev: public eligibility allows a live,
verified, non-test profile; rejects a non-public profile; and the owner helper
allows the matching authenticated owner. Its grants leave the public helper
callable to `anon`/`authenticated` and the owner helper callable only to
`authenticated`.

`20261117202000` remains Dev-only and is intentionally excluded from every
Production batch; do not mark it applied in Production. The full ledger
reconciliation and the forward-only decision are recorded in
`docs/production-migration-ledger-reconciliation-2026-11-17.md`.

### Required postflight checks

After **batch 1**, before batch 2 or any web merge:

- confirm the five exact source versions are recorded and no unrelated
  migration was applied;
- as the Production QA tailor, call `get_my_tailor_account_profile()` and
  verify HTTP 200 without logging returned profile values;
- signed out, request the public catalogue and a public tailor profile and
  verify each returns HTTP 200;
- confirm portfolio and ready-made item public reads still work through the
  existing direct RLS policies;
- as a signed-in non-owner, make zero-row (`limit=0`) projections for
  `id_selfie_document_url` and `id_verification_handoff_id` and verify access
  is denied (HTTP 401/permission denial), without reading any value;
- review Security Advisor findings and database health, recording only finding
  IDs/categories; and
- confirm all payment routes remain disabled.

After **batch 2**, repeat all batch-1 checks and additionally:

- as a signed-in non-owner, make zero-row (`limit=0`) projections for
  `is_test_profile` and verify access is denied (HTTP 401/permission denial),
  without reading any value;
- run the currently released mobile client through the tailor dashboard,
  orders, profile edit, shop, and trust surfaces to prove B0 remains compatible;
- verify the QA tailor owner RPC still returns HTTP 200; and
- confirm portfolio and ready-made item public reads still work through the
  rewritten boolean-only RLS helpers; and
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
