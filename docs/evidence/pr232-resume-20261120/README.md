# PR 232 claim recovery check — 2026-11-20

Development project: `pqptfuqogvrajozfsqzi`. Production was untouched. Claim tokens and one-time codes are omitted.

## Verified on a fresh Development iOS Simulator client

- Invite `48d89cc9-d341-4848-8549-74a1af01ee8e`, fixture `Resume QA second 2026-11-20`, on the iPhone Pro Max iOS 26.3 Simulator.
- Requested an email claim code for a disposable Outlook alias. One deliberately wrong code left the input on screen and displayed the error beneath it; no modal appeared. The correct code advanced to password creation.
- Terminated and relaunched `co.drapeon.app.dev` after email verification. The app checked the server's active bootstrap session and reopened **Create your secure password** without asking for email or another code. This also exposed the startup device-trust check that had been clearing temporary claim sessions; the fix was included in this branch.
- iPhone Pro Max password screen and iPhone SE review screen visually followed light and dark system appearances. Screenshots here contain no token, code, email or phone number. The black storefront images are synthetic 1×1 fixture media, not representative portfolio photos.
- Phone OTP errors already render beneath the code field in `PhoneOtpModal`; a successful resend now clears only the old code and error. This path has not been exercised through a complete claim in this run.

## Web visual check

- Opened the same Development fixture on the local web app. Desktop shows the web email form first. Switching to the app route showed a QR code and App Store / Play Store badges.
- At 375 px width with a desktop user agent, the app handoff card remained readable and had a visible **Continue in this browser instead** link. Device-first routing correctly did not change merely because the desktop viewport narrowed.
- Opened the fixture in iPhone SE Simulator Safari with a real iPhone user agent. The page showed the app-first button, store badges and **Continue in this browser instead**. The Next.js development overlay obscured part of the switch link, and the switch click itself was not verified. `se-safari-phone-handoff.png` contains no address-bar token.

## Still required before review

- Cold relaunch after password entry and after phone verification, plus the full email claim → enforced `dev_capture` phone OTP → FINALIZE → LIVE → Explore. This run stopped at password creation; no receipt ID, `phone_verified_at`, LIVE row or Explore result is claimed here. The founder was AFK, and entering a new credential in the computer UI requires their handoff.
- Instagram note, finish screen, and token-free dark-mode screenshots at phone and desktop sizes are still open. The desktop switch links now work, and the claim route follows dark appearance.
- Physical Apple claim on the founder's iPhone. Mint a fresh fixture when the founder returns; the earlier link expired.

## Return session staging and web follow-up

- A fresh Development email fixture, invite `f823a698-35ff-4564-bcc8-1f63745893c6`, reached **Create your secure password** on the iPhone Pro Max Simulator after a real email code was verified. The screen is paused for the founder to enter the new test password. No credential was generated or entered by the agent. The invite expires about one hour after its creation; the bootstrap session has a shorter lifetime, so an expired session must be restarted before continuing.
- A separate Development Apple fixture, invite `974e203e-c17e-4803-968c-ce86a1228e04`, was minted for the physical iPhone but its private link has not been sent. It should be replaced if it expires before the founder returns.
- A separate web fixture, invite `133a7fd7-9df5-467b-88b5-f5ed1bf7beec`, was used for browser inspection. On desktop, the web form is the default route; the switch link opens the QR and store-badge route, and the return link restores the web form. The QR keeps a white quiet zone in dark appearance. At a 375 px browser width, the dark form and QR card remain readable. iPhone SE Simulator Safari showed the phone-first preview route with a real iPhone user agent.
- The claim page previously stayed light in dark appearance. A scoped dark palette was added to the private claim route, including its form and QR card. The web finish screen still needs a real claim before it can be observed visually. No successful claim, receipt, phone verification, LIVE lifecycle, or Explore visibility is asserted by this staging run.
