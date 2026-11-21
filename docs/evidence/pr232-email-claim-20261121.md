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

## Claimed-session handoff and staged rerun

- A disposable Drape-DEV Auth probe reproduced the handover failure as `refresh_token_not_found` after `updateUserById` set the password and claimed metadata. Creating and verifying a new one-time Auth link for that same claimed user returned an ordinary session with `account_origin: CLAIMED`. The probe deleted its synthetic user afterward and did not print tokens.
- #216 now issues that new session only after a successful claim receipt, only when the mobile claimant explicitly requests it, and only after matching the verified Auth user ID and claimed metadata. #232 installs it with `setSession`; web claims do not request an unused session. This is deployed to Drape-DEV only and still needs a fresh claim-to-LIVE run.
- A new Pro Max fixture, `Email claim Pro Max 2026-11-21` (invite `9f5789e2-133f-44b7-96bc-fa04f4c191e6`), reached the password creation screen with email verified. It is paused there for the founder's own password entry. The temporary code, private link, and future password are omitted here. The invite has a 60-minute expiry; remint and repeat verification if it expires before resumption.
- A separate Apple fixture, `Apple claim physical 2026-11-21` (invite `b98e609f-8fdf-4ab7-9b6e-2844dd0a30c7`), was created but its link was not sent. It was used for a web preview and is **not** the physical-device test link. Remint a separate private Apple link when the founder returns.
- In the in-app browser, the Drape-DEV desktop claim preview defaulted to the web form. Its “Use the app instead” switch showed a QR and both store badges; “Continue in this browser instead” returned to the form. At a narrow viewport, the form remained readable in dark appearance. The standalone `/open?context=claim-finish` page rendered its app link and store fallbacks. This does not prove a completed web claim or the post-claim finish screen, nor phone user-agent routing and light appearance. No screenshot with a private QR or token was saved.
- The email Postgres proof on #216 briefly failed in CI because `pg_isready` accepted the image's temporary Unix-socket startup server. It now waits for the final TCP server and passed in fresh local Postgres. #232 already had an equivalent, more bounded TCP readiness check.

## Successful fresh Pro Max email claim to LIVE

- The staged fixture above could not test relaunch: its bootstrap session expired at 17:55:47 UTC before the founder entered the password. A read-only Drape-DEV row confirmed that expiry. On relaunch, the app returned to email entry; #232 now shows an explicit expired-session message instead of silently resetting.
- A new fixture, `Email claim Pro Max 2026-11-21 fresh` (invite `1c8a246f-99db-4a72-ac53-242468ce1516`), verified a fresh email code. The founder entered a new Development password directly in the Pro Max Simulator. Terminate/relaunch **within the valid bootstrap session** returned to Contact & pickup with the verified email and password step preserved.
- The Simulator submitted a disposable US-format phone, `12 QA Lane, Ikeja, Lagos`, Nigeria, **no postcode**, and consent for synthetic fixture media. The claim action issued an ordinary claimed session and opened “Verify phone and publish” without another sign-in.
- With Development `PHONE_OTP_MODE=enforced` and `SMS_PROVIDER=dev_capture`, the same OTP verification path accepted the code captured privately in Drape-DEV function logs. This proves the application flow, **not carrier SMS delivery**. The app then showed [Your shop is live](pr232-email-live-20261121.png).
- Read-only Drape-DEV proof: transition receipt `b448672a-8c61-411b-9834-834c8eea6282` outcome `SUCCEEDED`; `users.phone_verified_at=2026-11-21 18:08:26.331+00`; invite status and profile lifecycle `LIVE`, `is_live=true`; `tailor_pickup_details.pickup_country_code='NG'` and `pickup_postal_code IS NULL`. The receipt and screen contain no private token, code, password, or personal phone number.
- The signed-out Drape-DEV `read-gateway` returned this profile from both `tailor-profile` and an `explore-tailors` search (HTTP 200, one matching row). This checks the same public gateway used by web and mobile Explore; visual placement in the rendered Explore page is a separate check.
- The Drape-DEV web app at `127.0.0.1:3004/explore` rendered the fixture as a signed-out tailor card with a public profile link, “From $10”, and “Development” location. This confirms visual placement in the actual Explore UI.
- The pickup-country field rendered flag emoji as missing-glyph boxes under the shared custom `Input` font on the Simulator. #232 now displays the country name alone in that field. Mobile typecheck and `git diff --check` passed. The patched field was visually checked on Android and rendered “Nigeria” without missing glyphs; iOS visual recheck remains.

## Android claim attempt

- A fresh Android emulator build on Drape-DEV reached email verification, password creation, and Contact & pickup. Cold stopping and reopening the app resumed at Contact & pickup. Android Back exited the form, and opening the same private link returned to the same step; unsaved phone text was lost.
- A duplicate synthetic phone produced the specific inline `PHONE_ALREADY_IN_USE` guidance before any claim transition. A replacement unused synthetic phone was entered, but the ten-minute bootstrap session expired before the retry completed. This attempt is **not** Android claim-to-LIVE proof; the invite remains `OPENED` and no transition receipt exists. No claim token, password, OTP, or full phone number is recorded here.
- The country field showed “Nigeria” without the former missing-glyph flag boxes.

## Remaining evidence

- Check Ops state and notification outcomes.
- Complete a fresh Android claim to LIVE; verify dark appearance and smaller phone layout on iOS and Android.
- Complete the web claim finish/handoff visual pass at phone and desktop widths, in light and dark appearance, and capture token-free screenshots.
- Complete the Apple claim on the founder's physical iPhone using a fresh private link. Nigerian carrier delivery remains unproved until a real Nigerian OTP is sent.

## Additional web visual pass

- Reopened the still-valid, unclaimed Apple QA fixture in the in-app browser through a private localhost redirect; its token is omitted here. Desktop defaulted to the web email form. “Use the app instead” showed a QR and both store badges; “Continue in this browser instead” restored the form.
- The narrow dark viewport showed a readable preview and app handoff. The browser reported `window.innerWidth=416` despite a requested 375 px override, so a true 375 px result and phone user-agent route are **not** claimed. The completed web finish screen remains unobserved.
