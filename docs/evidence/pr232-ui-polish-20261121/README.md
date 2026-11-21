# PR 232 mobile claim UI polish — 2026-11-21

Development project only: `pqptfuqogvrajozfsqzi`. No Production configuration or data was changed. Screenshots contain no claim token, email code, password, or pickup street address.

## Review step before and after

The four `before-*review*` images are from the earlier Pro Max and SE simulator evidence. The four `after-*review*` images were captured from the updated Development client on the iPhone SE and Pro Max iOS 26.3 simulators.

The updated review screen has the larger named step label and clearer progress track, one quiet privacy sentence, a steady media placeholder that fades to real-looking portfolio fixtures, and the inset Drape floating action dock. The country picker now displays country names and ISO codes instead of unsupported flag emoji, which caused the “unknown” glyphs in the founder’s recording.

## Sign-in step

`after-pro-max-signin-light.png` records the post-polish Pro Max light sign-in layout: Apple is a secondary outlined action above email, and “Send email code” is the sole dominant dock CTA. The source also places the disabled reason immediately above the dock. Provider and dock-reason helper styles now follow the active system palette.

The remaining SE and Pro Max sign-in captures (SE light/dark, Pro Max dark) are pending. The SE screen showed the older cached layout, so that capture is excluded. The Pro Max continued to show the Development link-check rate-limit screen after one pinned retry; no further server attempts were made. Earlier Development logs showed 30 HTTP 200 responses followed by 18 HTTP 429 responses in the 19:20–19:27 UTC window. A fresh iOS client build was attempted: the first stopped at the optional Sentry source-map upload because local org config is absent; the retry with Sentry upload disabled stalled before replacing the installed app. A Maestro invocation without a device selector earlier chose a connected Pixel 8; all later simulator automation was pinned to the iOS Simulator UDIDs.

The latest Development invite was not claimed. The screenshot set therefore does not prove claim-to-LIVE. Do not mark PR #232 ready until the missing current-bundle sign-in screenshots and full claim pass are recorded.
