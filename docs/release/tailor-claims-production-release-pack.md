# Tailor claims production release pack

Planning only — this document does not authorize a Production change. The owner must
approve each stage independently. Run every command from a clean checkout whose HEAD
is the reviewed candidate SHA; never use a developer worktree or an unmerged branch
as a release source.

This pack is linked from PR #232. It supersedes the short release checklist in
`docs/evidence/pr232-production-ga-checklist-20261121.md` with exact migration
batches and preflight commands.

## Non-negotiable release controls

- Target: Production Supabase project `wkfsrunetmgjdtcurmoj`. Confirm the project
  after linking and before every write.
- The production migration history and the drift ledger must agree on the pending
  versions. Do not use `--include-all`, rename an applied file, or bulk-repair
  history to make a command pass.
- A batch may contain no more than five migrations. Stop if the dry run contains a
  version outside the stage below.
- Deploy the matching Edge function before its migration if the migration schedules
  or invokes it. No broad `functions:deploy-all` release is authorized.
- Record command output, deployed function version, database health, scheduler/queue
  health, and the correlation IDs for the post-stage checks.

## Common preflight for every migration stage

Use the release checkout only:

```sh
git fetch origin main
git rev-parse HEAD
git rev-parse origin/main
pnpm supabase:link:prod
supabase migration list --linked
supabase db push --dry-run --linked
```

The first two SHAs must be the reviewed release SHA and current `origin/main` when
the release branch is cut. The migration-list and dry-run outputs must contain only
the expected stage versions. These are inspection commands until an owner explicitly
approves the stage; do not run `supabase db push --linked` as part of preflight.

## Migration stages

### Stage 1 — claim email proof foundation (5/5)

```text
20261117212042
20261117212332
20261117212502
20261117212930
20261117213656
```

Apply only after the common preflight shows exactly those five versions. Verify the
email-code, delivery-outcome, collision and audit tables/RPCs; run the existing
claim-email Postgres proof against Production-safe fixture controls only after
approval.

### Stage 2 — inert bootstrap boundary (5/5)

```text
20261117225500
20261118015235
20261118021045
20261118023943
20261118034153
```

This stage installs `db_pre_request`, ahead of every PostgREST request. Immediately
prove normal anonymous, customer, tailor and service-role traffic after the stage,
then rerun the `STAFF_DRAFT` denial suite. Keep this rollback command in the
operator console before applying:

```sql
alter role authenticator reset pgrst.db_pre_request;
notify pgrst, 'reload config';
```

### Stage 3 — claim/finalize receipts (5/5)

```text
20261118190130
20261118190140
20261118190334
20261118194515
20261118203934
```

Verify claim and finalize receipt policies, idempotent replay, interrupted-handover
recovery, and audit persistence. Do not expose the feature or create a Production
claim fixture yet.

### Stage 4 — claim UX and phone guard (4/5)

```text
20261118212546
20261118220734
20261119010000
20261119044734
```

Verify the pre-auth phone uniqueness guard, lifecycle-aware route guard, optional
Nigeria/Ghana postcode behavior, and consumed email-code transition. This stage has
one unused migration slot; do not fill it opportunistically.

## Edge function release units

Before any claim is exposed, deploy only the reviewed versions of:

1. `tailor-claim-action`
2. `account-profile-action`
3. `purge-tailor-drafts` only when its scheduler/release stage is also approved

Use the scoped production deploy wrapper for each named function, record the exact
deployed version, and verify its target project before continuing. The claim feature
flag remains off until all four migration stages, the required functions, and the
phone rollout checks below have passed.

## Phone OTP and Termii rollout

Production currently must be treated as bypass until rechecked: an absent
`PHONE_OTP_MODE` selects bypass, and a configured provider alone is not proof of
delivery. `dev_capture` is hard-guarded for Development and must never be selected
in Production.

1. Termii first: approve the Drapeon sender and Nigerian OTP/DND route, then prove
   one real Nigerian-network delivery and recorded terminal provider outcome.
2. Confirm Production has the reviewed Termii secret names/configuration:
   `SMS_PROVIDER=termii`, `TERMII_API_KEY`, `TERMII_SENDER_ID`,
   `TERMII_API_BASE_URL`, and the reviewed channel/message settings. Do not put
   values in a release log.
3. Separately approve and set `PHONE_OTP_MODE=enforced`. Do not bulk-mark
   bypass-era phone numbers verified: `phone_verified_at` must remain evidence of
   real ownership. A changed phone clears verification.
4. Regress anonymous, existing customer, existing tailor, freshly claimed tailor and
   service-role requests. Check normal signup/onboarding, phone edits, the requested
   hook boundary, one real OTP, and that the timestamp belongs to the verified number.
5. Only then enable the claims feature flag and perform the separately approved GA
   fixture: email and Apple claim, real SMS, FINALIZE, LIVE, Explore, Ops and
   notification outcomes.

## Store build 1.0.4

1. Merge reviewed #216, then #232, and confirm the clean checkout HEAD equals the
   resulting `origin/main` SHA.
2. Run `pnpm launch:contracts`, mobile typecheck, and the platform-specific release
   checks from that clean checkout.
3. Create fresh iOS and Android **1.0.4** release artifacts; do not use a Metro reload,
   an OTA update, or an artifact built from a PR branch as release proof.
4. Retain the exact iOS build number, Android AAB, native symbols and Android
   `mapping.txt` together. Upload the build-matched mapping to Play and the crash
   provider if shrinking is enabled.
5. Distribute the reviewed store builds, then verify a fresh install opens the claim
   deep link and the post-live payout hand-off. The release is not GA until a store
   client at 1.0.4 or later passes the approved Production claim fixture.

## Rollback and stop conditions

Stop at the first unexpected migration, function, provider, request-hook, queue,
or client regression. Do not silently revert a migration; record the failure and
roll forward with a reviewed corrective migration. Keep the request-hook rollback
above available for Stage 2. If phone enforcement misbehaves, restore the previous
approved mode only after preserving evidence; never weaken FINALIZE's verified-phone
gate as a workaround.
