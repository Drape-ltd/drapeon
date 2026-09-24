import { headers } from 'next/headers'
import type { ReactNode } from 'react'

/**
 * Keeps nonce-protected routes request-bound without making the public root
 * layout dynamic. Next reads the middleware CSP nonce while rendering these
 * route groups and applies it to framework scripts.
 */
export async function RequestBoundaryLayout({ children }: { children: ReactNode }) {
  await headers()
  return children
}
