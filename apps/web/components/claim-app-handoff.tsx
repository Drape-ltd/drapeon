'use client'

import { useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { AppStoreLinks } from './app-store-links'

export function ClaimAppHandoff({ token }: { token: string }) {
  const [showFallback, setShowFallback] = useState(false)
  const universalPath = `/claim/${encodeURIComponent(token)}`
  const customScheme = `drape://claim/${encodeURIComponent(token)}`
  const universalUrl =
    typeof window === 'undefined'
      ? universalPath
      : new URL(universalPath, window.location.origin).toString()
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
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-needle">
        Ready when you are
      </p>
      <h2 className="mt-2 font-serif text-2xl text-ink">Claim your shop in the Drapeon app</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-ink/60">
        Keep this private claim with you while you install, sign in, and review your storefront.
      </p>
      <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
        <button
          className="rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white sm:hidden"
          type="button"
          onClick={openAppFallback}
        >
          Claim your shop in the app
        </button>
        <button
          className="rounded-full border border-ink/15 px-5 py-3 text-sm font-semibold text-ink"
          type="button"
          onClick={openAppFallback}
        >
          I’ve installed it — continue
        </button>
      </div>
      {embeddedBrowser ? (
        <p className="mt-3 text-xs leading-5 text-ink/55">
          Instagram and Facebook can block Google sign-in. Open this link in Safari or Chrome, or
          continue in the app.
        </p>
      ) : null}
      {showFallback ? (
        <p className="mt-3 text-xs text-ink/55">
          If the app did not open, install it below and return to this private link.
        </p>
      ) : null}
      <div className="mx-auto mt-5 hidden w-fit rounded-2xl border border-ink/10 bg-white p-3 sm:block">
        <QRCodeSVG value={universalUrl} size={168} includeMargin={true} />
        <p className="mt-1 text-xs font-semibold text-ink/55">
          Scan with your phone to finish in the app
        </p>
      </div>
      <AppStoreLinks
        placement="tailor claim handoff"
        className="mt-5 flex justify-center [&>div]:justify-center"
      />
      <a
        className="mt-4 inline-block text-sm font-semibold underline decoration-ink/25 underline-offset-4"
        href="#claim-on-web"
      >
        Continue on web
      </a>
    </section>
  )
}
