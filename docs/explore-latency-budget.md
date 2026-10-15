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

The query shape was checked against production Logs; it currently returns zero
matching events because the new function code has not been deployed. For a
valid before/after comparison, record the deployment time and app version, and
exclude the first cold-start sample when investigating steady-state DB latency.

For follow-on coverage, measure first useful content on tailor profile, shop,
orders, and Sketch Room separately. Do not apply one generic page-load budget to
flows with different network dependencies. On each regression, identify the slow
stage before changing query shape, media format, cache lifetime, or indexing.
