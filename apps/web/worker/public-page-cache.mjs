// Edge cache for signed-out public marketplace HTML.
//
// Why: /explore and /tailors/<id> are server-rendered on every request. Under
// concurrent traffic those renders push Worker isolates past Cloudflare's
// 128 MB limit (error 1102). Serving repeat views from the colo's Cache API
// skips Next.js entirely.
//
// Safety bound (product decision 2026-11-10): a tailor who is hidden or
// suspended may remain visible for at most PUBLIC_PAGE_CACHE_TTL_SECONDS per
// Cloudflare location. The Cache API never serves an entry past its max-age
// (unlike ISR, which serves one stale copy after expiry), so the bound is hard.
// Browsers still receive the original no-store response headers.
//
// Only exact, query-free GET requests for the default Explore view and a
// tailor profile are cached. These pages read no cookies or headers on the
// server and are outside the middleware matcher, so their HTML is identical
// for every visitor. RSC/navigation requests, filtered/search views, non-200
// responses and responses that set cookies are never cached.

export const PUBLIC_PAGE_CACHE_TTL_SECONDS = 60
export const PUBLIC_PAGE_CACHE_HEADER = 'x-drape-page-cache'

const PROFILE_PATH = /^\/tailors\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const BYPASS_REQUEST_HEADERS = [
  'rsc',
  'next-action',
  'next-router-prefetch',
  'next-router-segment-prefetch',
  'next-router-state-tree',
  'authorization',
]
const BROWSER_CACHE_CONTROL = 'private, no-cache, no-store, max-age=0, must-revalidate'

/** Returns the cache key URL for a cacheable request, or null. */
export function publicPageCacheKey(request) {
  if (request.method !== 'GET') return null
  if (BYPASS_REQUEST_HEADERS.some((name) => request.headers.has(name))) return null
  let url
  try {
    url = new URL(request.url)
  } catch {
    return null
  }
  if (url.search || url.hash) return null
  const cacheable = url.pathname === '/explore' || PROFILE_PATH.test(url.pathname)
  return cacheable ? `${url.origin}${url.pathname}` : null
}

/** Whether a rendered response may be stored for every visitor. */
export function isStorablePublicResponse(response) {
  if (response.status !== 200) return false
  if (response.headers.has('set-cookie')) return false
  const contentType = response.headers.get('content-type') ?? ''
  return contentType.toLowerCase().startsWith('text/html')
}

function storedCopy(response) {
  const headers = new Headers(response.headers)
  headers.delete('vary')
  headers.delete('set-cookie')
  headers.set('cache-control', `public, max-age=${PUBLIC_PAGE_CACHE_TTL_SECONDS}`)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

function forBrowser(response, state) {
  const headers = new Headers(response.headers)
  headers.set('cache-control', BROWSER_CACHE_CONTROL)
  headers.set(PUBLIC_PAGE_CACHE_HEADER, state)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

function defaultCache() {
  return typeof caches !== 'undefined' && caches?.default ? caches.default : null
}

/**
 * Wraps a Worker module handler. `getCache` is injectable for tests.
 * Any cache failure falls through to the uncached handler.
 */
export function withPublicPageCache(handler, { getCache = defaultCache } = {}) {
  return {
    ...handler,
    async fetch(request, env, ctx) {
      const key = publicPageCacheKey(request)
      const cache = key ? getCache() : null
      if (!key || !cache) return handler.fetch(request, env, ctx)

      const cacheRequest = new Request(key, { method: 'GET' })
      try {
        const hit = await cache.match(cacheRequest)
        if (hit) return forBrowser(hit, 'HIT')
      } catch (error) {
        console.error('[public-page-cache] match failed', error instanceof Error ? error.message : String(error))
      }

      const response = await handler.fetch(request, env, ctx)
      if (!isStorablePublicResponse(response)) return response

      const [browserBody, storeBody] = response.body ? response.body.tee() : [null, null]
      const base = { status: response.status, statusText: response.statusText, headers: response.headers }
      const put = cache
        .put(cacheRequest, storedCopy(new Response(storeBody, base)))
        .catch((error) => {
          console.error('[public-page-cache] put failed', error instanceof Error ? error.message : String(error))
        })
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(put)
      return forBrowser(new Response(browserBody, base), 'MISS')
    },
  }
}
