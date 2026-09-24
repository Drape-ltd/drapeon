import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import { PersistentAccountRuntime } from '../../features/account/account-route-runtime'

export const dynamic = 'force-dynamic'

export default async function AccountLayout({ children }: { children: ReactNode }) {
  await headers()
  return <PersistentAccountRuntime>{children}</PersistentAccountRuntime>
}
