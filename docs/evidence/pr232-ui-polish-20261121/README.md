# PR 232 mobile claim polish — 2026-11-21

Development only (`pqptfuqogvrajozfsqzi`). No Production settings or data were changed. Screenshots contain no claim token, email code, password, phone number, or pickup street address.

## Review shop

The `before-*review*` captures show the previous layout. The `after-*review*` captures show the current branch on iPhone SE (375 pt) and Pro Max, in light and dark appearance. They show the named step and progress bar, one privacy sentence, the Drape floating dock, and real garment images after loading.

The black tiles from the earlier emulator report were not black fixture images. The fixture rows matched the repository JPEGs by SHA-256 and byte size, and Development storage returned `image/jpeg` successfully. The view now uses Drape's `RemoteImage` primitive for its stable blurred placeholder, fade, and retry behavior. The latest Pro Max dark capture was taken after the photos had loaded.

The later Android contact captures showed those same preview tiles black after the screen had been open for about ten minutes. The claim-context Edge action signs private media URLs for ten minutes, so expiry is the likely cause; the fixture files themselves remain valid JPEGs. The mobile screen now refreshes claim context on foreground and every four minutes while the contact step is open, keeping fresh signed URLs without making the bucket public. A new Android run is still needed to verify this fixes the tiles in the running app.

## Sign-in

`after-se-signin-light.png` and `after-se-signin-dark.png` are fresh captures from the current Dev client at 375 pt. They show Apple first as a secondary outlined action, the email divider and field below it, the disabled dock reason, and “Send email code” as the only dominant action.

`after-pro-max-signin-light.png` is the existing current-design light capture. A Pro Max dark sign-in capture is still missing: the Pro Max simulator stopped accepting input while on the review step, so I did not substitute an SE image or label the review screen as sign-in evidence. The code uses the same theme-aware layout on both devices.

The password helper and dock reason were checked in the implementation: the field starts without a red error; after input or Continue, a single helper line reports the 10-character rule; the disabled dock shows the exact short reason once above the action.

## Web visual pass

The Development preview was opened in the in-app browser using a token-safe local alias. Captures cover a 375 px phone layout and desktop width in light and dark mode. The page displays the real garment fixture images and responsive shop profile. `after-web-mobile-app-light.png` records the app-first handoff view.

The route-switch button did not change the visible page in the in-app browser check, so the interactive switch and post-claim web finish screen are not marked as verified. The local preview header needed a development-only CSP allowance for Next's eval/HMR; production CSP remains unchanged. The page screenshot itself was visually checked at phone and desktop widths.

## Live in-app browser recheck — 2026-11-21

- A separate fresh fixture, `Web claim finish QA 2026112123`, was created on the confirmed Drape-DEV project. Its private token remained in a mode-600 ignored file and a local token-safe preview alias; it is not in this evidence or the browser address bar.
- The live preview rendered in system Dark at a measured 375 CSS px (`document.documentElement.scrollWidth` was also 375) and at desktop width. The shop hero, profile details, portfolio images, step labels, and web email form appeared without horizontal overflow.
- The in-app browser's **Use the app instead** button and a portfolio image click did not change the visible page. The rendered page had no observable Next client initialization in this browser surface, so these clicks do not prove the route switch works or fails in a normally hydrated browser. Keep route switching unverified.
- Rechecking the same safe local preview in Chrome also showed no observable React handler on the route-switch button and no browser console errors. The app-route switch therefore remains unverified in both browser surfaces; the static layout alone is not proof of the interaction.
- Existing Light and Dark screenshots remain in this folder. This recheck did not produce a new screenshot artifact, did not reach a completed web claim, and does not verify the web finish screen or phone user-agent route.

## Country picker follow-up

- The shared country source contains 245 unique phone countries, including Nigeria; the shared phone-country tests pass. The pickup-country sheet receives that source by name and code.
- The earlier unknown-flag boxes came from flag emoji rendered with the app's custom font, which lacks those glyphs. The claim form now displays the country name without an emoji. The reported empty native picker still needs a fresh Android screen check; the expired fixture prevented reproducing it on-device, so I am not marking the picker visually verified.
- Current Android screenshots show the selected country as “Nigeria” with the standard country sheet control and no missing-glyph boxes. This confirms the displayed selection only; opening the native list and selecting Nigeria remains unverified after the earlier empty-picker report.

## Claim-to-LIVE status

An earlier fresh Pro Max Development email claim completed phone verification through `dev_capture`, FINALIZE, LIVE, and signed-out Explore visibility; its receipt and database evidence are recorded in [the claim run log](../pr232-email-claim-20261121.md). That proves the email path in the Simulator, not Android, Apple, or carrier SMS delivery.

Android fixture `831564cf-b2b2-4d47-9157-d804fed2c967` on `pqptfuqogvrajozfsqzi` expired at `2026-11-21 23:47:07 UTC` before claim submission. The founder entered the password; I filled only the reserved Development phone and synthetic Lagos address. A mistaken Back key exited the app, and the 10-minute bootstrap had already expired; after resume, I requested a replacement email code, but the invite expired before verification. No contact details or consent were submitted, and no Android phone OTP, claim receipt, FINALIZE, LIVE transition, or Explore check resulted. This requires a new fixture for another Android end-to-end run. Test consent was authorized for generated media in Development; verify the shown images are those synthetic fixtures before submitting consent.

The Pro Max dark sign-in capture is still missing. Existing native evidence covers Pro Max and SE review screens in light and dark, plus SE sign-in in both modes and Pro Max sign-in in light mode. Do not substitute another device or screen and label it as Pro Max dark sign-in.

No PR was marked ready and no Production operation was run.
