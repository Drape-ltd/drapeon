import { notFound } from 'next/navigation'
import { isLocalSupabaseMfaEnabled } from '../../../web/lib/local-supabase-mfa'
import { LocalMfaClient } from '../ops/local-mfa/local-mfa-client'

export default function LocalMfaPage() {
  if (!isLocalSupabaseMfaEnabled()) notFound()
  return <main className="ops-lock" id="ops-content"><section className="ops-lock-card">
    <p className="ops-kicker">Dev-only workforce access</p>
    <h1>Verify a real Supabase MFA identity.</h1>
    <p>Only the two QA Auth users are eligible after their Auth user IDs are bound to active workforce principals. Passwords and authenticator secrets stay in this browser.</p>
    <LocalMfaClient />
  </section></main>
}
