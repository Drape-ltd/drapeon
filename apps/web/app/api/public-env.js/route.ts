import {
  getSupabasePublishableKey,
  getSupabaseUrl,
  getTurnstileSiteKey,
} from '../../../lib/supabase-config'
import {
  isProductionWebHostname,
  validateSupabaseTarget,
} from '../../../lib/supabase-environment'

export const dynamic = 'force-dynamic'

function scriptFor(payload: unknown) {
  return `window.__DRAPEON_PUBLIC_ENV__=${JSON.stringify(payload).replace(/</g, '\\u003c')};`
}

export function GET(request: Request) {
  const supabaseUrl = getSupabaseUrl()
  const supabasePublishableKey = getSupabasePublishableKey()
  const turnstileSiteKey = getTurnstileSiteKey()
  const hostname = new URL(request.url).hostname

  if (
    isProductionWebHostname(hostname) &&
    !validateSupabaseTarget(supabaseUrl, 'production').isValid
  ) {
    return new Response(scriptFor({
      supabaseUrl: null,
      supabasePublishableKey: null,
      turnstileSiteKey,
    }), {
      status: 503,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }

  return new Response(
    scriptFor({
      supabaseUrl,
      supabasePublishableKey,
      turnstileSiteKey,
    }),
    {
      headers: {
        // These are intentionally public browser configuration values. Cache
        // them at the edge so static pages do not invoke the Worker again for
        // every cold navigation while still allowing hourly rotation.
        'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'X-Content-Type-Options': 'nosniff',
      },
    }
  )
}
