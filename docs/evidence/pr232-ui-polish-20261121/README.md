# PR 232 mobile claim polish — 2026-11-21

Development only (`pqptfuqogvrajozfsqzi`). No Production settings or data were changed. Screenshots contain no claim token, email code, password, phone number, or pickup street address.

## Review shop

The `before-*review*` captures show the previous layout. The `after-*review*` captures show the current branch on iPhone SE (375 pt) and Pro Max, in light and dark appearance. They show the named step and progress bar, one privacy sentence, the Drape floating dock, and real garment images after loading.

The black tiles from the earlier emulator report were not black fixture images. The fixture rows matched the repository JPEGs by SHA-256 and byte size, and Development storage returned `image/jpeg` successfully. The view now uses Drape's `RemoteImage` primitive for its stable blurred placeholder, fade, and retry behavior. The latest Pro Max dark capture was taken after the photos had loaded.

## Sign-in

`after-se-signin-light.png` and `after-se-signin-dark.png` are fresh captures from the current Dev client at 375 pt. They show Apple first as a secondary outlined action, the email divider and field below it, the disabled dock reason, and “Send email code” as the only dominant action.

`after-pro-max-signin-light.png` is the existing current-design light capture. A Pro Max dark sign-in capture is still missing: the Pro Max simulator stopped accepting input while on the review step, so I did not substitute an SE image or label the review screen as sign-in evidence. The code uses the same theme-aware layout on both devices.

The password helper and dock reason were checked in the implementation: the field starts without a red error; after input or Continue, a single helper line reports the 10-character rule; the disabled dock repeats the exact short reason beside the action.

## Web visual pass

The Development preview was opened in the in-app browser using a token-safe local alias. Captures cover a 375 px phone layout and desktop width in light and dark mode. The page displays the real garment fixture images and responsive shop profile. `after-web-mobile-app-light.png` records the app-first handoff view.

The route-switch button did not change the visible page in the in-app browser check, so the interactive switch and post-claim web finish screen are not marked as verified. The local preview header needed a development-only CSP allowance for Next's eval/HMR; production CSP remains unchanged. The page screenshot itself was visually checked at phone and desktop widths.

## Live in-app browser recheck — 2026-11-21

- A separate fresh fixture, `Web claim finish QA 2026112123`, was created on the confirmed Drape-DEV project. Its private token remained in a mode-600 ignored file and a local token-safe preview alias; it is not in this evidence or the browser address bar.
- The live preview rendered in system Dark at a measured 375 CSS px (`document.documentElement.scrollWidth` was also 375) and at desktop width. The shop hero, profile details, portfolio images, step labels, and web email form appeared without horizontal overflow.
- The in-app browser's **Use the app instead** button and a portfolio image click did not change the visible page. The rendered page had no observable Next client initialization in this browser surface, so these clicks do not prove the route switch works or fails in a normally hydrated browser. Keep route switching unverified.
- Existing Light and Dark screenshots remain in this folder. This recheck did not produce a new screenshot artifact, did not reach a completed web claim, and does not verify the web finish screen or phone user-agent route.

## Claim-to-LIVE status

The fresh Development email claim passed email-code verification and reached password creation. The tailor must enter the disposable password directly in the Android emulator; the claim has not yet advanced to Contact & pickup. No phone verification, FINALIZE, LIVE transition, or Explore check has been recorded. The claim flow must stop at the photo-consent checkbox until the displayed fixture images have been explicitly approved for this test.

The Pro Max dark sign-in capture is still missing. Existing native evidence covers Pro Max and SE review screens in light and dark, plus SE sign-in in both modes and Pro Max sign-in in light mode. Do not substitute another device or screen and label it as Pro Max dark sign-in.

No PR was marked ready and no Production operation was run.
