'use client'

import { useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { AppStoreLinks } from './app-store-links'

export function ClaimAppHandoff({
  token,
  claimUrl,
  onMobileDevice,
}: {
  token: string
  claimUrl: string
  onMobileDevice: boolean
}) {
  const [showFallback, setShowFallback] = useState(false)
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
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-needle">
        Ready when you are
      </p>
      <h2 className="mt-2 font-serif text-2xl text-ink">Claim your shop in the Drapeon app</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-ink/60">
        Keep this private claim with you while you install, sign in, and review your storefront.
      </p>
      {onMobileDevice ? (
        <div className="mt-4">
          <button
            className="rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
            type="button"
            onClick={openAppFallback}
          >
            Claim your shop in the app
          </button>
        </div>
      ) : null}
      {embeddedBrowser ? (
        <p className="mt-3 text-xs leading-5 text-ink/55">
          Instagram and Facebook may keep this link inside their browser. Open it in Safari or
          Chrome if Drapeon does not open.
        </p>
      ) : null}
      {showFallback ? (
        <p className="mt-3 text-xs text-ink/55">
          If the app did not open, install it below and return to this private link.
        </p>
      ) : null}
      {!onMobileDevice ? (
        <div className="claim-qr-panel mx-auto mt-5 w-fit rounded-2xl border border-ink/10 bg-white p-3">
          <QRCodeSVG value={claimUrl} size={168} includeMargin={true} />
          <p className="mt-1 text-xs font-semibold text-ink/55">
            Scan with your phone to open this private claim
          </p>
        </div>
      ) : null}
      <AppStoreLinks
        placement="tailor claim handoff"
        className="mt-5 flex justify-center [&>div]:justify-center"
      />
    </section>
  )
}
