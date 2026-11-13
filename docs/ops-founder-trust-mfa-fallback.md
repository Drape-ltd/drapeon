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

Production already enforces placement on approval, while its old Edge and Ops runtimes do not send the complete placement-aware request. Releasing this fallback alone does not fix approvals: the stale path will still fail with `PLACEMENT_REQUIRED`.

Use one attended window from one exact merge commit on `main`. That commit must include #167 and #207. Each numbered Production mutation needs its own explicit approval; approval for one step does not authorize the next.

1. Apply `20261113042617_temporary_founder_trust_totp_fallback.sql` to Dev. Confirm Dev creates no enabled fallback row and rejects the protected wrapper.
2. Run the Ops tests, interaction contracts, environment contract, production build, root launch contracts, and `git diff --check` on Node 22.
3. Record the final `main` SHA and recompute the Track A import closure. Obtain a separate approval, then deploy exactly these five Edge functions from that SHA: `handle-verification-decision`, `tailor-profile-action`, `read-gateway`, `ops-trust-action`, and `ops-read-gateway`. Record the new Production versions and exercise their reviewed deny paths. Stop on any version, dependency, or denial mismatch.
4. Obtain a separate approval, then deploy `drape-ops` from the same SHA. Verify the Worker version and confirm that normal Cloudflare Access still protects Ops. Before the migration exists, the founder fallback must remain unavailable: the binding lookup treats a missing fallback table as no authority, and the customer-web trust-evidence route continues to require the dedicated Cloudflare sensitive-app proof.
5. Obtain a separate approval, then apply `20261113042617_temporary_founder_trust_totp_fallback.sql` to Production. Do not apply it while an older Ops Worker is active.
6. Confirm the singleton binding names the exact founder principal/Auth user, is enabled, and expires no later than the hard deadline. Re-run database security advisers and the wrong-user, stale-proof, and non-trust-action denial checks.
7. In the founder's existing normal Cloudflare session, open a pending tailor trust case and choose **Verify protected access**.
8. Enroll the founder TOTP factor once, save it in the approved credential store, then verify evidence access and approve/reject on an expendable pending review before deciding another live case.

The 2026-11-12 (America/Chicago) read-only prerequisites found a confirmed `founders@drapeon.co` email identity with an existing password hash and no TOTP factor. If the password is forgotten, use the normal Drapeon recovery page: the reset goes to `founders@drapeon.co`, not the locked Gmail identity. Keep the password, reset link, QR code, TOTP secret, and authenticator codes out of chat, logs, screenshots, and the repository.

There is currently no deployment path in this session: Wrangler's saved token is expired, and the Cloudflare dashboard is logged out. Its saved Outlook profile reports that the account uses a different login provider; the other saved dashboard profile is the unavailable Google identity. A Cloudflare account member with Worker deployment access must execute steps 3 and 4 unless dashboard or Wrangler access is restored first.

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

## Cleanup after the hard expiry

After `2026-12-01 06:00:00+00`, treat the fallback as retired even if the Cloudflare account is not yet recovered:

1. Confirm the singleton is disabled or expired and that a fresh founder cookie cannot produce a trust proof.
2. Wait at least 15 minutes for every short-lived fallback cookie to expire.
3. Ship an application cleanup that removes the founder MFA page/session route, fallback evidence alias, cookie enrichment, trust-only proof branch, and Turnstile configuration that exists only for this path. Generic Cloudflare `hasFreshOpsMfa` behavior must remain unchanged.
4. Ship a forward database migration that revokes and drops `prepare_founder_mfa_trust_verification_decision` and removes the singleton configuration table only after no deployed Worker queries it.
5. Retain `ops_founder_trust_mfa_events` and its immutability trigger as audit evidence. Do not delete or rewrite its rows. Keep the workforce `auth_user_id` binding because the existing local Supabase MFA path also uses it.
6. Re-run the Ops contracts, Production build, security advisers, and dedicated Cloudflare sensitive-app approval check. Record the cleanup commit and live Worker/function versions.
