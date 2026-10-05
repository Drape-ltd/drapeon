# Ops waiver visual proof, 2026-10-02

Environment: local Ops branch against D-DEV (`pqptfuqogvrajozfsqzi`), named local workforce dry run. No production action or verification decision was submitted.

Fixture: `18ba70d0-788c-45aa-a825-dc050e3ba55b` (`Waiver Refresh QA`), case `OPS-E4BA4AF8`. The case was open with a stale evidence snapshot and no challenge video.

Observed in the connected browser:

- The protected waiver view loaded the authoritative case and listed five profile prerequisites separately. It explained that an account phone being present does not mean phone ownership is verified.
- The stale-snapshot warning was visible and **Approve waiver and activate storefront** remained disabled. Both review acknowledgements and **Refresh reviewed evidence snapshot** were disabled until reviewed. No mutation button was clicked.
- Entered a disposable local reason and reference, then used **Reload current case and profile state**. The view briefly displayed its loading/no-decision state, then restored both entered values while retaining the disabled stale-case decision.
- Inspected the requirements and decision block at the default desktop viewport, a 390×844 phone viewport, and an 834×1112 tablet viewport. No horizontal overflow or clipped decision control was visible. The default viewport was restored afterward.
- The fixture's placeholder public image URLs did not render in the preview. This does **not** prove the media evidence is reviewable; approval behavior was intentionally not exercised.

The local preview server was stopped after inspection. Automated evidence: Ops unit tests, typecheck, lint, Deno replay-outcome test, and `pnpm launch:contracts` passed on this branch.
