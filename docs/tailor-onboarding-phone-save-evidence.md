# Tailor onboarding phone persistence — 2026-09-28

## Change

Mobile setup now confirms the canonical `users.phone` save before advancing the identity section or submitting setup. OTP success (including configured bypass) is no longer equivalent to successful persistence. All three OTP completion paths use the same confirmed save; failed saves retain the setup draft and show a retry error. Final submission checks again. The fire-and-forget phone mirror and client-generated phone-verification timestamps were removed; video/draft persistence remains unchanged.

The authenticated `account-profile-action/save-onboarding-phone` action derives the user from the session, checks the stored TAILOR role, validates availability, and only fills an empty canonical contact. Existing phone changes still require the existing reauthentication workflow. The write is scoped to the caller and compares the previous phone value, so concurrent changes cannot be overwritten. It returns an exact saved-phone receipt. Enforced OTP uses server-owned verification records, never client metadata. Bypass saves a contact without claiming verified ownership.

Web retains its existing email/password reauthentication path and now checks `ok`, reads back the canonical phone under the signed-in user's RLS, and checks session refresh before displaying Confirmed.

## Verification

- Mobile and web TypeScript checks passed.
- Edge function `deno check` passed.
- Nine persistence regression tests passed: confirmed save, zero updated rows, DB failure, duplicate conflict, mismatched receipt, legacy empty string, existing-contact protection, bypass unverified state, trusted verification timestamp.
- Scoped lint: no errors; mobile setup has 46 existing warnings (including hook/ref and unused-variable diagnostics), not represented as resolved by this change. Web scoped lint passed.
- Live browser preview `/signup-preview?state=phone-save-failed` viewed at 375×812, 768×1024 and 1440×1000. Retry error visible; horizontal overflow 0 at all three sizes. This is mock visual evidence, not authenticated submission E2E.
- Deployed `account-profile-action` explicitly to DEVELOPMENT project `pqptfuqogvrajozfsqzi`; repository's existing production link was not changed.
- Live development API smoke passed: unauthenticated 401, false client role 403, initial save 200, authenticated canonical readback 200, idempotent retry 200, existing-contact replacement 409, duplicate contact 409.
- Two disposable development accounts were removed after successful smoke testing. Two earlier password-login attempts each removed their one fixture after CAPTCHA denial. No email/SMS was sent. Admin-generated QA sign-in links were used without changing CAPTCHA settings.
- `git diff --check` passed.

## Release boundaries

The server fix is now deployed to PRODUCTION: `account-profile-action`, ACTIVE version 42. It was prepared against the deployed function to preserve existing phone-change security. Nine initial-save and seven legacy-contact tests passed; development smoke verified both new canonical-save receipts and legacy bypass persistence without claiming SMS ownership. Production unauthenticated save returned 401 and the live service check returned 200. An authenticated production setup submission remains unverified. No database migration or native dependency change is required.

The installed mobile app may still bypass the endpoint locally. The new mobile source removes that shortcut and confirms persistence before advancing. A future app release is needed to deliver that client behavior; the owner explicitly deferred app builds. Physical-iPhone setup/video submission and live enforced-OTP mode were not exercised in this pass. DEVELOPMENT uses bypass; timestamp behavior is covered by unit tests.

Oladimeji's separately authorized contact repair and protected waiver are recorded in the recruitment exception runbook. This phone fix is not a waiver of contact, media, or trust requirements.

Reproducible checks: `deno test supabase/functions/account-profile-action/onboarding-phone_test.ts`, `deno check supabase/functions/account-profile-action/index.ts`, mobile/web `typecheck`, and `node scripts/test-onboarding-phone-dev.mjs`. The smoke script hardcodes only the DEVELOPMENT project, keeps credentials in memory, creates disposable fixtures, and cleans up only their exact IDs.
