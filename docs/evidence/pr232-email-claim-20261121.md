# PR 232 Development email claim — 2026-11-21

Project: Drape-DEV (`pqptfuqogvrajozfsqzi`). Production was untouched. This file omits the private claim token, email code, password, and phone number.

## Observed on iPhone Pro Max Simulator

- Fixture `Email simulator QA 2026-11-21 A`, invite `7b09d7b8-569b-4517-b7c2-5e5635937aa1`.
- The email code was verified. A disposable Development password was entered through the Simulator test CLI and kept only in the gitignored QA credentials file.
- Terminating and relaunching the app after password entry returned to Contact & pickup, preserving the verified email and password step.
- A Lagos pickup address with **no postcode** and synthetic fixture media was submitted. The searchable country picker allowed Nigeria to be selected without scrolling through 249 entries. The claim action returned the “Your shop is claimed” state.
- Read-only Development database check: transition receipt `7ec8aae0-c3f3-4c9d-bcd2-6969709e5f1d` is `SUCCEEDED`; `auth_handover_at` is set; invite and profile lifecycle are `CLAIMED_AWAITING_EMAIL`; `tailor_pickup_details.pickup_postal_code IS NULL`.
- The app showed the expected sign-in fallback after the claim session refresh did not yield a claimed account session. The generic sign-in was stopped by a Cloudflare human-verification challenge. No CAPTCHA was completed or bypassed. This run has **not** proved phone OTP, FINALIZE, LIVE, or Explore.

## UI fixes from the run

- The pickup-country sheet now has search, including an empty-result state and a corrected pickup-country explanation. The old sheet made selecting Nigeria slow enough for the short-lived claim session to expire during the first attempt.
- Claim action failures now use the page’s inline message path; only the destructive media-removal confirmation remains a modal.
- Specialties and currency edits now use Drape’s choice sheet and the shared option lists instead of free-text comma and currency inputs. Location editing is still free text and needs its dedicated picker/search treatment.

## Still open

- Resolve or explicitly verify the claimed-account sign-in fallback without weakening the Cloudflare gate. Then perform enforced `dev_capture` phone OTP, cold relaunch after phone verification, FINALIZE, LIVE, Explore, Ops, and notification checks.
- Complete the web post-claim/finish screen visual check, Android run, and physical Apple claim. Neither PR is ready for review on this evidence alone.

## Follow-up checks on the same branch

- `pnpm launch:contracts`, mobile typecheck, Prettier and `git diff --check` passed.
- A second fresh Development fixture, `Web visual QA 2026-11-21` (invite `319ebd70-70a7-4279-8920-b736b9454af5`), opened in the connected in-app browser. In dark appearance the desktop default web form, the QR/store-badge app route and both route switches rendered. At the browser's narrow viewport override, the form remained readable; the browser reported 416 CSS px despite a requested 375 px override, so this is **not** a 375 px screenshot proof. The web finish screen remains unobserved because it requires a completed web claim.
- The configured Android API 35 emulator booted. A fresh Development client build did **not** finish: `react-native-vision-camera:configureCMakeDebug[arm64-v8a]` failed inside Prefab, which parsed the package's long pnpm `patch_hash` path as an option (`no such option ...react-native-vision-camera...patch_hash`). No Android claim behavior is asserted. The build was pinned to Drape-DEV; no Production app or project was installed or changed.
