# Explore loading: measurement and provisional budgets

These are launch targets, not measured production claims. Compare at least a week of
production samples by platform, app version, cold/warm entry, and connection quality
before changing them. The first observation should also be reproduced on a physical
device with a throttled network.

| Signal | Provisional p75 target | Investigate when |
| --- | ---: | ---: |
| Explore focus → first card laid out, cold grid | 1.5 s | p75 > 2 s |
| Explore focus → first cover loaded, cold grid | 2.5 s | p75 > 3 s |
| Explore read-gateway total server time | 400 ms | p95 > 750 ms |
| Explore profile, cover, or media-safety stage | no individual target yet | stage dominates p95 |

Mobile Sentry spans named `Explore usable content` carry `explore.first_card_ms`,
`explore.first_image_ms`, `explore.gateway_ms`, `explore.gateway_source`, and a
terminal outcome. `cache` means the 90-second in-memory public-read cache served
the request; `stale_fallback` means a failed read used the last cached response.
The Edge `read-gateway` emits `explore.latency` for each Explore request while
traffic is low, with stage durations and result count. Logs
contain no search text, media URL, or account identifier. Use the Edge invocation
duration for a second view of total server time; it includes work outside the
explore handler.

The orders strip and tailor grid now load independently, so an account-order read
cannot hold the grid. Keep the existing short in-memory client cache. Do not add
shared/server caching of Explore results until moderation, live-status, and
blocked-media invalidation are designed and tested. Cache hits and stale fallbacks
must be separated from genuine network samples when calculating budgets.
Failed refreshes may reuse only a still-unexpired local response; an expired
marketplace result must fail rather than reviving removed or blocked media.

Initial development sanity check (iPhone 17 Pro simulator, development database,
one cold Metro reload): 1,028 ms to first card and cover; 938 ms of that was
the discovery gateway read. This is not a production baseline or a percentile.

Read-only production Edge invocation logs checked on 14 October 2026 (preceding
24 hours) showed 10 `read-gateway` requests across **all** actions: p50 760 ms,
p75 6,654 ms, p95 9,305 ms, and no non-200 responses. This small mixed-action
sample is a warning, not an Explore-specific percentile. The new action/stage
log is needed before attributing those slow calls to a query or changing indexes.

After the Edge function is deployed, run this read-only Supabase Logs query over
a stated window (the Logs API defaults to the preceding 24 hours):

```sql
select
  count() as requests,
  quantile(0.75)(JSONExtractFloat(event_message, 'total_ms')) as p75_total_ms,
  quantile(0.95)(JSONExtractFloat(event_message, 'total_ms')) as p95_total_ms,
  quantile(0.95)(JSONExtractFloat(event_message, 'profile_query_ms')) as p95_profile_ms,
  quantile(0.95)(JSONExtractFloat(event_message, 'cover_query_ms')) as p95_cover_ms,
  quantile(0.95)(JSONExtractFloat(event_message, 'media_check_ms')) as p95_media_ms
from logs
where source = 'function_logs'
  and JSONExtractString(event_message, 'event') = 'explore.latency'
```

The query shape was checked against production Logs and now matches the v41
function events. For a valid before/after comparison, record the deployment
time and app version, and exclude the first cold-start sample when investigating
steady-state DB latency.

Production observation after `read-gateway` v41 was deployed on 14 October 2026:
two bounded public Explore reads returned 200 in 8.26 s and 7.91 s. The first
structured event recorded 7,727 ms in the handler, including 118 ms for the
profile query, 70 ms for portfolio covers, and 7,537 ms in the blocked-media
lookup. The first page had 11 tailors and 95 distinct candidate media URLs.
As a size-control check against the same production function, a one-tailor read
returned 200 in 0.71 s, and a six-tailor read with 49 distinct candidate URLs
returned 200 in 0.39 s. Their logged media checks took 53 ms and 75 ms,
respectively, versus 7.4–7.7 s for the 95-URL page. This supports an
oversized lookup as the cause, but does not establish an exact URL-length
threshold or a production speedup yet.
The indexed `media_assets.public_url` PostgREST query shape has 2,032 calls,
1.05 ms mean database execution, and 18.30 ms maximum in `pg_stat_statements`.
That separates the slow Edge-to-Data-API lookup from database execution; it
does **not** prove an index problem. The follow-up batches the same safety
lookup into at most four concurrent groups of 24 URLs, preserving filtering
for every candidate. Development Edge v55 returned 200 in 1.39 s, but its
different data volume makes that a functional check, not a production speedup
claim. Compare production stage timings after the reviewed follow-up deploy.

Production follow-up on 15 October 2026: PR #50 was merged into `main` and
`read-gateway` v42 was deployed with the batched lookup. Three consecutive
public reads of the same unfiltered 12-slot first page all returned HTTP 200
and 11 tailors. Client-observed request durations were 919, 346, and 337 ms;
the matching Edge `explore.latency` events recorded handler totals of 300,
200, and 168 ms, with media-safety stages of 141, 58, and 56 ms. That is a
large improvement over the v41 7.4–7.7 s media stage for the same 11-tailor
page. The first post-deploy request includes cold-start/network effects and
these three agent-generated calls are not a production traffic percentile.
The project was `ACTIVE_HEALTHY`, the function was `ACTIVE`, and the checked
four-minute function-log window contained zero `explore.failed` or `unhandled`
events. Continue observing real traffic before treating the provisional
budgets as an established SLO.

The reviewed mobile timing code was checked on an iPhone 17 Pro simulator
using the development backend: the current Metro bundle rendered Explore
cards and covers. This is a functional device check, not a production-client
latency sample. Production mobile spans still require a reviewed OTA to reach
the installed 1.0.3 binaries; staging-channel verification or an explicit
direct-release decision remains outstanding.

For follow-on coverage, measure first useful content on tailor profile, shop,
orders, and Sketch Room separately. Do not apply one generic page-load budget to
flows with different network dependencies. On each regression, identify the slow
stage before changing query shape, media format, cache lifetime, or indexing.
