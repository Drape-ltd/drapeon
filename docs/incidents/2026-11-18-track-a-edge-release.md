# Track A Edge release incident — 2026-11-18

## Summary

The five-function Track A Edge release was deployed to Production by one Codex
session under the conditional Track A approval. After context compaction, that
same session incorrectly reported that the release had not run. The matching
`drape-ops` Worker was deployed and then rolled back, leaving a mixed release
state. After the four non-reader functions were restored, a later report
incorrectly said that all five new Edge versions were still live.

The release was restored to the previously captured function sources, except
for `read-gateway`, which had already passed signed-out Explore and public
profile checks and remained deployed.

The Worker exception was independently reproduced and fixed in [PR #228](https://github.com/Drape-ltd/drapeon/pull/228): Next 16.4.6 emitted `preview-props.json`, while `@opennextjs/cloudflare` 1.20.3 omitted it from the Worker artifact. The fixed adapter version is 1.20.12.

## Timeline (UTC)

| Time | Event |
| --- | --- |
| 20:31:37 | `read-gateway` deployed from v44 to v45. |
| 20:32:11 | `handle-verification-decision` deployed from v52 to v53. |
| 20:32:24 | `ops-trust-action` deployed from v16 to v17. |
| 20:32:38 | `ops-read-gateway` deployed from v16 to v17. |
| 20:32:53 | `tailor-profile-action` deployed from v57 to v58. |
| 20:34:06 | `drape-ops` Worker deployed as `139c9581`. |
| About 20:34 | Signed-in `/ops/tailors` returned Cloudflare 1101 on `139c9581`: `Unexpected loadManifest(/.next/server/preview-props.json) call!`. |
| 20:35:00 | `drape-ops` Worker rolled back to `075a9808`. |
| 20:50 | Captured pre-release sources redeployed for the four non-reader functions. |
| After restoration | A later release summary incorrectly reported all five new Edge functions active. A fresh inventory showed only `read-gateway` v45 remained from that release. |

## Impact and assessment

- `ops-read-gateway` v17 references `payout_claim_retry_authorizations`, which
  is absent from Production. The exercised Ops reads did not hit that path and
  no 5xx was recorded. Merged source already treats the exact `42P01` and
  `PGRST205` missing-table responses as an unavailable optional retry panel;
  [PR #230](https://github.com/Drape-ltd/drapeon/pull/230) adds request-level
  proof that Money Desk still renders and unrelated errors still surface.
- The Ops Worker rollback meant the new trust and Ops Edge functions no longer
  matched the running Ops app.
- The Worker rollback was the correct response to the signed-in Tailors-page
  1101, not an unexplained rollback.
- Context compaction caused the post-release report to state incorrectly that
  Track A had stopped at preflight. It was one Codex session, not two.
- A later summary was also stale after the four Edge restorations. Neither
  report should be used as deployment evidence without a live version read.

## Restoration

The following captured Production sources were redeployed, producing new
monotonic function versions rather than reusing old version numbers:

- `handle-verification-decision`: v52 source restored (new v54)
- `ops-trust-action`: v16 source restored (new v18)
- `ops-read-gateway`: v16 source restored (new v18)
- `tailor-profile-action`: v57 source restored (new v59)

`read-gateway` remains at v45 and `drape-ops` remains at `075a9808` (100%).
Post-restoration log checks found no 5xx for the five affected functions. Two
seller applications remained pending; no seller decision was made during the
release or rollback.

## Prevention

1. Before every Production action or report, read the live function inventory,
   Worker deployment history, and migration ledger; do not rely on conversation
   memory.
2. Maintain this release log with the approval, source SHA, timestamp, version
   before and after, and post-check for every Production action.
3. Track A cannot resume until the optional-table behavior in #230 is reviewed,
   the final merged Edge import closure is checked, and the combined Edge/Ops
   release receives fresh unit-specific approvals. The pending money migration
   is not part of Track A.
4. A rebuilt Ops Worker must pass a signed-in `/ops/tailors` check first, before
   any accompanying Edge release is described as complete.

## Replacement release — 2026-11-18T22:08:56Z

The replacement release used the pinned `main` commit
`c79ea684d4445e5606bac6d005a8b74419d8f317` (#230). Immediately before the
release, Production was read again and matched the approved starting state.

| Component | Before | After |
| --- | --- | --- |
| `handle-verification-decision` | v54 | v55 |
| `ops-trust-action` | v18 | v19 |
| `ops-read-gateway` | v18 | v19 |
| `tailor-profile-action` | v59 | v60 |
| `read-gateway` | v45 | v45 (intentionally unchanged) |
| `drape-ops` | `075a9808` | `d72a7d0f-7040-4727-811b-dc5dfd68799b` |

No migration, privacy function, service-health function, or seller decision was
included. The four Edge functions were deployed in the approved order. Each
had zero requests and zero 5xx responses in its immediate post-deploy log
window. The Ops Worker was then built with Node 22.23.5, Next 16.4.6, and
`@opennextjs/cloudflare` 1.20.12 before deployment.

First post-deploy checks passed:

1. A signed-in Production `/ops/tailors` page rendered its Tailor network and
   roster without a Worker exception.
2. A pending tailor record rendered the Explore placement control, including
   both placements and the protected review-decision action.

Rollback remains the captured sources stated above for the four Edge functions
and Worker version `075a9808-8483-4e73-b5b1-c50937d8a77a` for `drape-ops`.
