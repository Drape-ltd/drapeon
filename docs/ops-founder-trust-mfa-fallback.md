# Temporary founder trust-review MFA fallback

This is a time-bounded recovery path for tailor trust reviews while the Cloudflare account owner cannot update the dedicated protected-access application. It is not a replacement for Cloudflare Access.

## Authority boundary

- A valid normal `ops.drapeon.co` Cloudflare Access session is still required.
- Only the exact active `founders@drapeon.co` administrator principal can continue.
- The same founder must sign in to the already-confirmed Production Supabase Auth user and complete its TOTP factor.
- TOTP assurance is accepted for at most 15 minutes and is revalidated on every request.
- The fallback unlocks only the private tailor challenge video and the tailor approve/reject action.
- Money Desk, exports, account deletion, case merge/split, media actions, delivery actions, and workforce administration still call `hasFreshOpsMfa` and still require the dedicated Cloudflare sensitive application.
- The database switch expires no later than `2026-12-01 06:00:00+00` (midnight America/Chicago) even if the application code remains deployed.

## Release order

1. Apply `20261113042617_temporary_founder_trust_totp_fallback.sql` to Dev. Confirm Dev creates no enabled fallback row and rejects the protected wrapper.
2. Run the Ops tests, interaction contracts, environment contract, production build, root launch contracts, and `git diff --check` on Node 22.
3. Release the matching Ops Worker and schema from one reviewed commit. Do not apply the Production enablement while an older Worker is active.
4. In the founder's existing normal Cloudflare session, open a pending tailor trust case and choose **Verify protected access**.
5. If the Production Supabase password is unknown, use the normal Drapeon account-recovery page. Keep the password and TOTP secret out of chat, logs, screenshots, and the repository.
6. Enroll the founder TOTP factor once, save its recovery material in the approved credential store, then verify the case flow on an expendable pending review before deciding a live case.

## Audit and verification

`ops_founder_trust_mfa_events` is append-only. It records sign-in attempts after the exact Auth user is known, TOTP enrollment/verification, evidence delivery, and decision preflight. The existing trust evidence log, case events, and action receipt remain authoritative for the reviewed case and domain outcome.

After release, verify:

- the fallback configuration names the exact founder workforce principal and Auth user;
- its expiry is at or before the hard database deadline;
- a 16-minute-old TOTP proof is rejected;
- another workforce principal or Auth user is rejected;
- a fallback session cannot open Money Desk, exports, account deletion, or workforce controls;
- evidence access and approve/reject each create the expected durable audit records.

## Immediate rollback

Run `supabase/migrations/rollback/20261113042617_temporary_founder_trust_totp_fallback.rollback.sql`. It disables the singleton switch without deleting the Auth binding or audit evidence. The application then fails closed and returns to the dedicated Cloudflare protected-access path.

After the Cloudflare owner account is recovered, disable the database switch, verify the dedicated sensitive application with the normal founder identity, and remove the temporary UI and RPC in a follow-up migration. Do not extend the hard expiry in place.
