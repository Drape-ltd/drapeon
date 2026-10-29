'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export default function BachsOnboardingReturnPage() {
  const router = useRouter()
  const params = useSearchParams()
  const routeId = params.get('routeId')

  useEffect(() => {
    if (!routeId || !/^[0-9a-f-]{36}$/iu.test(routeId)) return
    router.replace(`/account/payout?setup=bachs-return&routeId=${encodeURIComponent(routeId)}`)
  }, [routeId, router])

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle">Payout setup</p>
      <h1 className="font-display text-3xl text-ink">Returning to Drapeon</h1>
      <p className="text-sm leading-6 text-ink/60">
        We’re checking your Bachs account status. You can safely close this page if it does not
        redirect.
      </p>
    </main>
  )
}
