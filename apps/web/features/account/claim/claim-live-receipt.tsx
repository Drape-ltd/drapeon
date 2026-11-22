'use client'

import Link from 'next/link'
import { CheckCircle2, WalletCards } from 'lucide-react'

/**
 * The web endpoint is deliberately a hand-off only: claim finalization happens
 * in the existing mobile setup flow, while this gives a newly-live tailor one
 * clear way to open the established payout surface.
 */
export function ClaimLiveReceipt() {
  return (
    <main className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-2xl items-center px-5 py-12 sm:px-8">
      <section className="w-full rounded-[2rem] border border-ink/10 bg-white p-7 shadow-[0_22px_58px_rgba(22,28,24,0.10)] sm:p-10">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-needle text-white">
          <CheckCircle2 aria-hidden="true" size={30} />
        </div>
        <p className="mt-7 text-xs font-extrabold tracking-[0.2em] text-needle">SHOP PUBLISHED</p>
        <h1 className="mt-3 font-display text-4xl leading-tight text-ink sm:text-5xl">Your shop is live.</h1>
        <p className="mt-5 max-w-xl text-lg leading-8 text-ink/65">
          Your shop is visible and enquiries are open. Paid orders start once payouts are set up.
        </p>
        <div className="mt-8 rounded-2xl bg-needle/10 p-5">
          <div className="flex items-start gap-3">
            <WalletCards aria-hidden="true" className="mt-0.5 shrink-0 text-needle" size={22} />
            <div>
              <h2 className="font-display text-2xl text-ink">Set up payouts</h2>
              <p className="mt-1 text-sm leading-6 text-ink/65">
                Add your payout details when you are ready to take paid orders.
              </p>
            </div>
          </div>
        </div>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link
            href="/account/payout"
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-needle px-6 text-sm font-bold text-white transition hover:bg-needle-600"
          >
            Set up payouts
          </Link>
          <Link href="/account/dashboard" className="inline-flex min-h-12 items-center justify-center px-5 text-sm font-semibold text-needle hover:underline">
            Go to dashboard
          </Link>
        </div>
      </section>
    </main>
  )
}
