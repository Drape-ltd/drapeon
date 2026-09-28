# Fulfillment origin repair — scoped implementation and release boundaries

Branch: `fix/fulfillment-origin-repair-20260928`, based on main `028c6e3`.

## Implemented

- Privacy-safe, uncached `read-gateway` action `fulfillment-options`: verified,
  live, non-test gating; returns only readiness and enabled usable methods.
- Shared origin readiness includes city as well as street, country, confirmation
  source and timestamp. Destination and shipping-corridor checks remain separate.
- Web custom brief and ready-made checkout filter methods and fail closed on
  loading/errors. No invented collection fallback. Retry rereads availability;
  stale selections cannot pass validation. Item flags are also respected.
- Request-keyed shared hook prevents previous-seller or previous-retry results
  from flashing while the new request is pending.
- Owner profile read includes private verification fields. Persistent repair
  warning links to `/account/profile?fulfillment=1#fulfillment`; repair requests
  open the editor. Saving explicitly confirms a private dispatch origin.
- Development-only `/fulfillment-preview` exercises real brief rendering at the
  fulfillment step. It cannot load/save drafts, submit orders or run fulfillment
  transitions. Its origin toggle is synthetic, not a production persistence test.

## Verified

- 31 shared fulfillment/setup tests passed, including no preference mutation,
  restoration of only enabled methods, missing-city and legacy-origin rejection.
- Web typecheck and scoped lint passed. Existing repo-wide lint warnings remain.
- Read gateway and draft Edge typechecks passed using the repository's existing
  `--sloppy-imports` setting.
- Nine Playwright regressions across 375, 768 and 1440 CSS-pixel widths: repair
  warning/deep-link target and negative save; ready-made blocked/retry/restoration
  with a mocked read response; brief unavailable/restored/input-retention fixture.
- Connected in-app browser: repair UI and brief unavailable/recovered states
  inspected at measured 375×812, 768×1024 and 1440×1000; zero horizontal overflow.
  Temporary viewport overrides reset. Synthetic views do not certify sign-in.
- Exact final-source `pnpm launch:contracts` passed: 83 shared suites / 710 tests,
  mobile/web typechecks, lint (warnings, no errors), Edge entrypoint checks and
  launch contracts. Local log: `/private/tmp/drape-fulfillment-final-contracts.log`.
- Real authenticated Dev smoke creates its own synthetic account, proves missing
  origin rejection, repairs through `tailor-profile-action`, reads the durable
  confirmation as owner, and makes a fresh customer read that restores delivery
  and shipping while leaving pickup false. Public response keys are strictly
  `methods` and `originReady`. Missing profiles return no methods.
- Only Dev (`pqptfuqogvrajozfsqzi`) deployments: read gateway ACTIVE v53 and
  tailor profile action ACTIVE v91. Dev's prior profile function accepted empty
  origins; aligning it to reviewed source made the negative save pass.
- The smoke's auth account was removed after each run. The first direct profile
  cleanup and a later visibility-toggle check returned unexpected statuses;
  owned-account cascading cleanup succeeded. Those Dev-only direct table paths
  are not certified here, and no real profile was changed to investigate them.

## Not deployed or certified

- Production remains unchanged; no migrations, client build, OTA or real messages.
- The production read-only audit found one live non-test profile with incomplete
  origin: `bf63097d-16b4-4504-ab69-c8d6c92a5d6a` (Oladimeji Mahuntan).
  No address or saved method was altered for this or any other real tailor.
- Existing order rows were not touched. A full existing-order/counterpart/device
  lifecycle replay was not performed; source preservation is not runtime proof.
- Exact notification link through fresh sign-in and customer/tailor mode switching,
  native warning/filtering, realtime counterpart restoration, and deduplicated
  terminal push/email delivery remain release gates.
- No outreach is authorized by passing these implementation checks. Deploy the
  scoped server read action before web, verify production repair/reload and the
  exact auth deep link, then approve and prove operational messaging separately.
- Keep saved flags and profiles intact. Do not automatically disable preferences.

Reproduce: `node scripts/test-fulfillment-origin-dev.mjs` (explicit Dev only),
and web `playwright test fulfillment-repair.spec.ts`.
