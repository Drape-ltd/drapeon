import type { Metadata } from 'next'
import { PassportClaim } from './passport-claim'

export const metadata: Metadata = {
  title: 'Claim your Client Passport | Drapeon',
  robots: { index: false, follow: false },
}

export default async function PassportClaimPage({ params }: { params: Promise<{ passportId: string }> }) {
  const { passportId } = await params
  return <PassportClaim passportId={passportId} />
}
