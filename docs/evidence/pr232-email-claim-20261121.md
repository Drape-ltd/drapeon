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
