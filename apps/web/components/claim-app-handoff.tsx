'use client'

import { useMemo, useState } from 'react'
import { DRAPEON_ANDROID_STORE_URL, DRAPEON_IOS_STORE_URL } from '@drape/shared'

export function ClaimAppHandoff({ token }: { token: string }) {
  const [showFallback, setShowFallback] = useState(false)
  const universalPath = `/claim/${encodeURIComponent(token)}`
  const customScheme = `drape://claim/${encodeURIComponent(token)}`
  const embeddedBrowser = useMemo(
    () => typeof navigator !== 'undefined' && /Instagram|FBAN|FBAV/iu.test(navigator.userAgent),
    []
  )

  function openAppFallback() {
    setShowFallback(false)
    window.location.href = customScheme
    window.setTimeout(() => {
      if (document.visibilityState !== 'hidden') setShowFallback(true)
    }, 900)
  }

  return (
    <section className="mx-auto mt-5 max-w-2xl rounded-[1.75rem] border border-ink/10 bg-white/85 p-5 text-center shadow-sm sm:p-6">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-needle">Ready when you are</p>
      <h2 className="mt-2 font-serif text-2xl text-ink">Claim your shop in the Drapeon app</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-ink/60">
        Keep this private claim with you while you install, sign in, and review your storefront.
      </p>
      <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
        <a className="rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white" href={universalPath}>
          Claim your shop in the app
        </a>
        <button className="rounded-full border border-ink/15 px-5 py-3 text-sm font-semibold text-ink" type="button" onClick={openAppFallback}>
          I’ve installed it — continue
        </button>
      </div>
      {embeddedBrowser ? (
        <p className="mt-3 text-xs leading-5 text-ink/55">Instagram and Facebook can block Google sign-in. Open this link in Safari or Chrome, or continue in the app.</p>
      ) : null}
      {showFallback ? <p className="mt-3 text-xs text-ink/55">If the app did not open, install it below and return to this private link.</p> : null}
      <div className="mt-4 flex flex-wrap justify-center gap-3 text-sm font-semibold">
        <a className="underline decoration-ink/25 underline-offset-4" href={DRAPEON_IOS_STORE_URL}>Download for iPhone</a>
        <a className="underline decoration-ink/25 underline-offset-4" href={DRAPEON_ANDROID_STORE_URL}>Download for Android</a>
        <a className="underline decoration-ink/25 underline-offset-4" href="#claim-on-web">Continue on web</a>
      </div>
    </section>
  )
}
