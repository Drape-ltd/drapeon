# Claim web route check (development, 2026-11-18)

PR #232. Development project `pqptfuqogvrajozfsqzi`. Fixture: `Web route check 2026-11-18`; invite ID `934b0bef-5989-4492-9a88-ecd9b2042f6f`. The private token and URL are intentionally omitted.

## Live in-app browser observations

- Desktop viewport: the web claim form is the default route. The `Use the app instead` switch opens a QR code for the HTTPS claim link plus App Store and Play badges. There is no desktop `drape://` button. `Continue in this browser instead` restores the web form.
- 375 px viewport on the same desktop device: the web form remains the default, independent of viewport width. Both route switches work. The form and QR handoff fit the narrow layout without horizontal overflow in the observed states.
- The QR points at the HTTPS claim route; the `/open?context=claim-finish` target renders the phone setup handoff and store badges. The actual post-claim completion state was not reached in this browser pass.
- The test fixture uses 1×1 PNG media, so its portfolio appears as black placeholder blocks. This fixture cannot validate real portfolio photography.
- The host Mac was in Dark appearance during the first pass; the claim page retained its light visual treatment. A brief Light appearance comparison was attempted, then the original Dark setting was restored. Browser screenshot capture turned black during the OS theme transition, so a reliable visual comparison is still outstanding.
- The Instagram/Facebook in-app browser message was checked in code. A browser with that user agent was not available for a live pass; its visual state remains unverified.

## Full desktop web claim retry

Fixture: `Web finish route check 2026-11-18`; invite ID `05c16a7b-19d6-4cac-a1ff-141488ab3cd5`. The founder approved submitting this disposable fixture with generated test media. The first attempt exposed a development database constraint bug: `prepare_tailor_profile_claim_v1` could not mark a verified email code `CONSUMED` (SQLSTATE `23514`). PR #216 now carries forward migration `20261119044734`; its separate evidence file records the fresh-Postgres proof and development application.

After the repair, the same fixture completed its web claim. The browser rendered **Your shop is claimed** and **Finish on your phone** with a QR code and App Store / Play badges. There was no desktop `drape://` action. Development database readback showed a `SUCCEEDED` transition receipt, recorded Auth handover, `CLAIMED_AWAITING_EMAIL` on the invite and profile, and a null pickup postcode for the Lagos address. This confirms the desktop finish state and the claim transition; phone OTP and LIVE finalization remain separate work.

The first rendered server route now follows the request user agent instead of briefly showing “Preparing your claim options…”. A stable HTTPS claim URL is passed into the QR component, avoiding a server/client QR mismatch. The phone finish action now explains how to install and retry if the app does not open.
The contact step now names the contact and pickup task instead of repeating the sign-in heading.

## Narrow browser follow-up

Fixture: `Mobile route check 2026-11-18 B`; invite ID `137aaad2-37cf-4d59-b756-e9ec34b66341` in the development project. At a measured **375 CSS px**, the web claim card, email field, primary button, and route switch fit with `document.documentElement.scrollWidth = 375`; there was no horizontal overflow. The app route showed its QR, store badges, and return switch, and returning restored the web form. The page logged zero hydration mismatch errors after the stable QR URL change.

The browser retained a desktop user agent despite its phone-width viewport. This validates responsive width and both switches, but **does not validate the phone user-agent default, the phone app-open button, dark appearance, or Instagram in-app browser warning visually**. Those are still device/browser proof gaps.

## Code and contract checks

- Device detection covers iPhone, Android, iPad desktop Safari, Mac laptop, and narrow Windows touch laptop in `claim-device.test.mjs`.
- `pnpm launch:contracts` passed with Node 22 after the device selection lint fix. `git diff --check` passed.
- The web completion branch now presents a QR code and store badges on desktop, and an app-open button on a phone/tablet. This needs a real completed web claim to confirm the rendered branch.

## Remaining proof

- Capture a clean light/dark comparison and Instagram in-app browser state on actual devices.
- Use a separate Lagos/no-postcode fixture for the physical email and Apple claim-to-LIVE checks. Verify `tailor_pickup_details.pickup_postal_code IS NULL` after finalize. This route fixture was not claimed.

GitHub comment writes returned 403 for the connected integration, so this evidence is kept on the branch for review.
