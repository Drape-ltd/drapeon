'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  DRAPEON_ANDROID_STORE_URL,
  DRAPEON_IOS_STORE_URL,
  normalizeDrapeonAppUrl,
  normalizeEmailWebPath,
} from '@drape/shared/email-links'

export default function OpenPage() {
  const searchParams = useSearchParams()
  const webPath = normalizeEmailWebPath(searchParams.get('next'))
  const appUrl = normalizeDrapeonAppUrl(searchParams.get('app'))
  const webHref = useMemo(() => webPath, [webPath])

  return (
    <main className="min-h-screen bg-[#f9f7f3] px-6 py-16 text-[#1d1d1b]">
      <div className="mx-auto flex max-w-xl flex-col gap-8 rounded-3xl border border-[#d8d2c7] bg-white p-8 shadow-sm sm:p-12">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[#2d6a4f]">Drapeon</p>
          <h1 className="mt-4 font-serif text-4xl leading-tight sm:text-5xl">Open this in Drapeon.</h1>
          <p className="mt-4 text-lg leading-8 text-[#55534f]">Choose where you want to continue. Your link is ready on the web too.</p>
        </div>

        <div className="flex flex-col gap-3">
          {appUrl ? <a className="rounded-full bg-[#2d6a4f] px-6 py-4 text-center font-semibold text-white" href={appUrl}>Open in Drapeon</a> : null}
          <a className="rounded-full border border-[#2d6a4f] px-6 py-4 text-center font-semibold text-[#2d6a4f]" href={webHref}>Continue on the web</a>
        </div>

        <div className="border-t border-[#e6e0d7] pt-6">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#77736c]">Get the app</p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <a className="rounded-full border border-[#d8d2c7] px-4 py-3 text-center text-sm font-semibold" href={DRAPEON_IOS_STORE_URL}>App Store</a>
            <a className="rounded-full border border-[#d8d2c7] px-4 py-3 text-center text-sm font-semibold" href={DRAPEON_ANDROID_STORE_URL}>Google Play</a>
          </div>
        </div>
      </div>
    </main>
  )
}
