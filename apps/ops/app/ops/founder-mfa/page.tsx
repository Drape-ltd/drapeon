import { notFound, redirect } from 'next/navigation'
import {
  FOUNDER_TRUST_EMAIL,
  getFounderTrustFallbackBinding,
  isFounderTrustMfaRuntime,
} from '../../../../web/lib/founder-trust-mfa'
import { getTurnstileSiteKey } from '../../../../web/lib/supabase-config'
import { getOpsSession, hasFreshOpsTrustMfa } from '../../../lib/ops-session'
import { FounderTrustMfaClient } from './founder-trust-mfa-client'

export const dynamic = 'force-dynamic'

function safeReturnTo(value: string | undefined) {
  return value?.startsWith('/ops/cases/') && !value.startsWith('//') ? value : '/ops/my-work'
}

export default async function FounderTrustMfaPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>
}) {
  if (!isFounderTrustMfaRuntime()) notFound()
  const [{ returnTo }, session, binding] = await Promise.all([
    searchParams,
    getOpsSession(),
    getFounderTrustFallbackBinding(),
  ])
  const destination = safeReturnTo(returnTo)
  if (
    !session?.allowed
    || session.mode !== 'cloudflare-access'
    || session.role !== 'admin'
    || session.email !== FOUNDER_TRUST_EMAIL
    || !session.principalId
    || !binding
    || binding.principal_id !== session.principalId
  ) notFound()
  if (hasFreshOpsTrustMfa(session)) redirect(destination)

  return <main className="ops-lock" id="ops-content"><section className="ops-lock-card">
    <p className="ops-kicker">Temporary trust-review step-up</p>
    <h1>Verify the founder authenticator.</h1>
    <p>Your current Cloudflare Access session is still required. This separate 15-minute check unlocks only tailor challenge videos and approve or reject controls.</p>
    <p>Money movement, exports, account deletion, and workforce administration remain locked behind the dedicated Cloudflare protected-access app.</p>
    <FounderTrustMfaClient returnTo={destination} turnstileSiteKey={getTurnstileSiteKey()} />
  </section></main>
}
