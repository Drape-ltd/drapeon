# Recruitment video exception — development evidence

Date: 2026-09-28. Current status: scoped production components deployed and Oladimeji's protected waiver approved. Full production-health certification remains outside the evidence here. Earlier pending-state entries below are chronological checkpoints, not the current case outcome. See [the repeatable runbook and final case record](recruitment-tailor-exception-runbook.md).

## Implemented boundary

The administrator-only Ops workspace records a separate recruitment waiver case, requires fresh protected access and explicit public-evidence/video-waiver acknowledgements, and decides through `ops_trust_exception_action`. The normal challenge-video workflow remains unchanged. No video, consent, payout verification or notification delivery is fabricated.

Production requests require the signed Cloudflare workforce assertion. The local signed workforce bridge is limited to the exact development Supabase hostname and non-production runtime. Unsigned Edge calls were denied. Positive production Cloudflare execution remains a release gate.

## Live browser proof

Local Ops preview on port 3006 against development project `pqptfuqogvrajozfsqzi`, using founders administrator identity and synthetic, test-only profiles.

- Approval: profile `1811d6aa-d5e2-48ee-b8e8-e027db4bc212`, case `OPS-B7BE8A87`, request receipt `fb33d9f7-3177-444c-8e5f-69ee5e9de8ad`, decision receipt `cb39359b-2784-4b95-9164-366881ec494b`.
- Rejection: profile `9e51a634-ae9f-4f65-a95f-62b6a144347d`, case `OPS-20D4114F`, request receipt `13c837b6-224b-49bb-b76e-ea1e732be228`, decision receipt `2da0ff2c-e4bf-4500-88eb-fd474f7fc969`.
- Reload recovered each terminal decision without reopening controls. Loading state no longer renders a stale request form. Case page shows durable receipts, decision timeline and exact workspace link.
- Layout inspected live at desktop 1440x900, tablet 820x1180 and narrow 390x844. Narrow controls stack and remain readable; this does not override the existing phone user-agent restriction on sensitive Ops actions.
- Direct database readback: approval VERIFIED/live/verified with `video_reviewed=false`; rejection NOT_SUBMITTED/not live/not verified; both cases RESOLVED, each with two receipts and one decision audit. Both payout states remained USD/STRIPE/unverified.

## Automated checks

- Deno policy and existing verification-decision tests: 12 passed.
- Development database smoke: request/approve/reject, stale case and profile, missing assurance/acknowledgement, duplicate receipt recovery, unchanged payout state and audit persistence passed. All smoke fixtures rolled back.
- Ops TypeScript check and new Edge Deno check passed.
- Edge authentication coverage: 101 functions; Ops boundary: 11 functions / 10 callers passed.
- Scoped diff whitespace check passed.
- New RPC lint clean after compatibility forward migration; unrelated legacy development lint findings remain outside this change.

## Remaining production release gates

1. Review/isolate this feature from the substantially dirty checkout. Do not deploy all unrelated changes.
2. Exact production migration dry-run for the three new migrations (180000, 181000, 182000); verify environment binding and schema compatibility. Development migrations already applied; do not edit them.
3. Deploy the scoped Edge broker and Ops UI/proxy, then validate real Cloudflare protected access, rejection/approval and durable receipt recovery with an approved production scope.
4. Only then record the owner's recruitment exception and review/approve profile `bf63097d-16b4-4504-ab69-c8d6c92a5d6a` through the protected workspace. Recheck public evidence and actual marketplace visibility; payout remains separate.

The previously rejected direct-production SQL was NOT EXECUTED and is not part of the release workflow. No production profile was activated by this development work. No operational push or email was sent.

## Production promotion — 2026-09-28

Owner authorized promotion. Isolated checkout: `/private/tmp/drape-trust-release.JqPvBu`, based on committed `64254f8`; only new workflow sources and exact tailor/case links were added. Locked dependencies installed independently; isolated typecheck and OpenNext production build passed. Unrelated dirty checkout changes were not deployed.

Already-applied migration history was fetched into this temporary checkout (not repaired remotely). Production dry-run listed exactly the three reviewed exception migrations. All three then applied successfully to `wkfsrunetmgjdtcurmoj`. Post-promotion production public-schema lint reported no errors. RPC execution grants are limited to postgres and service_role.

- Edge endpoint `ops-trust-exception-action`: ACTIVE, version 1, JWT verification enabled, bundle digest `6dcb8c8be7fcd735768f75b27934d07b00495389e329d9e614247c2e73763d4a`.
- Ops Cloudflare version: `bcb0d633-ebbd-492b-b959-7d6e6f3d69b1`; new workspace inspected at the exact production profile URL.
- Production unsigned request and broker-key-without-workforce request both returned 401.
- Exact profile readback remains NOT_SUBMITTED/not live/not verified, no exception case yet; payout remains USD/STRIPE/unverified.
- Database observed 11 connections, 0 deadlocks, no stale processing jobs; scheduler outcomes in the previous 15 minutes were succeeded only, with 22 active cron definitions.
- Queue: 2,163 succeeded, 9 DEAD. All nine dead-letter jobs predate this release (last update no later than September 19); no replay or repair was attempted. These are existing email/SMS delivery failures, not a green queue-health certification.
- Database block-timing counters were zero; this does not establish actual Disk I/O budget/latency. Dashboard Advisor review and actual Disk I/O remain unverified.

Current handoff: Cloudflare requires the owner's six-digit authenticator challenge in Chrome before protected production read/request/approval can proceed. No weaker authentication path or direct SQL approval was used. Positive signed-workforce execution, final activation receipt, reload recovery and actual public marketplace visibility still require completion.

### Protected production request recovered

Owner completed Cloudflare 2FA. Live execution exposed two new-endpoint compatibility defects: equality against only the first configured service credential, and reliance on upstream IdP `amr` despite Cloudflare performing its own second factor. The endpoint now uses the existing `ops-trust-action` contract: Supabase gateway signature verification (`verify_jwt=true`) plus exact project/role/expiry/API-key binding, and independently verified Cloudflare signature, exact protected audience and 15-minute freshness. Principal role/environment/subject/revocation gates remain unchanged. No shared existing verification behavior was altered.

Corrections were checked/deployed to development first and then promoted. Broker-policy, exception-policy and Cloudflare-signature regressions: 9 passed. Production unsigned and missing-workforce requests still return 401. The authenticated production READ and REQUEST now succeed.

Production case `OPS-9D076893`; request receipt `4af15d96-823a-42c3-adbe-55662cfe2ce6`. Reason explicitly documents no video reviewed, owner-approved temporary portfolio and owner's follow-up commitment. Readback confirms case NEW with one receipt and profile still NOT_SUBMITTED/not live/not verified; payout unchanged. Final browser activation is prepared, awaiting action-time confirmation. Do not treat this request receipt as approval or public visibility evidence.

### Final production activation and follow-up

The owner supplied the missing contact, which was saved with an audited, exact-account support repair without claiming SMS ownership verification. After fresh protected access and owner authorization, Ops approved the waiver: decision receipt `6966411c-2a31-443d-b60c-c050f9a1e592`, case `OPS-9D076893`. Production readback confirmed VERIFIED/live/verified; reload recovered the terminal decision with no reopened approval controls. Payout readiness remained separate and unchanged.

The public API returned the approved profile but initially withheld pending-review media. A separate isolated web release corrected the erroneous missing-media-to-not-found mapping; the exact public profile now renders. Subsequent owner media approvals exposed two portfolio images and the approved avatar through the API. Recruitment is following up on portfolio quality and business-name confirmation; avatar placement and preventative phone-save production rollout remain outstanding. See [the full case record and operator checklist](recruitment-tailor-exception-runbook.md).
