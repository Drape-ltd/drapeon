# Tailor claim country picker retest — 2026-11-19

PR #232 head: `aa7b12b41c201e73718ec118cdafa779c4b3f6e9`

## Change

The claim-country choice sheet had only a minimum height. On the iPhone run,
the sheet header appeared without a usable country-options viewport. The shared
`ChoiceSheet` now accepts a fixed sheet height, the claim-country sheet uses
78% of the screen, and the options content grows within the scroll view.

The claim-email Postgres proof now waits for the actual TCP listener. The
Postgres image's temporary initdb process can report socket readiness before
the server is ready to accept TCP connections.

## Automated checks

- `pnpm launch:contracts` passed locally with Node 24.
- Shared tests: 98 suites and 879 tests passed.
- Mobile, Ops, and web typechecks and lint checks passed; Deno checks passed.
- Both `postgres-proof` checks and `static-contract` passed on this PR head.
- The Workers Build check was still running when this file was written.

## Development device check

- Fresh development fixture: `Claim picker UX retest 2026-11-19`.
- Invite ID: `e673e2ec-ee6c-423b-b191-0a000d3d6ec2`.
- The private claim link was sent to the founder's phone in Messages; its token
  is deliberately omitted from this evidence.
- The picker fix is not yet physically verified. iPhone Mirroring reports
  `Connection Interrupted`; the screen remains unavailable until the device is
  awake, unlocked, and reconnected.
- The claim-to-LIVE run is not complete. No production database, function, or
  release action was performed.
