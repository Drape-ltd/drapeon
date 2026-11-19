# Tailor claim picker and device retest — 2026-11-19

## Scope and environment

- Development only: Supabase project `pqptfuqogvrajozfsqzi`.
- Physical device: founder's iPhone 14 Pro, controlled through iPhone Mirroring.
- Fixture: `Claim picker UX retest 2026-11-19`.
- Invite ID: `e673e2ec-ee6c-423b-b191-0a000d3d6ec2`.
- The invite token, message link, email, and any credentials are omitted.
- No Production database, function, or release action was performed.

## Picker result

- The pickup-country picker now displays its options on the physical iPhone.
- Nigeria was found and selected; the app showed the phone country as `NG` with `+234`.
- The list is usable, though long to browse; a searchable country picker would improve the experience.

## Claim result

- Apple sign-in completed on the device and the claim submission returned to tailor setup.
- The development fixture used the approved synthetic phone and Lagos address with no postcode. The development phone verification bypass means this does not prove SMS delivery.
- Read-only Development database check for the fixture returned:
  - `lifecycle_state = CLAIMED_AWAITING_EMAIL`
  - `profile_completed = false`
  - `avatar_url` is unset
  - pickup country is `NG`
  - pickup postcode is SQL `NULL`
- The app showed the generic 1/4 Identity setup screen instead of the claim-specific phone-verification screen. It therefore has not reached LIVE.
- The profile photo is unset, and generic setup requires one. Do not use a personal photo for this fixture.

## Cause found and local fix

`apps/mobile/app/(tailor)/profile/setup.tsx` read `tailor_profiles.lifecycle_state` directly in both the initial claim-state check and the finalize preflight. In Development, `authenticated` has no `SELECT` privilege on that column. The owner-scoped `get_my_tailor_profile_guard()` RPC already exposes this state safely. Both reads now use `fetchOwnTailorProfileGuard()` instead.

- Mobile typecheck passed after this code change.
- The `tailor-claim-ui-contract` test passes with a regression assertion for both owner-scoped lifecycle reads.
- The physical app has not yet loaded this local change. Metro is now running from this worktree on port 8092 with Node 22 and Watchman; the other worktree's port 8081 process was left untouched. iPhone Mirroring is currently paused because the device is in use during Apple authentication.

## Remaining proof

- Verify the claim-specific phone screen and run Development finalization after the fixed bundle loads.
- Confirm the profile/media reach LIVE, Explore, and Ops.
- Run the separate email claim path and required cross-role checks.
- Capture privacy-safe screenshots only; no screenshot containing a claim token, address, email, or credential should be posted.
