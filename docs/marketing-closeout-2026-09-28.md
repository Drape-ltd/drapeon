# Marketing source closeout — September 28, 2026

## One source of truth, separate release units

This closes the scattered marketing **source** inventory against main `b38a62b`.
It does not certify a production rollout or a new mobile binary. The original
mixed checkout is preserved, not used as a release source.

| Unit | Source / verification | Deployment |
| --- | --- | --- |
| Web brand, welcome/help copy, lifecycle previews, topic UI, consent-gated registry | Already on main; retain newer main implementations | Production web version not certified here |
| Topic preference server wiring | Canonical shared vocabulary; authenticated consent/save/readback/opt-out checks | Dev `communications-action` ACTIVE v18; production unchanged |
| Survey submission server wiring | Private responses; ownership, due/expiry gates, canonical order IDs, duplicate durable receipts | Dev `submit-survey` ACTIVE v1; production unchanged |
| Survey error recovery | Server explanation rendered; score/comment retained after rejection | Source verified in connected browser and automated web previews; web deployment pending |
| Native topic choices, What's new, guide analytics | Isolated marketing hunks; current main auth/navigation protections retained; mobile typecheck/lint passed | Native runtime/re-entry/consent/deep-link evidence and a future client release still required |
| Six historical marketing SQL files | Exact original source, all six present in **Dev** migration history | No migration applied in this closeout; production history/promotion must be reviewed separately |

## What was retained, not rolled back

- Main's address-hash email suppression, signed/redacted Resend receipts, retry
  ledger and role-aware inbox navigation. Old local email/webhook and inbox files
  are stale alternatives, not a new release batch.
- Previously merged discovery, branding, website analytics, welcome materials,
  survey/topic shared contracts and preview routes.
- Today's phone, recruitment-waiver, fabric and monolith merge remains independent.
- No Vision, auth cleanup, payment behavior, native dependency, app identity,
  store build, OTP policy, real campaign or recipient changes are included.

## Verification

- Exact `pnpm launch:contracts`: 83 shared suites / 708 tests; mobile/web
  typechecks and lint (warnings, no errors); all Edge entrypoint typechecks.
  One run hit a macOS Jest worker SIGSEGV; the full unchanged rerun passed.
- New deterministic Edge policies: 14 tests passed. Included in launch checks,
  together with marketing topic/database alias parity.
- Web preview regressions: 27 passed across 375, 768 and 1440 CSS-pixel widths.
  The initial failure assertion also matched Next's route announcer; scoping it
  to the feedback card fixed the test, not the product behavior.
- Connected in-app browser: exact feedback-failure fixture inspected at measured
  375×812, 768×1024 and 1440×1000 CSS viewports. Score/comment remained selected,
  the server explanation was readable, the retry CTA stayed usable and there was
  no horizontal overflow. Overrides were reset. This is a synthetic UI fixture,
  not an authenticated production browser persistence pass.
- Real authenticated **Dev-only** smoke: topic consent requirements, invalid
  topic/channel rejection, save/readback/opt-out; unauthorized and foreign-subject
  survey rejection; missing/delayed invitations; one private persisted response,
  allow-listed tags, replay returning the same receipt and invitation completion.
  The test's own invitation and account were deleted afterward. No real recipient
  or campaign was used; existing incidents and accounts were not modified.
- Dev schema existence and migration history were read, not pushed. Confirmed
  versions: `20260915133000`, `20260915143000`, `20260915150000`,
  `20260915153000`, `20260920100000`, `20260920113000`.

Reproducible Dev smoke: `node scripts/test-marketing-closeout-dev.mjs`.
It explicitly targets `pqptfuqogvrajozfsqzi`, creates synthetic fixtures, never
uses production, and does not send a campaign. Logs from this run are in
`/private/tmp/drape-marketing-dev-smoke.log` and
`/private/tmp/drape-marketing-web-tests-final.log`.

## Remaining release gates — not hidden WIP

1. Review production's exact schema/function history. Do not push an unreviewed
   backlog or reapply Dev histories. The topic/campaign and survey schema units
   need separately reviewed batches, each at most five pending migrations.
2. Verify survey scheduling against production's portable order-ID schema and
   canonical account role. Any correction to a Dev-applied migration must use a
   new forward migration, not edits to these histories.
3. Production survey Ops routing, negative-feedback recovery, counterpart
   notifications and provider terminal outcomes are not certified by this smoke.
   Automatic survey email delivery remains disabled/unimplemented; no new sender
   or cron is enabled by these source changes.
4. Replay the native What's new/topic/guide paths, role isolation, consent
   failures and re-entry on the affected devices before the approved client
   release. No mobile build, OTA update or store submission was performed here.

The older seven-lane discovery/lifecycle plan is a planning reference, not an
accurate deployment ledger. Its percentages must not be interpreted as new
features being live, or used to justify a bulk promotion.
