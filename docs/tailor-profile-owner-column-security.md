# Tailor profile owner-column repair (Dev)

## Scope

`tailor_profiles` is a public catalogue table. Before this repair, its
authenticated role also had column-level `SELECT` grants for private trust and
payout data. A signed-in non-owner could therefore request private columns from
an otherwise public live tailor row.

This branch removes browser reads of private owner state and keeps them behind
the `auth.uid()`-scoped `get_my_tailor_account_profile()` RPC. It does not
return document/selfie URLs, verification handoff identifiers, or provider
recipient/account identifiers.

## Dev evidence

- Before the repair, a signed-in non-owner's zero-row projection of protected
  columns returned HTTP 200. No tailor values were read.
- After `20261117194812`, the same Dev regression check received access denial
  for all 22 protected columns, while the owner RPC returned HTTP 200.
- `20261117202000` moves dependent portfolio and shop RLS checks into
  boolean-only security-definer predicates. This fixes the Dev tailor profile
  without restoring private column grants.
- The authenticated Dev tailor profile and payout views load successfully after
  the policy repair. The verified policy definitions now use only
  `is_my_tailor_profile(...)` or `is_public_tailor_profile(...)` for those
  dependent checks.
- Dev reports zero authenticated column-level `SELECT` grants across all 22
  protected fields. The automated Dev check also confirms all 22 projections are
  denied, the safe public projection returns HTTP 200, and the owner RPC returns
  HTTP 200.
- The authenticated web profile and payout checks passed. iOS verification is
  deferred because the Mac was locked, not because of an authentication challenge.

## Dev migrations

- `20261117194812_restrict_tailor_profile_owner_columns`
- `20261117202000_harden_tailor_profile_policy_helpers`

Both are recorded in Dev migration history. Production was not queried or
changed by this repair.

## Release dependency

This branch starts from `main` before PR #218 is merged. Rebase it after #218
lands, then re-run the Dev migration and regression checks before promotion.

## Check notes

- Focused contract, mobile typecheck, and web lint pass (web lint has its
  existing warnings only).
- The local full launch-contract command cannot be treated as a release result:
  this worktree has Node 18 while the repository requires Node 22, and the
  worker-source encoding check fails under that unsupported runtime.
