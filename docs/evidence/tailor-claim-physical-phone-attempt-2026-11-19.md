# Physical iPhone claim attempt — 2026-11-19

## Scope

- Environment: Development Supabase project `pqptfuqogvrajozfsqzi` only.
- App code loaded for the device attempt: PR #232 head `9ba8affd`.
- Disposable fixture: `Claim picker UX retest 2026-11-19`, invite `e673e2ec-ee6c-423b-b191-0a000d3d6ec2`.
- No production changes were made.

## Result

Apple sign-in returned to Drapeon Dev and the claim transition completed. The bootstrap session was consumed; its transition receipt was `SUCCEEDED` with `auth_handover_at` recorded. The saved Lagos pickup postcode remained SQL `NULL`.

The app initially restored a saved generic “Public profile” setup section with a disabled action. Returning to the claim checklist showed the intended “Verify your phone to publish” step.

Tapping “Verify phone and publish” called `account-profile-action` successfully, then the `tailor-claim-action` FINALIZE request returned HTTP 409 `NOT_READY`. The fixture remains `CLAIMED_AWAITING_EMAIL`, `profile_completed=false`, and `is_live=false`; no finalize receipt was created. Read-only readiness checks found the other profile, staff-approval, consent, and media requirements present (one approved avatar, two approved photos, and a consent manifest covering all three items). The server has no recorded `users.phone_verified_at` for this fixture.

## Cause and follow-up

Development is configured for phone verification bypass. That path saves the number and returns a bypass outcome, but intentionally does not claim SMS ownership or write `users.phone_verified_at`. FINALIZE requires that recorded verification, so this physical run cannot publish the shop without a real Development OTP or another explicitly approved verification path. No manual database change or admin bypass was used.

Commit `6b9ac31a` updates the mobile client to resume claimed users on the claim-specific checklist after saved setup state hydrates, keeps the claim action enabled regardless of ordinary setup-section state, and maps known finalization failures to actionable copy. These client changes were not part of the device build used for the attempt.

## Checks on `6b9ac31a`

- Mobile typecheck: passed.
- Claim UI contract: passed (2/2).
- `git diff --check`: passed.

The physical phone-verification-to-LIVE pass remains open. No SMS code, password, email address, or claim token is recorded here.
