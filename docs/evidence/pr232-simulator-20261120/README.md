# PR 232 Development Simulator and web check — 2026-11-20

Development project: `pqptfuqogvrajozfsqzi`. Production was not changed.

## Native build and email claim

- Built a fresh `co.drapeon.app.dev` iOS binary from this branch (not a Metro reload), installed on isolated iPhone SE and Pro Max iOS 26.3 Simulators, and connected it to the Development Metro bundle. The build used `SENTRY_DISABLE_AUTO_UPLOAD=true` because the local Sentry upload lacks an org; the native build then succeeded.
- Created disposable invite `f9bcf921-b6a1-4caa-ad61-3e95d4fe2b3a` with the Development-pinned fixture script. The private token is omitted.
- On Pro Max: opened review, entered an Outlook test alias, requested an email code, tried one wrong code, then verified the correct code read privately from the mailbox. Wrong code produced a modal “Incorrect email code” alert, contrary to the inline-error design.
- Reached “Create your secure password.” Creating a password in the computer UI requires founder handoff, so the AFK run stopped here. No claim, phone OTP, FINALIZE, receipt, LIVE row, or Explore visibility can be asserted.
- Terminated and relaunched the app at that point. It returned to the shop review and then email entry, rather than resuming at password creation. This fails the requested cold-start resume behavior.
- Requested another code, observed the 60-second resend countdown, and successfully requested a replacement after it elapsed. “Use a different email” returned to the entry field. No back/X exit control was visible on the sign-in screen; a left-edge swipe did not exit.
- System dark appearance did not change the claim screen's light palette. The claim screen uses fixed `Colors.bone` surfaces. The file named `pro-max-dark-review.png` records this failure, not a dark-mode pass.

Screenshots in this folder show only the review screen and contain no claim token, code, address-bar token, email, or phone number. The synthetic 1×1 fixture media appears as black rectangles, so these shots do not validate real portfolio media quality.

## Web visual check

- Started the Development-pinned web app, opened disposable invite `7fe81db3-6f16-49a7-b8c6-d205c6f8945a` in the in-app browser, and inspected desktop and 375 px layouts. Both rendered the review and web email form. The 375 px desktop browser kept the web-first route, matching device-based routing rather than width-based routing.
- Opened the same page in iPhone SE Simulator Safari, which has a real iPhone user agent. The review page rendered. Simulator input control failed while trying to scroll to the phone handoff; the phone-first route, switch links, Instagram note, dark mode, and finish screen remain unverified in this run.
- A Next.js development overlay showed one issue badge, but no runtime failure appeared in the rendered claim page. The fixture's black 1×1 media is test data, not a product image result.

## Remaining proof

The email claim must resume from a cold launch, then complete password entry, Lagos pickup with no postcode, enforced `dev_capture` phone code, FINALIZE, LIVE and Explore. Apple still needs the founder's physical iPhone. The requested light/dark screenshots at every step and full phone-web visual pass are incomplete. Do not mark this PR ready on this evidence.
