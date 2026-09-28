import { NextResponse, type NextRequest } from 'next/server'
import { contentSecurityPolicy } from './lib/content-security-policy.mjs'
import { evaluateOpsRuntimeBoundary } from './lib/runtime-boundary.mjs'

function hostname(request: NextRequest) {
  return (request.headers.get('host') ?? '').trim().toLowerCase().split(':')[0] ?? ''
}

function createNonce() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function lockedResponse(message: string, status: number) {
  return new Response(message, {
    status,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      'Content-Type': 'text/plain; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    },
  })
}

function canonicalOpsRedirect(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  if (pathname !== '/' && pathname !== '/ops' && pathname !== '/ops/') return null

  const response = NextResponse.redirect(new URL('/ops/my-work', request.url), 307)
  response.headers.set('Cache-Control', 'private, no-store, max-age=0')
  response.headers.set('Referrer-Policy', 'no-referrer')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive')
  return response
}

function productionContractError(request: NextRequest) {
  const result = evaluateOpsRuntimeBoundary({
    nodeEnvironment: process.env.NODE_ENV,
    hostname: hostname(request),
    expectedHostname: process.env.OPS_HOSTNAME,
    opsEnvironment: process.env.DRAPE_OPS_ENV,
    expectedProjectRef: process.env.DRAPE_EXPECTED_SUPABASE_PROJECT_REF,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL,
    accessTeamDomain: process.env.CF_ACCESS_TEAM_DOMAIN,
    normalAudience: process.env.CF_ACCESS_AUD,
    sensitiveAudience: process.env.CF_ACCESS_SENSITIVE_AUD,
    sharedToken: process.env.OPS_DASHBOARD_TOKEN,
    bootstrapFlag: process.env.OPS_ALLOW_BOOTSTRAP_IN_PRODUCTION,
    localWorkforceFlag: process.env.OPS_LOCAL_WORKFORCE_DRY_RUN,
  })
  if (!result) return null
  return result.status === 404
    ? lockedResponse('Not found.', 404)
    : lockedResponse('Ops runtime configuration unavailable.', 503)
}

export function middleware(request: NextRequest) {
  const contractError = productionContractError(request)
  if (contractError) return contractError

  const canonicalRedirect = canonicalOpsRedirect(request)
  if (canonicalRedirect) return canonicalRedirect

  const nonce = createNonce()
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  if (request.nextUrl.searchParams.get('notice') === 'ops-signed-out') {
    requestHeaders.set('x-ops-notice', 'ops-signed-out')
  } else {
    requestHeaders.delete('x-ops-notice')
  }
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', contentSecurityPolicy(nonce, {
    development: process.env.NODE_ENV !== 'production',
    configuredSupabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL,
  }))
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive')
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|ops-icon.svg|ops-icon-192.png|ops-icon-512.png|ops-manifest.webmanifest|ops-sw.js).*)'],
}
