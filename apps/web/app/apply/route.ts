import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

export function GET(request: NextRequest): NextResponse {
  const destination = new URL('/sign-up', request.url)
  destination.searchParams.set('role', 'TAILOR')

  const source = request.nextUrl.searchParams.get('source')
  if (source) destination.searchParams.set('source', source)

  return NextResponse.redirect(destination, 308)
}
