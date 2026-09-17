'use client'

import { AlertCircle, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'

function createCorrelationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `acct_${crypto.randomUUID()}`
  }
  return `acct_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function safeErrorMessage(error: Error) {
  return error.message
    .replace(/\b(access_token|refresh_token|token|code)=([^&\s]+)/giu, '$1=[redacted]')
    .replace(/\bBearer\s+[^\s]+/giu, 'Bearer [redacted]')
    .slice(0, 320)
}

export default function AccountError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }): React.JSX.Element {
  const [correlationId] = useState(createCorrelationId)

  useEffect(() => {
    const payload = {
      correlationId,
      pathname: window.location.pathname,
      digest: error.digest ?? null,
      message: safeErrorMessage(error),
    }
    console.error('[account route]', payload)

    const body = JSON.stringify(payload)
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/client-errors', new Blob([body], { type: 'application/json' }))
      return
    }
    void fetch('/api/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => undefined)
  }, [correlationId, error])

  return (
    <main className="min-h-screen bg-ui-canvas px-4 py-4 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-2rem)] max-w-[92rem] place-items-center rounded-[12px] border border-ui-border bg-white">
        <section className="max-w-md px-6 py-12 text-center" aria-labelledby="account-error-title">
          <AlertCircle className="mx-auto size-7 text-rust" aria-hidden="true" />
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-drape-green">Account interrupted</p>
          <h1 id="account-error-title" className="mt-3 text-3xl font-semibold tracking-tight">We could not open this part of your account.</h1>
          <p className="mt-3 text-sm leading-6 text-ui-subtle">Your saved work has not been discarded. Try this screen again or return to your account.</p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <button type="button" onClick={reset} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[8px] bg-ink px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-drape-green focus-visible:ring-offset-2">
              <RefreshCw className="size-4" aria-hidden="true" />
              Try again
            </button>
            <Link href="/account/orders" className="inline-flex min-h-11 items-center rounded-[8px] border border-ui-border bg-white px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-ui-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-drape-green focus-visible:ring-offset-2">
              Return to account
            </Link>
          </div>
          <p className="mt-6 text-xs text-ui-subtle">
            Reference {correlationId}
            {error.digest ? ` · ${error.digest}` : ''}
          </p>
        </section>
      </div>
    </main>
  )
}
