import { NextResponse } from 'next/server'

export const runtime = 'edge'

type ClientErrorReport = {
  correlationId?: unknown
  pathname?: unknown
  digest?: unknown
  message?: unknown
}

function compact(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : null
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as ClientErrorReport | null
  const correlationId = compact(body?.correlationId, 96)
  const pathname = compact(body?.pathname, 240)

  if (!correlationId || !pathname?.startsWith('/account')) {
    return NextResponse.json({ accepted: false }, { status: 400 })
  }

  // This lands in the deployment's server logs, where the correlation ID shown
  // to the affected person can be searched. Do not send session data, stacks,
  // URLs with query values, or identifiers from the browser.
  console.error('[web-account-boundary]', {
    correlationId,
    pathname,
    digest: compact(body?.digest, 128),
    message: compact(body?.message, 320),
  })

  return NextResponse.json({ accepted: true, correlationId }, { status: 202 })
}
