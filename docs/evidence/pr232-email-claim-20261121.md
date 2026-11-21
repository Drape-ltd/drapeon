# PR 232 Development email claim — 2026-11-21

Project: Drape-DEV (`pqptfuqogvrajozfsqzi`). Production was untouched. This file omits the private claim token, email code, password, and phone number.

## Observed on iPhone Pro Max Simulator

- Fixture `Email simulator QA 2026-11-21 A`, invite `7b09d7b8-569b-4517-b7c2-5e5635937aa1`.
- The email code was verified. A disposable Development password was entered through the Simulator test CLI and kept only in the gitignored QA credentials file.
- Terminating and relaunching the app after password entry returned to Contact & pickup, preserving the verified email and password step.
- A Lagos pickup address with **no postcode** and synthetic fixture media was submitted. The searchable country picker allowed Nigeria to be selected without scrolling through 249 entries. The claim action returned the “Your shop is claimed” state.
- Read-only Development database check: transition receipt `7ec8aae0-c3f3-4c9d-bcd2-6969709e5f1d` is `SUCCEEDED`; `auth_handover_at` is set; invite and profile lifecycle are `CLAIMED_AWAITING_EMAIL`; `tailor_pickup_details.pickup_postal_code IS NULL`.
- The app showed the sign-in fallback after the claim session refresh did not yield a claimed account session. [Supabase's session documentation](https://supabase.com/docs/guides/auth/sessions) says a password change terminates the existing session; because the email handover sets the password, refreshing that bootstrap session is not a reliable route into phone verification. This is an inference from the documented Auth behavior and the observed fallback, not a captured refresh error code. The generic sign-in was stopped by a Cloudflare human-verification challenge. No CAPTCHA was completed or bypassed. This run has **not** proved phone OTP, FINALIZE, LIVE, or Explore.

## UI fixes from the run

- The pickup-country sheet now has search, including an empty-result state and a corrected pickup-country explanation. The old sheet made selecting Nigeria slow enough for the short-lived claim session to expire during the first attempt.
- Claim action failures now use the page’s inline message path; only the destructive media-removal confirmation remains a modal.
- Specialties and currency edits now use Drape’s choice sheet and the shared option lists instead of free-text comma and currency inputs. Public location now offers the same OpenStreetMap city suggestions used in normal tailor setup, with typed entry retained when search has no result. The edited sheets have passed typecheck but still need an on-device visual pass.

## Still open

- Resolve or explicitly verify the claimed-account sign-in fallback without weakening the Cloudflare gate. Then perform enforced `dev_capture` phone OTP, cold relaunch after phone verification, FINALIZE, LIVE, Explore, Ops, and notification checks.
- Complete the Android claim after its sign-in handoff, the web post-claim/finish screen visual check, and the physical Apple claim. Neither PR is ready for review on this evidence alone.

## Follow-up checks on the same branch

- `pnpm launch:contracts`, mobile typecheck, Prettier and `git diff --check` passed.
- A second fresh Development fixture, `Web visual QA 2026-11-21` (invite `319ebd70-70a7-4279-8920-b736b9454af5`), opened in the connected in-app browser. In dark appearance the desktop default web form, the QR/store-badge app route and both route switches rendered. At the browser's narrow viewport override, the form remained readable; the browser reported 416 CSS px despite a requested 375 px override, so this is **not** a 375 px screenshot proof. The web finish screen remains unobserved because it requires a completed web claim.
- Reopening the already-claimed email fixture's web link in the in-app browser rendered a generic **Not Found** page. The route only renders when `RESOLVE_PREVIEW` returns an invite preview. A route-specific recovery page now tells someone who has already claimed to sign in, and someone who has not claimed to request a new link. It shows the same content for invalid, revoked, expired, and consumed tokens and does not restore access to the spent token. The page rendered at desktop and 375 px in the in-app browser. In Next.js Development the streamed response had HTTP 200 despite calling `notFound()`; no HTTP 404 status is asserted. A claimed-session receipt screen on web remains unproved.
- The Android API 35 build initially failed because generated Vision Camera CMake/autolinking files held an old pnpm `patch_hash` path. Running the repository's `materialize-native-dependencies.mjs`, clearing only generated Android autolinking/CMake caches, and rebuilding produced a fresh Development APK. It was installed on a new blank `pr232_claim_api35` emulator, with Metro on this Mac and Drape-DEV selected. The pre-existing Android emulator and its app data were left alone.
- A separate Apple physical-device fixture, `Apple physical QA 2026-11-21` (invite `37bede81-d997-4983-a53a-002b7c57268b`), was minted on Drape-DEV. Its private link is in a mode-600 temporary file and **was not sent** while the founder was away. It expires after 60 minutes and must be reminted if the founder returns later.

## Fresh Android emulator run

- Fixture `Android claim proof 2026-11-21 B`, invite `a2d1647c-64f0-4f84-924c-ba022e3bbdad`, on Drape-DEV. The private link and disposable password stayed in mode-600 local files; no credential or code is in this evidence.
- Email verification completed. On the first Android fixture, a deliberately wrong email code showed an inline field error, the resend button appeared after the countdown, the new code verified, and a cold app stop/relaunch after password creation resumed at Contact & pickup with the verified step preserved.
- The pickup-country row initially did not respond on Android because the disabled `Input` owned `onPressIn`. It is now a real accessible touch target wrapping the existing Drape input. The sheet opened with populated country choices, search found Nigeria, and selection changed the postcode label to optional. See [country selection](pr232-android-20261121/nigeria-no-postcode.png).
- The synthetic Lagos address and media consent were submitted; see [consent](pr232-android-20261121/media-consent.png). Read-only Drape-DEV check: receipt `304e251d-7807-40cb-a1ca-118d0faca426` is `SUCCEEDED`, `auth_handover_at` is set, invite is `CLAIMED_AWAITING_EMAIL`, and `tailor_pickup_details.pickup_postal_code IS NULL`.
- Android then showed [“Sign in to finish”](pr232-android-20261121/post-claim-sign-in.png) because `refreshSession()` did not return a claimed session, reproducing the iOS blocker. The normal sign-in page loaded a Cloudflare human-verification widget. No challenge was completed or bypassed. Phone OTP, FINALIZE, LIVE, Explore, and a post-phone cold relaunch remain unproved.
- The three screenshots contain no claim token, password, OTP, or personal phone number. The Android media is a synthetic 1×1 black test image.
