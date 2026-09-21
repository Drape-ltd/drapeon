import { defineCloudflareConfig } from '@opennextjs/cloudflare'
import r2IncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache'

/**
 * Keep public ISR/SSG and `unstable_cache` results out of the Worker process.
 *
 * The R2 binding is declared in wrangler.jsonc as NEXT_INC_CACHE_R2_BUCKET.
 * Tag caching intentionally remains dummy for now: the web app has no
 * revalidateTag/revalidatePath callers, so adding D1/DO infrastructure would
 * expand the production surface without improving a current request path.
 * If on-demand revalidation is introduced, this must become an explicit tag
 * cache at the same time as its binding and migration.
 */
export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
  tagCache: 'dummy',
  queue: 'direct',
  enableCacheInterception: true,
  routePreloadingBehavior: 'none',
})
