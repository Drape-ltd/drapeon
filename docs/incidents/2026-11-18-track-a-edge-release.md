# Track A Edge release incident — 2026-11-18

## Summary

The five-function Track A Edge release was deployed to Production by a Codex
session under the conditional Track A approval. A second session subsequently
reported that the release had not run. The matching `drape-ops` Worker was
deployed and then rolled back, leaving a mixed release state.

The release was restored to the previously captured function sources, except
for `read-gateway`, which had already passed signed-out Explore and public
profile checks and remained deployed.

## Timeline (UTC)

| Time | Event |
| --- | --- |
| 20:31:37 | `read-gateway` deployed from v44 to v45. |
| 20:32:11 | `handle-verification-decision` deployed from v52 to v53. |
| 20:32:24 | `ops-trust-action` deployed from v16 to v17. |
| 20:32:38 | `ops-read-gateway` deployed from v16 to v17. |
| 20:32:53 | `tailor-profile-action` deployed from v57 to v58. |
| 20:34:06 | `drape-ops` Worker deployed as `139c9581`. |
| 20:35:00 | `drape-ops` Worker rolled back to `075a9808`. |
| 20:50 | Captured pre-release sources redeployed for the four non-reader functions. |

## Impact and assessment

- `ops-read-gateway` v17 references `payout_claim_retry_authorizations`, which
  is absent from Production. The exercised Ops reads did not hit that path and
  no 5xx was recorded, but the path was unsafe.
- The Ops Worker rollback meant the new trust and Ops Edge functions no longer
  matched the running Ops app.
- The post-release report incorrectly stated that Track A had been stopped at
  preflight. It had already run in another Codex session.

## Restoration

The following captured Production sources were redeployed, producing new
monotonic function versions rather than reusing old version numbers:

- `handle-verification-decision`: v52 source restored (new v54)
- `ops-trust-action`: v16 source restored (new v18)
- `ops-read-gateway`: v16 source restored (new v18)
- `tailor-profile-action`: v57 source restored (new v59)

`read-gateway` remains at v45. Post-restoration log checks found no 5xx for
the five affected functions.

## Prevention

1. Only one Codex session may have Production credentials or deployment
   authority at a time.
2. Every Production deployment must record the initiating session, approved
   source SHA, function version before and after, and post-check in this
   repository before a later session reports status.
3. Track A cannot resume until `ops-read-gateway` tolerates the absent table or
   its Production migration has been independently reviewed and approved.
