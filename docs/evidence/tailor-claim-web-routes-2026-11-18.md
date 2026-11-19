# Claim web route check (development, 2026-11-18)

PR #232. Development project `pqptfuqogvrajozfsqzi`. Fixture: `Web route check 2026-11-18`; invite ID `934b0bef-5989-4492-9a88-ecd9b2042f6f`. The private token and URL are intentionally omitted.

## Live in-app browser observations

- Desktop viewport: the web claim form is the default route. The `Use the app instead` switch opens a QR code for the HTTPS claim link plus App Store and Play badges. There is no desktop `drape://` button. `Continue in this browser instead` restores the web form.
- 375 px viewport on the same desktop device: the web form remains the default, independent of viewport width. Both route switches work. The form and QR handoff fit the narrow layout without horizontal overflow in the observed states.
- The QR points at the HTTPS claim route; the `/open?context=claim-finish` target renders the phone setup handoff and store badges. The actual post-claim completion state was not reached in this browser pass.
- The test fixture uses 1×1 PNG media, so its portfolio appears as black placeholder blocks. This fixture cannot validate real portfolio photography.
- The host Mac was in Dark appearance during the first pass; the claim page retained its light visual treatment. A brief Light appearance comparison was attempted, then the original Dark setting was restored. Browser screenshot capture turned black during the OS theme transition, so a reliable visual comparison is still outstanding.
- The Instagram/Facebook in-app browser message was checked in code. A browser with that user agent was not available for a live pass; its visual state remains unverified.

## Code and contract checks

- Device detection covers iPhone, Android, iPad desktop Safari, Mac laptop, and narrow Windows touch laptop in `claim-device.test.mjs`.
- `pnpm launch:contracts` passed with Node 22 after the device selection lint fix. `git diff --check` passed.
- The web completion branch now presents a QR code and store badges on desktop, and an app-open button on a phone/tablet. This needs a real completed web claim to confirm the rendered branch.

## Remaining proof

- Capture a clean light/dark comparison and Instagram in-app browser state on actual devices.
- Use a separate Lagos/no-postcode fixture for the physical email and Apple claim-to-LIVE checks. Verify `tailor_pickup_details.pickup_postal_code IS NULL` after finalize. This route fixture was not claimed.

GitHub comment writes returned 403 for the connected integration, so this evidence is kept on the branch for review.
